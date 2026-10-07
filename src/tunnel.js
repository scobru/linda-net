import net from 'node:net'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import z32 from 'z32'
import DHT from 'hyperdht'

const pipe = (a, b) => {
  a.pipe(b).pipe(a)
  const end = () => { a.destroy(); b.destroy() }
  a.on('error', end); b.on('error', end); a.on('close', end); b.on('close', end)
}

/** Remote end: bridges an incoming tunnel stream to a TCP service on this machine (loopback by default). */
export const serveTunnel = (stream, { port, host = '127.0.0.1' }) => pipe(stream, net.connect(port, host))

/** Local end: listens on loopback and opens one tunnel stream per TCP client. */
export function listenTunnel (open, { port = 0 } = {}) {
  const server = net.createServer((local) => pipe(local, open()))
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port })))
}

export const toTunnelLink = (publicKey) => `linda-tunnel://${z32.encode(publicKey)}`
export const parseTunnelLink = (link) => z32.decode(link.replace(/^linda-tunnel:\/\//, ''))

// One stable identity per (storage, name): the link survives restarts.
async function keyPairFor (storage, name) {
  const f = path.join(storage, 'tunnel.seed')
  let seed
  try { seed = await fs.readFile(f) } catch {
    seed = crypto.randomBytes(32)
    await fs.mkdir(storage, { recursive: true })
    await fs.writeFile(f, seed, { mode: 0o600 })
  }
  return DHT.keyPair(crypto.createHash('sha256').update(seed).update(name).digest())
}

/**
 * Shares a local TCP port: anyone holding the link can reach it (the link is the secret).
 * Like a reverse proxy with no public IP and no port forwarding.
 */
export async function exposePort (node, port, { name = 'default' } = {}) {
  const keyPair = await keyPairFor(node.storage, name)
  const server = node.swarm.dht.createServer((stream) => serveTunnel(stream, { port }))
  await server.listen(keyPair)
  return { link: toTunnelLink(keyPair.publicKey), close: () => server.close() }
}

/** Opens `localhost:<port>` and forwards it to the exposed service behind `link`. */
export function connectPort (node, link, { port = 0 } = {}) {
  const publicKey = parseTunnelLink(link)
  return listenTunnel(() => node.swarm.dht.connect(publicKey), { port })
}
