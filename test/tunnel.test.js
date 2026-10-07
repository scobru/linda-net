import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { duplexPair } from 'node:stream'
import { serveTunnel, listenTunnel, toTunnelLink, parseTunnelLink } from '../src/tunnel.js'

// duplexPair does not propagate destroy(); a real transport (a HyperDHT stream) does.
const pair = () => {
  const [a, b] = duplexPair()
  a.on('close', () => b.destroy()); b.on('close', () => a.destroy())
  return [a, b]
}
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
const roundtrip = (port, msg) => new Promise((resolve, reject) => {
  const c = net.connect(port, '127.0.0.1')
  c.on('error', reject).on('data', (d) => { resolve(d.toString()); c.destroy() }).on('connect', () => c.write(msg))
})

test('a TCP service is reachable through a tunnel stream, several clients at once', async (t) => {
  const echo = net.createServer((s) => s.pipe(s))
  const echoPort = await listen(echo)
  // The tunnel stream is an in-memory pair here; in production it is a HyperDHT connection.
  const { server, port } = await listenTunnel(() => {
    const [local, remote] = pair()
    serveTunnel(remote, { port: echoPort })
    return local
  })
  t.after(() => { server.close(); echo.close() })

  const replies = await Promise.all(['one', 'two', 'three'].map((m) => roundtrip(port, m)))
  assert.deepEqual(replies, ['one', 'two', 'three'])
})

test('a dead target closes the tunnel instead of hanging', async (t) => {
  const dead = net.createServer(); const deadPort = await listen(dead); dead.close()
  const { server, port } = await listenTunnel(() => {
    const [local, remote] = pair()
    serveTunnel(remote, { port: deadPort })
    return local
  })
  t.after(() => server.close())
  await new Promise((resolve) => {
    const c = net.connect(port, '127.0.0.1').on('close', resolve).on('error', () => {})
    c.write('x')
  })
})

test('tunnel links round-trip', () => {
  const key = Buffer.alloc(32, 9)
  assert.deepEqual(parseTunnelLink(toTunnelLink(key)), key)
})
