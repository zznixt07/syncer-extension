/* 
For playing a particular song we need the songs unique URI and
the playlists ID which contains that song
*/

/* owner: get current playing songs URL */
const currentSongURL = document.querySelector('.Root__now-playing-bar [data-testid="now-playing-widget"] a[data-testid="context-link"]')
if (!currentSongURL) {
    // return
}

/* extract current songs URI and the playlist's ID it is in. */
const parsedURL = new URL(currentSongURL)
const isPrivatePlaylist = parsedURL.pathname.test(/\/user\/.+\/collection\/.+$/)
if (isPrivatePlaylist) {
    // return
}
const matches = parsedURL.pathname.match(/\/(.+)\/(.+)$/)
if (!matches) {
    // return
}
const playlistID = matches[2]
const songURI = parsedURL.searchParams.get('uri')
if (!songURI) {
    // return
}

const data = {
    'service': 'spotify',
    'meta': {
        'playlistID': playlistID,
        'songURI': songURI
    },
    timestamp: 53
}


/* 
    Room Joinee Side:
    To change the current playing song we need to call a .play() function

    To change seek poisition we call onDragEnd() function  
*/

const getPropertyBeginningWith = (elem, propPrefix) => {
    const reactProps = Object.getOwnPropertyNames(elem)
    let requiredProp = null
    for (const prop of reactProps) {
        if (prop.startsWith(propPrefix)) {
            requiredProp = prop
            break
        }
    }
    return requiredProp
}

const recv = data

const rootElemSelector = '[data-testid="root"]'
const requiredProp = getPropertyBeginningWith('__reactFiber$', document.querySelector(rootElemSelector))
if (!requiredProp) {
    // return
}

const current = document.querySelector(rootElemSelector)[requiredProp]
if (!current) {
    // return
}
while (true) {
    if (!current.return) break;
    current = current.return;
}
current.child.memoizedProps.platform.getPlayerAPI().play(
    {"uri": `spotify:playlist:${recv.meta.playlistID}`},
    {},
    {"skipTo": {"uri": `${recv.meta.songURI}`}}
)

const musicPlayerProgressBarSelector = '[data-testid="playback-progressbar"]'
const progressBarElem = document.querySelector(musicPlayerProgressBarSelector)[requiredProp]
if (!progressBarElem) {
    // return
}
let correspondingProps = progressBarElem.return?.memoizedProps
let seekFn = correspondingProps?.onDragEnd
if (!seekFn) {
    let current = progressBarElem.return
    if (current) {
        while (true) {
            current = current.return;
            correspondingProps = current?.memoizedProps
            if (correspondingProps?.onDragEnd || !current) break;
        }
    }
    seekFn = correspondingProps?.onDragEnd
}

if (!seekFn) {
    // return
}

const currentSongTotalDurationSecs = correspondingProps?.max
// between [0 - 1] Example: 0.2 means seek to 20%
const percentageFracToSeekTo = recv.timestamp / currentSongTotalDurationSecs

seekFn(percentageFracToSeekTo, {})