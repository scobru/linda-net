import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import createTestnet from 'hyperdht/testnet.js'
import z32 from 'z32'
import { createNode, createGateway, publish, parseLink } from '../src/index.js'
import { loadSites, saveSite } from '../src/sites.js'

// fetch() will not send a custom Host header, and the gateway routes on it.
const request = (port, p, headers) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: p, headers }, (res) => {
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => resolve({
      status: res.statusCode,
      headers: { get: (n) => res.headers[n] },
      buf: Buffer.concat(chunks),
      text: async () => Buffer.concat(chunks).toString()
    }))
  }).on('error', reject)
})

const example = path.join(import.meta.dirname, '..', 'example')

test('publish a folder on one peer, read it over HTTP through another', async (t) => {
  const testnet = await createTestnet(3)
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'linda-net-'))
  const bootstrap = testnet.bootstrap
  const author = await createNode({ storage: path.join(tmp, 'a'), bootstrap })
  const reader = await createNode({ storage: path.join(tmp, 'b'), bootstrap })
  // Replicate over an in-memory pipe: this tests publish + gateway, not UDP holepunching,
  // which does not complete in every sandbox. Hyperswarm itself is exercised by real use.
  const ra = author.store.replicate(true)
  const rb = reader.store.replicate(false)
  ra.pipe(rb).pipe(ra)
  const gw = createGateway(reader, { port: 0, timeoutMs: 10000 })
  const port = await gw.listen()
  t.after(async () => {
    await gw.close(); await reader.close(); await author.close(); await testnet.destroy()
    await fs.rm(tmp, { recursive: true, force: true })
  })

  const { link, files } = await publish(author, example)
  assert.equal(files, 4)
  const label = link.replace('linda://', '')
  assert.equal(parseLink(link).key.length, 32)

  const get = (p, headers = {}) => request(port, p, { host: `${label}.localhost`, ...headers })

  const index = await get('/')
  assert.equal(index.status, 200)
  assert.match(index.headers.get('content-type'), /text\/html/)
  assert.match(await index.text(), /This page has no server/)

  assert.equal((await get('/assets/logo.svg')).headers.get('content-type'), 'image/svg+xml')
  assert.equal((await get('/nope')).status, 404)

  const css = await fs.readFile(path.join(example, 'style.css'))
  const part = await get('/style.css', { range: 'bytes=0-9' })
  assert.equal(part.status, 206)
  assert.equal(part.buf.toString(), css.subarray(0, 10).toString())

  // path style, and the host allowlist
  assert.equal((await request(port, `/${label}/about.html`, { host: 'localhost' })).status, 200)
  assert.equal((await request(port, '/', { host: 'evil.example' })).status, 403)

  // republish: same link, removed file disappears
  const v2 = path.join(tmp, 'v2')
  await fs.mkdir(v2)
  await fs.writeFile(path.join(v2, 'index.html'), '<h1>v2</h1>')
  assert.equal((await publish(author, v2)).link, link)
  assert.match(await (await get('/')).text(), /v2/)
  assert.equal((await get('/about.html')).status, 404)
})

test('private site: only a reader holding the key can open it; petnames resolve', async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'linda-net-'))
  const testnet = await createTestnet(3)
  const bootstrap = testnet.bootstrap
  const author = await createNode({ storage: path.join(tmp, 'a'), bootstrap })
  const reader = await createNode({ storage: path.join(tmp, 'b'), bootstrap })
  const stranger = await createNode({ storage: path.join(tmp, 'c'), bootstrap })
  for (const peer of [reader, stranger]) {
    const ra = author.store.replicate(true); const rp = peer.store.replicate(false)
    ra.pipe(rp).pipe(ra)
  }
  const gw = createGateway(reader, { port: 0, timeoutMs: 3000 })
  const gwStranger = createGateway(stranger, { port: 0, timeoutMs: 3000 })
  const [port, strangerPort] = [await gw.listen(), await gwStranger.listen()]
  t.after(async () => {
    await gw.close(); await gwStranger.close()
    await reader.close(); await stranger.close(); await author.close(); await testnet.destroy()
    await fs.rm(tmp, { recursive: true, force: true })
  })

  const { link } = await publish(author, example, { name: 'secret', private: true })
  assert.match(link, /^linda:\/\/[a-z0-9]{52}#[a-z0-9]+$/)
  assert.equal(parseLink(link).encryptionKey.length, 32)
  assert.equal((await loadSites(author.storage)).secret.enc.length > 0, true)

  // Reader saves the full link under a petname, then browses by name.
  const { key, encryptionKey } = parseLink(link)
  await saveSite(reader.storage, 'blog', { key: z32.encode(key), enc: z32.encode(encryptionKey) })
  const page = await request(port, '/', { host: 'blog.localhost' })
  assert.equal(page.status, 200)
  assert.match(await page.text(), /This page has no server/)

  // The same key without the decryption key reads nothing: the blocks are ciphertext.
  const blind = await request(strangerPort, '/', { host: `${z32.encode(key)}.localhost` })
  assert.notEqual(blind.status, 200)
  assert.doesNotMatch(await blind.text(), /This page has no server/)

  // Republishing without --private keeps it private.
  assert.match((await publish(author, example, { name: 'secret' })).link, /#/)
  assert.equal((await request(port, '/', { host: 'nobody.localhost' })).status, 400)
})
