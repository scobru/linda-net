import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'
import Hyperswarm from 'hyperswarm'
import z32 from 'z32'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { loadSites, saveSite, resolveSite } from './sites.js'

export const DEFAULT_STORAGE = path.join(os.homedir(), '.linda-net')
export const DEFAULT_PORT = 7777

const MIME = {
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8', json: 'application/json', svg: 'image/svg+xml', txt: 'text/plain; charset=utf-8',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon',
  woff2: 'font/woff2', woff: 'font/woff', mp3: 'audio/mpeg', mp4: 'video/mp4', webm: 'video/webm', wasm: 'application/wasm'
}

/** Private sites carry their encryption key in the fragment: `linda://<key>#<enc>`. */
export const toLink = (key, enc) => `linda://${z32.encode(key)}${enc ? '#' + z32.encode(enc) : ''}`

/** Accepts `linda://<z32>[#<enc>]` or the bare z32 key. */
export function parseLink (link) {
  const [id, enc] = link.replace(/^linda:\/\//, '').replace(/\/.*?(#|$)/, '$1').split('#')
  const key = z32.decode(id)
  if (key.length !== 32) throw new Error(`not a linda-net link: ${link}`)
  return enc ? { key, encryptionKey: z32.decode(enc) } : { key }
}

/**
 * One corestore + one swarm. `bootstrap` overrides the public DHT (tests, private networks).
 * Every drive opened here is announced as a server too: reading a site means re-serving it.
 */
export async function createNode ({ storage = DEFAULT_STORAGE, bootstrap } = {}) {
  const store = new Corestore(storage)
  const swarm = new Hyperswarm({ bootstrap })
  swarm.on('connection', (socket) => store.replicate(socket))
  const drives = new Map()

  async function open (key, { name, encryptionKey } = {}) {
    const id = key ? z32.encode(key) : `name:${name}`
    if (drives.has(id)) return drives.get(id)
    const drive = key ? new Hyperdrive(store, key, { encryptionKey }) : new Hyperdrive(store.namespace(name), { encryptionKey })
    await drive.ready()
    const entry = drive.discoveryKey && { drive, discovery: swarm.join(drive.discoveryKey, { client: true, server: true }) }
    drives.set(z32.encode(drive.key), entry)
    drives.set(id, entry)
    return entry
  }

  return {
    storage, store, swarm, open,
    async close () {
      await swarm.destroy()
      await store.close()
    }
  }
}

async function* walk (dir, base = dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) yield * walk(full, base)
    else if (e.isFile()) yield path.relative(base, full).split(path.sep).join('/')
  }
}

/**
 * Mirrors `dir` into the single-writer drive named `name`. The link stays the same across
 * republishes (same storage + name = same key); files removed from `dir` are removed from the site.
 */
export async function publish (node, dir, { name = 'default', private: isPrivate = false } = {}) {
  // A site that was ever private stays private: its core is encrypted from the first block.
  const known = (await loadSites(node.storage))[name]
  const encryptionKey = known?.enc ? z32.decode(known.enc) : isPrivate ? crypto.randomBytes(32) : undefined
  const { drive, discovery } = await node.open(null, { name, encryptionKey })
  const seen = new Set()
  for await (const rel of walk(dir)) {
    const file = '/' + rel
    seen.add(file)
    await drive.put(file, await fs.readFile(path.join(dir, rel)))
  }
  for await (const { key } of drive.list('/')) if (!seen.has(key)) await drive.del(key)
  await discovery.flushed()
  await saveSite(node.storage, name, { key: z32.encode(drive.key), enc: encryptionKey && z32.encode(encryptionKey) })
  return { link: toLink(drive.key, encryptionKey), files: seen.size }
}

/** Downloads a whole site and keeps seeding it. */
export async function pin (node, link) {
  const { key, encryptionKey } = parseLink(link)
  const { drive, discovery } = await node.open(key, { encryptionKey })
  await discovery.flushed()
  await node.swarm.flush()
  await drive.update({ wait: true })
  await drive.download('/')
  return drive
}

const sniff = (file) => MIME[file.split('.').pop().toLowerCase()] ?? 'application/octet-stream'

/** `<key>.localhost:<port>/path` (one origin per site) or `/<key>/path`. Binds to loopback only. */
export function createGateway (node, { port = DEFAULT_PORT, timeoutMs = 15000 } = {}) {
  const server = http.createServer(async (req, res) => {
    const send = (code, msg) => { res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' }); res.end(msg) }
    try {
      // Host allowlist: loopback names only, so a rebinding page can't drive the gateway.
      const host = (req.headers.host ?? '').replace(/:\d+$/, '')
      if (host !== 'localhost' && !host.endsWith('.localhost') && host !== '127.0.0.1') return send(403, 'forbidden host')

      let label = host.endsWith('.localhost') ? host.slice(0, -'.localhost'.length) : null
      let pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname)
      if (!label) {
        const m = pathname.match(/^\/([^/]+)(\/.*)?$/)
        if (!m) return send(200, 'linda-net gateway: open /<key>/ or <key>.localhost')
        label = m[1]
        pathname = m[2] ?? '/'
        if (!m[2]) { res.writeHead(301, { location: `/${label}/` }); return res.end() }
      }

      const site = await resolveSite(node.storage, label)
      if (!site) return send(400, 'unknown site: use a key or a name added with `linda-net add`')
      const { drive, discovery } = await node.open(site.key, { encryptionKey: site.encryptionKey })
      // Let the DHT lookup finish and the first peers connect, then pull the latest version.
      await Promise.race([
        discovery.flushed().then(() => node.swarm.flush()).then(() => drive.update({ wait: true })),
        new Promise((resolve) => setTimeout(resolve, timeoutMs))
      ])
      if (drive.version === 0) return send(504, 'no peer is hosting this site right now')

      const clean = path.posix.normalize(pathname)
      let file = clean.endsWith('/') ? clean + 'index.html' : clean
      let entry = await drive.entry(file)
      if (!entry && !clean.endsWith('/')) entry = await drive.entry((file = clean + '/index.html'))
      if (!entry) return send(404, 'not found')

      const size = entry.value.blob.byteLength
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
      let start = 0; let end = size - 1; let status = 200
      if (range && (range[1] || range[2])) {
        if (range[1]) { start = +range[1]; if (range[2]) end = Math.min(+range[2], size - 1) } else start = Math.max(0, size - +range[2])
        if (start > end || start >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end() }
        status = 206
      }
      const headers = {
        'content-type': sniff(file), 'content-length': end - start + 1, 'accept-ranges': 'bytes',
        'x-content-type-options': 'nosniff'
      }
      if (status === 206) headers['content-range'] = `bytes ${start}-${end}/${size}`
      res.writeHead(status, headers)
      if (req.method === 'HEAD' || size === 0) return res.end()
      const stream = drive.createReadStream(file, { start, end })
      stream.on('error', () => res.destroy())
      stream.pipe(res)
    } catch (err) {
      console.error(err)
      if (err.message?.includes('could not be locked')) return send(500, 'storage is in use by another linda-net process: run serve with --storage <other dir>')
      if (!res.headersSent) send(500, 'gateway error')
      else res.destroy()
    }
  })
  return {
    server,
    listen: () => new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server.address().port))),
    close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections() })
  }
}
