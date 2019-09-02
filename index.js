const m3u = require('m3u8-reader')
const needle = require('needle')
const { config } = require('internal')

const defaults = {
	name: 'M3U Playlists',
	prefix: 'm3uplay_',
	icon: 'https://enjoy.zendesk.com/hc/article_attachments/360004422752/2149-m3u-image.jpg',
	paginate: 100
}

const m3us = {}

const catalogs = []

if (config.style == 'Catalogs')
	for (let i = 1; i < 6; i++)
		if (config['m3u_url_'+i])
			catalogs.push({
				name: config['m3u_name_'+i] || ('Unnamed #' + i),
				id: defaults.prefix + 'cat_' + i,
				type: 'tv',
				extra: [ { name: 'search' }, { name: 'skip' } ]
			})

function btoa(str) {
    var buffer;

    if (str instanceof Buffer) {
      buffer = str;
    } else {
      buffer = Buffer.from(str.toString(), 'binary');
    }

    return buffer.toString('base64');
}

function atob(str) {
    return Buffer.from(str, 'base64').toString('binary');
}

function getM3U(url, idx) {
	return new Promise((resolve, reject) => {
		if (m3us[url]) {
			resolve(m3us[url])
			return 
		}

		needle.get(url, (err, resp, body) => {
			if (!err && body) {
				const playlist = m3u(body)
				const items = []
				let title
				let poster
				playlist.forEach(line => {
					if (typeof line == 'string') {
						if (config.style == 'Channels')
							items.push({
								id: defaults.prefix + 'url_' + encodeURIComponent(line),
								title
							})
						else if (config.style == 'Catalogs')
							items.push({
								id: defaults.prefix + 'url_' + idx + '_' + encodeURIComponent(btoa(line)),
								name: title,
								posterShape: 'square',
								poster: poster || undefined,
								type: 'tv'
							})
						title = false
						poster = false
					} else if (typeof line == 'object' && line.EXTINF) {
						for (let key in line.EXTINF)
							if (!key.includes('tvg-id') && !key.includes('tvg-logo') && !title)
								title = key
							else if (key.includes('tvg-logo') && line.EXTINF[key])
								poster = line.EXTINF[key]

					}
				})
				if (items.length)
					m3us[url] = items
				resolve(items)
			}
		})
	})
}

const { addonBuilder, getInterface, getRouter } = require('stremio-addon-sdk')

if (!catalogs.length)
	catalogs.push({
		id: defaults.prefix + 'cat',
		name: 'M3U Playlists',
		type: 'tv',
		extra: [{ name: 'search' }]
	})

const types = ['tv']

if (config.style == 'Channels')
	types.push('channel')

const builder = new addonBuilder({
	id: 'org.' + defaults.name.toLowerCase().replace(/[^a-z]+/g,''),
	version: '1.0.0',
	name: defaults.name,
	description: 'Creates catalogs or channels based on M3U Playlists. Add M3U playlists to Stremio by URL, supports a maximum of 5 playlists and custom names',
	resources: ['stream', 'meta', 'catalog'],
	types,
	idPrefixes: [defaults.prefix],
	icon: defaults.icon,
	catalogs
})

builder.defineCatalogHandler(args => {
	return new Promise((resolve, reject) => {
		const extra = args.extra || {}

		if (config.style == 'Channels') {

			const metas = []

			for (let i = 1; i < 6; i++)
				if (config['m3u_url_'+i])
					metas.push({
						name: config['m3u_name_'+i] || ('Unnamed #' + i),
						id: defaults.prefix + i,
						type: 'channel',
						poster: defaults.icon,
						posterShape: 'landscape',
						background: defaults.icon,
						logo: defaults.icon
					})

			if (metas.length) {
				if (extra.search) {
					let results = []
					metas.forEach(meta => {
						if (meta.name.toLowerCase().includes(extra.search.toLowerCase()))
							results.push(meta)
					})
					if (results.length)
						resolve({ metas: results })
					else
						reject(defaults.name + ' - No search results for: ' + extra.search)
				} else
					resolve({ metas })
			} else
				reject(defaults.name + ' - No M3U URLs set')

		} else if (config.style == 'Catalogs') {

			const skip = parseInt(extra.skip || 0)
			const id = args.id.replace(defaults.prefix + 'cat_', '')

			getM3U(config['m3u_url_'+id], id).then(metas => {
				if (!metas.length)
					reject(defaults.name + ' - Could not get items from M3U playlist: ' + args.id)
				else {
					if (!extra.search)
						resolve({ metas: metas.slice(skip, skip + defaults.paginate) })
					else {
						let results = []
						metas.forEach(meta => {
							if (meta.name.toLowerCase().includes(extra.search.toLowerCase()))
								results.push(meta)
						})
						if (results.length)
							resolve({ metas: results })
						else
							reject(defaults.name + ' - No search results for: ' + extra.search)
					}
				}
			}).catch(err => {
				reject(err)
			})
		}
	})
})

builder.defineMetaHandler(args => {
	return new Promise((resolve, reject) => {
		if (config.style == 'Channels') {
			const i = args.id.replace(defaults.prefix, '')
			const meta = {
				name: config['m3u_name_'+i] || ('Unnamed #' + i),
				id: defaults.prefix + i,
				type: 'channel',
				poster: defaults.icon,
				posterShape: 'landscape',
				background: defaults.icon,
				logo: defaults.icon
			}
			getM3U(config['m3u_url_'+i]).then(videos => {
				meta.videos = videos
				resolve({ meta })
			}).catch(err => {
				reject(err)
			})
		} else if (config.style == 'Catalogs') {
			const i = args.id.replace(defaults.prefix + 'url_', '').split('_')[0]
			getM3U(config['m3u_url_'+i], i).then(metas => {
				let meta
				metas.some(el => {
					if (el.id == args.id) {
						meta = el
						return true
					}
				})
				if (meta)
					resolve({ meta })
				else
					reject(defaults.name + ' - Could not get meta item for: ' + args.id)
			}).catch(err => {
				reject(err)
			})
		}
	})
})

builder.defineStreamHandler(args => {
	return new Promise((resolve, reject) => {
		if (config.style == 'Channels') {
			const url = decodeURIComponent(args.id.replace(defaults.prefix + 'url_', ''))
			resolve({ streams: [{ url, title: 'Stream' }] })
		} else if (config.style == 'Catalogs') {
			const url = atob(decodeURIComponent(args.id.replace(defaults.prefix + 'url_', '').split('_')[1]))
			resolve({ streams: [{ url, title: 'Stream' }] })
		}
	})
})

const addonInterface = getInterface(builder)

module.exports = getRouter(addonInterface)
