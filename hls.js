
const pUrl = require('url')
const needle = require('needle')
const m3u = require('m3u8-reader')

const m3us = {}

function btoa(str) {
    const buffer = str instanceof Buffer ? str : Buffer.from(str.toString(), 'binary')
    return buffer.toString('base64')
}

function isString(el) { return typeof el === 'string' || el instanceof String }

function isObject(el) { return typeof el === 'object' && el !== null }

function isHlsPlaylist(url) {
	if (!url.includes('.')) return false
	let ext = url.split('.').pop().toLowerCase()
	if (ext.includes('?')) ext = ext.split('?')[0]
	if (ext.includes('&')) ext = ext.split('&')[0]
	if (!['m3u','m3u8'].includes(ext)) return false
	return true
}

function processStream(url) {
	const parsed = pUrl.parse(url)
	const rootUrl = parsed.protocol + '//' + parsed.host
	return new Promise((resolve, reject) => {
		if (!isHlsPlaylist(url)) {
			// cannot validate hls playlist
			// return same link, it could still
			// be playable
			resolve([{ title: 'Stream', url }])
			return
		}
		needle.get(url, (err, resp, body) => {
			if (!err && body) {
				let playlist
				try {
					playlist = m3u(body)
				} catch(e) {
					resolve([{ title: 'Stream', url }])
					return
				}
				let streamTitle
				let streamIdx = 1
				const streams = []
				playlist.forEach(line => {
					if (isString(line)) {
						if (line.endsWith('.m3u') || line.endsWith('.m3u8')) {
							const tempStream = { title: streamTitle || ('Stream #' + streamIdx) }
							streamIdx++
							if (line.startsWith('http')) {
								tempStream.url = line
							} else if (line.startsWith('/')) {
								tempStream.url = rootUrl + line
							} else {
								const parts = url.split('/')
								parts[parts.length - 1] = line
								tempStream.url = parts.join('/')
							}
							if (tempStream.url)
								streams.push(tempStream)
						}
					} else if (isObject(line)) {
						if (line['STREAM-INF']) {
							const streamInf = line['STREAM-INF']
							if (streamInf['RESOLUTION'] && streamInf['RESOLUTION'].includes('x')) {
								const resolution = streamInf['RESOLUTION'].split('x')[1]
								if (resolution && parseInt(resolution) == resolution)
									streamTitle = resolution + 'p'
							}
						}
					}
				})

				if (!streams.length)
					streams.push({ title: 'Stream', url })

				resolve(streams)

			} else
				reject((err || {}).message || 'Unknown Error')
		})
	})
}

function clone(obj) {
	return JSON.parse(JSON.stringify(obj))
}

function getM3U(url, idx) {
	return new Promise((resolve, reject) => {

		if (m3us[url]) {
			resolve(clone(m3us[url]))
			return 
		}

		needle.get(url, (err, resp, body) => {
			if (!err && body) {
				let playlist
				try {
					playlist = m3u(body)
				} catch(e) {
					resolve([])
					return
				}
				const items = []
				let title
				let poster
				playlist.forEach(line => {
					if (typeof line == 'string') {
						if (config.style == 'Channels')
							items.push({
								id: prefix + 'url_' + encodeURIComponent(line),
								title
							})
						else if (config.style == 'Catalogs')
							items.push({
								id: prefix + 'url_' + idx + '_' + encodeURIComponent(btoa(line)),
								name: title,
								posterShape: 'square',
								poster: poster || undefined,
								type
							})
						title = false
						poster = false
					} else if (typeof line == 'object' && line.EXTINF) {
						for (let key in line.EXTINF)
							if (!title && !line.EXTINF[key])
								title = key
							else if (key.includes('tvg-logo') && line.EXTINF[key])
								poster = line.EXTINF[key]
					}
				})
				if (items.length)
					m3us[url] = items
				resolve(clone(items))
			} else
				resolve([])
		})
	})
}

let prefix, type, config

module.exports = {
	init: obj => {
		prefix = obj.prefix
		type = obj.type || 'tv'
		config = obj.config || { style: 'Catalogs' }
	},
	getM3U,
	processStream
}