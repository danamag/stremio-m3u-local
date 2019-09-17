const m3u = require('m3u8-reader')
const needle = require('needle')
const async = require('async')
const base64 = require('base-64')
const { config, proxy } = require('internal')
const hls = require('./hls')

const defaults = {
	name: 'M3U Playlists',
	prefix: 'm3uplay_',
	icon: 'https://enjoy.zendesk.com/hc/article_attachments/360004422752/2149-m3u-image.jpg',
	paginate: 100
}

hls.init({ prefix: defaults.prefix, type: 'tv', config })

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

			hls.getM3U(config['m3u_url_'+id], id).then(metas => {
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
			hls.getM3U(config['m3u_url_'+i]).then(videos => {
				const dups = []
				meta.videos = videos.filter(el => {
					if (!dups.includes(el.title)) {
						dups.push(el.title)
						return true
					}
					return false
				}).map(el => {
					el.id = defaults.prefix + 'data_' + base64.encode(i + '|||' + el.title)
					return el
				})
				resolve({ meta })
			}).catch(err => {
				reject(err)
			})
		} else if (config.style == 'Catalogs') {
			const i = args.id.replace(defaults.prefix + 'url_', '').split('_')[0]
			hls.getM3U(config['m3u_url_'+i], i).then(metas => {
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
	return new Promise(async (resolve, reject) => {
		if (config.style == 'Channels') {
			const data = base64.decode(decodeURIComponent(args.id.replace(defaults.prefix + 'data_', '')))
			const idx = data.split('|||')[0]
			const title = data.split('|||')[1]
			hls.getM3U(config['m3u_url_'+idx]).then(videos => {
				videos = videos.filter(el => { return el.title == title })

				if (!(videos || []).length) {
					resolve({ streams: [] })
					return
				}

				let streams = []

				const queue = async.queue((task, cb) => {
					const url = decodeURIComponent(task.id.replace(defaults.prefix + 'url_', ''))
					hls.processStream(proxy.addProxy(url)).then(results => {
						streams = streams.concat(results || [])
						cb()
					}).catch(e => { cb() })
				}, 10)

				queue.drain = () => {
					let streamIdx = 1
					streams = streams.map(el => {
						if (el.title.startsWith('Stream')) {
							el.title = 'Stream #' + streamIdx
							streamIdx++
						}
						return el
					})
					resolve({ streams })
				}

				videos.forEach(el => { queue.push(el) })

			}).catch(err => {
				reject(err)
			})
		} else if (config.style == 'Catalogs') {
			const url = base64.decode(decodeURIComponent(args.id.replace(defaults.prefix + 'url_', '').split('_')[1]))
			const streams = await hls.processStream(proxy.addProxy(url))
			resolve({ streams: streams || [] })
		}
	})
})

const addonInterface = getInterface(builder)

module.exports = getRouter(addonInterface)
