/*
Builds the zip that gets uploaded to the Chrome Web Store.

Ships exactly what the extension loads at runtime — nothing is picked up by
globbing the repo, because a stray dev file in the package is at best review
surface and at worst a rejection. Chrome also refuses to load a directory
containing a file whose name starts with `_`, so an accidental scratch file
would break the upload rather than just bloat it.

  node scripts/package.mjs        -> dist/syncer-<version>.zip
*/
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const DIST = path.join(ROOT, 'dist')

// Every file the extension actually loads, traced from manifest.json and the
// import graph. Keep this list in step with the manifest.
const FILES = [
	'manifest.json',
	'icon.png',
	// generated background service worker (Socket.IO and core are bundled)
	'generated/background.js',
	// content scripts (content-script.js injects main-content-script.js)
	'content-script.js',
	'generated/main-content-script.js',
	// popup
	'popup.html',
	'generated/popup.js',
	'generated/popup-base.css',
	'index.css',
	'lib/wc-toast.js',
]

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'))
const { version } = manifest

const missing = FILES.filter((f) => !fs.existsSync(path.join(ROOT, f)))
if (missing.length) {
	console.error(`Cannot package — these are listed but not on disk:\n  ${missing.join('\n  ')}`)
	process.exit(1)
}

// A file the manifest references but the list forgot would ship broken, so
// check the manifest's own references resolve.
const referenced = [
	manifest.action?.default_popup,
	manifest.action?.default_icon,
	...Object.values(manifest.icons ?? {}),
	manifest.background?.service_worker,
	...(manifest.content_scripts ?? []).flatMap((cs) => cs.js ?? []),
	...(manifest.web_accessible_resources ?? []).flatMap((war) => war.resources ?? []),
].filter(Boolean)
const unlisted = [...new Set(referenced)].filter((f) => !FILES.includes(f))
if (unlisted.length) {
	console.error(`manifest.json references files this script does not ship:\n  ${unlisted.join('\n  ')}`)
	process.exit(1)
}

/*
Written by hand rather than shelled out to. Windows PowerShell's
Compress-Archive stores nested paths as `lib\socket.io.min.js`, with the
separator the ZIP spec does not allow, and Chrome then cannot resolve
`lib/socket.io.min.js` — a package that looks fine in Explorer and fails on
load. Building the archive here keeps the separator correct on every platform,
and keeps the repo free of a dependency for the sake of one file.
*/
const CRC_TABLE = Int32Array.from({ length: 256 }, (_, n) => {
	let c = n
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
	return c
})
const crc32 = (buf) => {
	let c = ~0
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
	return ~c >>> 0
}

// Fixed DOS timestamp (1980-01-01) so the same tree always produces a
// byte-identical zip — makes "did anything actually change?" answerable.
const DOS_TIME = 0
const DOS_DATE = 0x0021

const entries = []
const chunks = []
let offset = 0

for (const file of FILES) {
	const name = Buffer.from(file.split(path.sep).join('/'), 'utf8')
	const raw = fs.readFileSync(path.join(ROOT, file))
	const deflated = zlib.deflateRawSync(raw, { level: 9 })
	// Storing is legal and smaller when deflate doesn't help (already-compressed PNG).
	const stored = deflated.length >= raw.length
	const body = stored ? raw : deflated
	const method = stored ? 0 : 8
	const crc = crc32(raw)

	const local = Buffer.alloc(30)
	local.writeUInt32LE(0x04034b50, 0)
	local.writeUInt16LE(20, 4) // version needed
	local.writeUInt16LE(0, 6) // flags
	local.writeUInt16LE(method, 8)
	local.writeUInt16LE(DOS_TIME, 10)
	local.writeUInt16LE(DOS_DATE, 12)
	local.writeUInt32LE(crc, 14)
	local.writeUInt32LE(body.length, 18)
	local.writeUInt32LE(raw.length, 22)
	local.writeUInt16LE(name.length, 26)
	local.writeUInt16LE(0, 28) // extra
	chunks.push(local, name, body)

	entries.push({ name, method, crc, compressed: body.length, size: raw.length, offset })
	offset += local.length + name.length + body.length
}

const central = []
let centralSize = 0
for (const e of entries) {
	const head = Buffer.alloc(46)
	head.writeUInt32LE(0x02014b50, 0)
	head.writeUInt16LE(20, 4) // version made by
	head.writeUInt16LE(20, 6) // version needed
	head.writeUInt16LE(0, 8) // flags
	head.writeUInt16LE(e.method, 10)
	head.writeUInt16LE(DOS_TIME, 12)
	head.writeUInt16LE(DOS_DATE, 14)
	head.writeUInt32LE(e.crc, 16)
	head.writeUInt32LE(e.compressed, 20)
	head.writeUInt32LE(e.size, 24)
	head.writeUInt16LE(e.name.length, 28)
	head.writeUInt16LE(0, 30) // extra
	head.writeUInt16LE(0, 32) // comment
	head.writeUInt16LE(0, 34) // disk start
	head.writeUInt16LE(0, 36) // internal attrs
	head.writeUInt32LE(0, 38) // external attrs
	head.writeUInt32LE(e.offset, 42)
	central.push(head, e.name)
	centralSize += head.length + e.name.length
}

const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0)
end.writeUInt16LE(0, 4) // this disk
end.writeUInt16LE(0, 6) // disk with central dir
end.writeUInt16LE(entries.length, 8)
end.writeUInt16LE(entries.length, 10)
end.writeUInt32LE(centralSize, 12)
end.writeUInt32LE(offset, 16)
end.writeUInt16LE(0, 20) // comment length

fs.mkdirSync(DIST, { recursive: true })
const zip = path.join(DIST, `syncer-${version}.zip`)
fs.writeFileSync(zip, Buffer.concat([...chunks, ...central, end]))

console.log(`${path.relative(ROOT, zip)}  (${FILES.length} files, ${fs.statSync(zip).size} bytes)`)
