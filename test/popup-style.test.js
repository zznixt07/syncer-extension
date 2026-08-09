import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'

test('extension popup overrides shared light styles with visible dark controls', async () => {
	const [html, css, script] = await Promise.all([
		readFile(new URL('../popup.html', import.meta.url), 'utf8'),
		readFile(new URL('../index.css', import.meta.url), 'utf8'),
		readFile(new URL('../popup.js', import.meta.url), 'utf8'),
	])

	assert.ok(
		html.indexOf('generated/popup-base.css') < html.indexOf('./index.css'),
		'extension theme must load after the shared base styles',
	)
	assert.match(css, /html,\s*body\s*{[^}]*background:\s*#090b10;/s)
	assert.match(css, /\.btn-primary\s*{[^}]*background:\s*#635bff;/s)
	assert.match(css, /datalist\s*{[^}]*display:\s*none;/s)
	assert.match(html, /<input[^>]*list="room-suggestions"/)
	assert.doesNotMatch(html, /value="chill-music-24\/7"/)
	assert.match(html, /<datalist id="room-suggestions">/)
	assert.doesNotMatch(html, /<datalist id="rooms">/)
	assert.match(html, /<div id="rooms-list" class="room-list"/)
	assert.match(html, /<details class="panel settings-panel">/)
	assert.ok(html.indexOf('id="rooms-list"') < html.indexOf('id="new-room-name"'))
	assert.match(script, /await loadRooms\(\)/)
	assert.doesNotMatch(script, /pre#rooms-list/)
})
