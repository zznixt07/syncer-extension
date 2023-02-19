// ; (() => {
    const script = document.createElement('script')
    script.src = chrome.runtime.getURL('main-content-script.js')
    // assign type module so importing is allowed.
    script.type = "module"
    script.onload = function () {
        this.remove()
    }
    ; (document.head || document.documentElement).appendChild(script)

    const ORIGIN = 'https://open.spotify.com'
    const log = (...msgs) => {
        console.log('CS:', ...msgs)
    }

    const sendMessageToBG = async (message) => {
		const resp = await chrome.runtime.sendMessage(message)
		return resp
    }

    const getServerAddress = async () => {
		// log('getting server address')
		return await sendMessageToBG({ type: 'get_server_address' })
	}

    window.addEventListener('message', async (event) => {
        if (event.source !== window || event.data.type === 'syncer-extension-mcs-to-bg') {
            // log('send msg to bg from CS', event.data.data)
            const resp = await chrome.runtime.sendMessage(event.data.data)
            // log('resep from bg to CS', resp)
            event.ports[0].postMessage(resp)
        }
    })

    // send message to script injected in the page (MAIN world)
    const sendMessageToMCS = async (message) => {
        return new Promise((resolve) => {
            const channel = new MessageChannel() 
            channel.port1.onmessage = (event) => {
                channel.port1.close()
                resolve(event.data)
            }
            window.postMessage({type: 'syncer-extension-bg-to-mcs', data: message}, '*', [channel.port2])
        })
        
    }
    
    // messages sent from background script using `tabs.sendMessage()`
    chrome.runtime.onMessage.addListener((message, sender, reply) => {
        // console.log('tab.sendMessage', message)
		// do not use async function if u want to return value after awaiting.
		// instead use an async IIFE and use return true;
        ; (async () => {
            if (message.type === 'get_server_address') {
                const result = await getServerAddress()
                reply(result)
                return
            }
            else if (message.type === 'set_server_address') {
                const result = await sendMessageToBG({ type: message.type, data: message.roomName })
                reply(result)
                return
            }
            // else if (message.type === 'get_prev_room_from_storage') {
            //     const result = await getPrevRoomFromLS()
            //     reply(result)
            //     return
            // } else if (message.type === 'remove_prev_room_from_storage') {
            //     removePrevRoomFromLS()
            //     reply(result)
            //     return
            // }
            else {
                const resp = await sendMessageToMCS(message)
                reply(resp)
            }
        })()
		return true
        // reply({})
    })

    /*
	------ a HACK to make service workers persistent --------
	Thx wOxxOm. Source: https://stackoverflow.com/a/66618269/12091475
	*/
	// <Hack>
	let port;
	function connect() {
		port = chrome.runtime.connect({ name: 'foo' });
		port.onDisconnect.addListener(connect);
		port.onMessage.addListener(msg => {
			console.log('received', msg, 'from bg');
		});
	}
	connect();
	// </Hack>
// })()