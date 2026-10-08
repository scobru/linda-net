#!/usr/bin/env node
import z32 from 'z32'
import { createNode, createGateway, publish, pin, parseLink, DEFAULT_STORAGE, DEFAULT_PORT } from '../src/index.js'
import { loadSites, saveSite } from '../src/sites.js'
import { exposePort, connectPort } from '../src/tunnel.js'

const USAGE = `sites
  linda-net publish <dir> [--name site] [--private]   publish a folder, print its link, keep seeding
  linda-net serve [--port ${DEFAULT_PORT}]                      local gateway: http://<key|name>.localhost:${DEFAULT_PORT}/
  linda-net open <link> [--port ${DEFAULT_PORT}]                 read a site: start the gateway and print its URL, one step
  linda-net pin <link>                                 download a site and keep seeding it
  linda-net add <link> --name <petname>                save a site (and its key, if private) under a short name
  linda-net list                                       sites known to this machine
tunnels
  linda-net expose <port> [--name tunnel]              share a local TCP port, print a linda-tunnel:// link
  linda-net connect <linda-tunnel-link> [--port n]     open that port on localhost

options: --storage <dir> (default ${DEFAULT_STORAGE}), --bootstrap host:port`

process.on('uncaughtException', (e) => { console.error(`error: ${e.message}`); process.exit(1) })

const argv = process.argv.slice(2)
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i < 0 ? undefined : argv.splice(i, 2)[1] }
const bool = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv.splice(i, 1).length === 1 }
const opts = { storage: flag('storage') ?? DEFAULT_STORAGE, name: flag('name'), port: flag('port'), bootstrap: flag('bootstrap'), private: bool('private') }
const [cmd, arg] = argv
const needsArg = ['publish', 'open', 'pin', 'add', 'expose', 'connect']
if (![...needsArg, 'serve', 'list'].includes(cmd) || (needsArg.includes(cmd) && !arg)) { console.error(USAGE); process.exit(1) }

if (cmd === 'list') {
  for (const [name, s] of Object.entries(await loadSites(opts.storage))) console.log(`${name}\tlinda://${s.key}${s.enc ? ' (private)' : ''}`)
  process.exit(0)
}
if (cmd === 'add') {
  const { key, encryptionKey } = parseLink(arg)
  const name = opts.name?.toLowerCase() // hostnames are case-insensitive
  if (!name || !/^[a-z0-9-]{1,40}$/.test(name) || name.length === 52) { // 52 chars would be read as a key
    console.error('--name must be 1-40 chars of a-z, 0-9, -'); process.exit(1)
  }
  await saveSite(opts.storage, name, { key: z32.encode(key), enc: encryptionKey && z32.encode(encryptionKey) })
  console.log(`saved: http://${name}.localhost:${DEFAULT_PORT}/`)
  process.exit(0)
}

const node = await createNode({ storage: opts.storage, bootstrap: opts.bootstrap && [opts.bootstrap] })
process.once('SIGINT', async () => { await node.close(); process.exit(0) })

if (cmd === 'publish') {
  const { link, files } = await publish(node, arg, { name: opts.name, private: opts.private })
  console.log(`${link}\n${files} files. Seeding; Ctrl+C to stop. Read it with: linda-net serve`)
  if (link.includes('#')) console.log('Private: the part after # is the decryption key. Anyone with the full link can read the site.')
} else if (cmd === 'pin') {
  await pin(node, arg)
  console.log('pinned, seeding; Ctrl+C to stop')
} else if (cmd === 'expose') {
  const { link } = await exposePort(node, +arg, { name: opts.name })
  console.log(`${link}\nSharing localhost:${arg}. Anyone with this link can reach it; Ctrl+C to stop.`)
} else if (cmd === 'connect') {
  const { port } = await connectPort(node, arg, { port: opts.port ? +opts.port : 0 })
  console.log(`localhost:${port} -> ${arg}`)
} else if (cmd === 'open') {
  const { key, encryptionKey } = parseLink(arg)
  const id = z32.encode(key)
  if (encryptionKey) await saveSite(opts.storage, id, { key: id, enc: z32.encode(encryptionKey) }) // gateway finds the key by label
  const port = await createGateway(node, { port: opts.port ? +opts.port : DEFAULT_PORT }).listen()
  console.log(`http://${id}.localhost:${port}/  (Ctrl+C to stop; reading also re-hosts the site)`)
} else {
  const gw = createGateway(node, { port: opts.port ? +opts.port : DEFAULT_PORT })
  const port = await gw.listen()
  console.log(`gateway on http://localhost:${port}/  (sites: http://<key|name>.localhost:${port}/)`)
}
