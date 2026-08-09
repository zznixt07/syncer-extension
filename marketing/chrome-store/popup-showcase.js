const room = (name, people, action = 'Join', active = false) => `
    <div class="room-row${active ? ' showcase-active' : ''}">
        <span class="room-row-name">${name} (${people})${active ? ` · ${action === 'Leave' ? 'active' : ''}` : ''}</span>
        <button class="btn room-row-action" type="button">${action}</button>
    </div>`;

const roomsPanel = (rows) => `
    <section class="panel rooms-panel">
        <div class="section-heading">
            <div><span class="eyebrow">Public rooms</span><h2>Join a room</h2></div>
            <button class="btn btn-quiet btn-compact" type="button"><span>↻</span> Refresh</button>
        </div>
        <div class="room-list">${rows}</div>
    </section>`;

const manualPanel = (name = '') => `
    <section class="panel manual-room">
        <div class="section-heading section-heading-simple">
            <div><span class="eyebrow">Room</span><h2>Create or join by name</h2></div>
        </div>
        <label class="field-label">Room name</label>
        <input value="${name}" placeholder="e.g. movie-night" readonly>
        <p class="room-user-count">${name ? "3 others present · you're the host" : ''}</p>
        <div class="room-actions">
            <button class="btn btn-primary" type="button">Create</button>
            <button class="btn btn-secondary" type="button">Join</button>
            <button class="btn btn-danger" type="button">Leave</button>
        </div>
    </section>`;

const hostMedia = ({service, title, artist, duration}) => `
    <section class="panel host-media">
        <span class="eyebrow">Now playing</span><h2>Host media</h2>
        <p class="host-media-instruction">Open this media manually, then Syncer will follow play, pause, and seek.</p>
        <dl>
            <div><dt>Service</dt><dd>${service}</dd></div>
            <div><dt>Title</dt><dd>${title}</dd></div>
            <div><dt>Artist/channel</dt><dd>${artist}</dd></div>
            <div><dt>Duration</dt><dd>${duration}</dd></div>
        </dl>
        <button class="btn btn-secondary host-media-copy" type="button">Copy title</button>
    </section>`;

const settings = `<details class="panel settings-panel"><summary><span>Settings &amp; diagnostics</span><span class="summary-hint">Server and media scan</span></summary></details>`;

const scenarios = {
    join: roomsPanel([
        room('Sunday Movie Club', '4 others'),
        room('Lo-fi Focus', '2 others'),
        room('Indie Watch Party', 'no one else'),
    ].join('')) + manualPanel() + settings,
    host: roomsPanel([
        room('Indie Watch Party', '3 others', 'Leave', true),
        room('Sunday Movie Club', '4 others'),
        room('Late Night Documentaries', '2 others'),
    ].join('')) + manualPanel('Indie Watch Party') + settings,
    devices: roomsPanel([
        room('Golden Hour Mix', '2 others', 'Leave', true),
        room('Sunday Movie Club', '4 others'),
    ].join('')) + hostMedia({
        service: 'Android media app',
        title: 'Golden Hour — Summer Mix',
        artist: 'Northbound Radio',
        duration: '58:42',
    }) + settings,
};

const scenario = new URLSearchParams(location.search).get('scenario') || 'join';
document.getElementById('showcase-content').innerHTML = scenarios[scenario] || scenarios.join;
