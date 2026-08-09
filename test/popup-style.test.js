import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'

test('extension popup overrides shared light styles with visible dark controls', async () => {
	const [html, css] = await Promise.all([
		readFile(new URL('../popup.html', import.meta.url), 'utf8'),
		readFile(new URL('../index.css', import.meta.url), 'utf8'),
	])

	assert.ok(
		html.indexOf('generated/popup-base.css') < html.indexOf('./index.css'),
		'extension theme must load after the shared base styles',
	)
	assert.match(css, /body\s*{[^}]*background-color:\s*black;/s)
	assert.match(css, /\.pushable\s*{[^}]*background:\s*#111;/s)
	assert.doesNotMatch(css, /\.pushable\s*{[^}]*background:\s*transparent;/s)
})
