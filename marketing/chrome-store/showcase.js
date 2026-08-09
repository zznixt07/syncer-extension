const scenarios = {
    join: {
        kicker: 'One-click rooms',
        headline: 'Find your people. Join instantly.',
        description: 'Browse public watch rooms and jump in with one click. No accounts, invites, or setup screens.',
        features: ['Public rooms', 'One-click join', 'No account required'],
    },
    host: {
        kicker: 'Host controls',
        headline: 'Press play once. Everyone follows.',
        description: 'Create a room and Syncer keeps play, pause, seeking, and media changes aligned for every guest.',
        features: ['Play & pause', 'Seek together', 'Automatic recovery'],
    },
    devices: {
        kicker: 'Cross-device',
        headline: 'Keep the same moment across screens.',
        description: 'Follow browser and supported mobile playback with clear media details when manual navigation is needed.',
        features: ['Desktop + mobile', 'Media identity', 'Host-authoritative sync'],
    },
};

const scenarioName = new URLSearchParams(location.search).get('scenario') || 'join';
const scenario = scenarios[scenarioName] || scenarios.join;
document.getElementById('kicker').textContent = scenario.kicker;
document.getElementById('headline').textContent = scenario.headline;
document.getElementById('description').textContent = scenario.description;
document.getElementById('features').replaceChildren(...scenario.features.map((feature) => {
    const chip = document.createElement('span');
    chip.textContent = feature;
    return chip;
}));
document.getElementById('popup-frame').src = `popup-showcase.html?scenario=${encodeURIComponent(scenarioName)}`;
