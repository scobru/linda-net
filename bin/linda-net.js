#!/usr/bin/env node
import { createNode, createGateway, publish, pin, DEFAULT_STORAGE, DEFAULT_PORT } from '../src/index.js'

const USAGE = `linda-net publish <dir> [--name site]   publish a folder, print its linda:// link, keep seeding
linda-net serve [--port ${DEFAULT_PORT}]         local gateway: http://<key>.localhost:${DEFAULT_PORT}/
linda-net pin <link>                    download a site and keep seeding it

options: --storage <dir> (default ${DEFAULT_STORAGE}), --bootstrap host:port`

const argv = process.argv.slice(2)
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i < 0 ? undefined : argv.splice(i, 2)[1] }
const opts = { storage: flag('storage'), name: flag('name'), port: flag('port'), bootstrap: flag('bootstrap') }
const [cmd, arg] = argv
if (!['publish', 'serve', 'pin'].includes(cmd) || (cmd !== 'serve' && !arg)) { console.error(USAGE); process.exit(1) }

const node = await createNode({ storage: opts.storage, bootstrap: opts.bootstrap && [opts.bootstrap] })
process.once('SIGINT', async () => { await node.close(); process.exit(0) })

if (cmd === 'publish') {
  const { link, files } = await publish(node, arg, { name: opts.name })
  console.log(`${link}\n${files} files. Seeding; Ctrl+C to stop. Read it with: linda-net serve`)
} else if (cmd === 'pin') {
  await pin(node, arg)
  console.log('pinned, seeding; Ctrl+C to stop')
} else {
  const gw = createGateway(node, { port: opts.port ? +opts.port : DEFAULT_PORT })
  const port = await gw.listen()
  console.log(`gateway on http://localhost:${port}/  (sites: http://<key>.localhost:${port}/)`)
}
