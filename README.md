# linda-net

Send a website the way you send a file: publish a folder, share a link, the site travels peer to peer.
No server, no DNS, no hosting account. **It stays online only while some peer hosts it** (the author's
terminal, or a machine running `pin`). A companion service to [Linda](https://github.com/scobru/linda), built on the same Holepunch
stack (Hyperswarm, Hyperdrive, Corestore).

```
linda-net publish example        # -> linda://<key>   (keeps seeding)
linda-net open linda://<key>     # reader: one step, prints http://<key>.localhost:7777/
linda-net serve                  # or: a gateway for several sites (names, many links)
linda-net pin linda://<key>      # host someone else's site too

linda-net publish notes --private   # -> linda://<key>#<decryption key>
linda-net add 'linda://<key>#<dk>' --name notes   # then http://notes.localhost:7777/
linda-net list

linda-net expose 3000            # share a local TCP port -> linda-tunnel://<key>
linda-net connect linda-tunnel://<key> --port 3000   # on the other machine
```

## Two things, two link types

| | `publish` / `serve` | `expose` / `connect` |
|---|---|---|
| Shares | a **folder** of static files (copied into a Hyperdrive) | a **live TCP port** on your machine (nothing is copied) |
| Link | `linda://<key>` | `linda-tunnel://<key>` |
| Reader uses | `serve`, then `http://<key>.localhost:7777/` in a browser | `connect <link> --port N`, then any client on `localhost:N` |
| Works when | any peer hosts it, author may be offline | the machine running `expose` is online |

The two links are not interchangeable: `connect` rejects a `linda://` link and `serve` does not open a `linda-tunnel://` one.

Two processes cannot share one storage dir (`~/.linda-net` by default). Running `publish` and `serve` on the same machine needs `--storage <other dir>` on one of them.

## Quick start (two machines)

The usual case. No `--storage` tricks needed: each machine has its own `~/.linda-net`.

```
# machine A: publish and keep the terminal open
linda-net publish ./mysite --name mysite
#   -> linda://<key>   (send this link to the reader)

# machine B: install linda-net, then
linda-net serve
# open http://<key>.localhost:7777/
```

The gateway listens on `localhost` only, so every reader runs `serve` on their own machine: you share the `linda://` link, not a web address. Machine B finds machine A through the DHT.

For a private site machine B runs `linda-net add "linda://<key>#<decryption key>" --name notes`, then `serve`, and opens `http://notes.localhost:7777/`.

The site opens only while some machine hosts it. If A is off, B sees `no peer is hosting this site right now`, unless a third machine keeps it with `linda-net pin <link>`.

## Quick start (same machine, for testing)

Every command stores its data in `--storage` (default `~/.linda-net`), and **only one process can use a storage at a time**. So use one storage per terminal, and pass the same `--storage` to the commands that must share data:

```
# terminal 1: publish and keep seeding
linda-net publish ./mysite --name mysite
#   -> linda://<key>

# terminal 2: read it (its own storage)
linda-net serve --storage ~/linda-serve
# open http://<key>.localhost:7777/
```

Private site, with a short name (note the quotes: `#` starts a comment in some shells, and `add` must use the same `--storage` as `serve`):

```
linda-net publish ./notes --private --name notes
#   -> linda://<key>#<decryption key>
linda-net add "linda://<key>#<decryption key>" --name notes --storage ~/linda-serve
linda-net serve --storage ~/linda-serve
# open http://notes.localhost:7777/
```

## Troubleshooting

| You see | Why | Fix |
|---|---|---|
| `gateway error` / `storage is in use by another linda-net process` | two processes share one storage | give one of them `--storage <other dir>` |
| `unknown site: use a key or a name added with linda-net add` | the name was saved in a different storage than `serve` uses | run `add` with the same `--storage` as `serve` |
| `no peer is hosting this site right now` | nobody is seeding it | keep `publish` running (or `pin` it elsewhere) |
| `site "default" is already public and can't become private` | `--private` without `--name` reuses the name `default` | pick a new `--name` |
| `not a tunnel link` | `connect` got a `linda://` site link | tunnels come from `expose` and start with `linda-tunnel://` |
| `Invalid character in base32 input` | the link is mistyped or truncated | copy the whole link, in quotes |

The site stays online only while a peer seeds it: keep the `publish` terminal open. A private link includes its decryption key: treat it like a password.

## How it works

- `publish` mirrors a folder into a single-writer Hyperdrive. The site's address is the drive's
  public key, so republishing keeps the link and readers get the new version.
- `serve` runs an HTTP gateway bound to loopback. It finds peers for the key on the DHT, replicates
  the drive and serves files (range requests included). Every block is verified against the key.
  Each site gets its own origin (`<key>.localhost`), so sites cannot read each other's cookies.
- `--private` encrypts the drive. The decryption key is the part of the link after `#`; hosts and pinners only see ciphertext. `add --name` stores the key locally and gives the site a short name (`<name>.localhost`).
- `expose` / `connect` is a TCP tunnel (any protocol: HTTP, SSH...) over a HyperDHT connection, no public IP or port forwarding. The tunnel link is the secret: anyone holding it reaches the port.
- Reading a site re-hosts it while the gateway runs; `pin` does it on purpose and downloads everything.

The [`landing/`](landing) folder is a landing page: `linda-net publish landing` hosts it with linda-net itself.

Try it with the [`example/`](example) folder: a small static page with a stylesheet, an image and a
second page.

## Limits

- A site is reachable only while some peer hosts it. If the author and every reader are offline, the
  link does not open. Pin sites you care about.
- Not anonymous: peers you connect to can see your IP address.
- Content is public to anyone with the link (private sites: to anyone with the full link), and you serve what you pin. Pin only what you are ok hosting.
- Networks that block UDP cannot reach the DHT. `--bootstrap host:port` points at your own bootstrap node, but
  there is no WebSocket/TCP fallback yet.
- Names are local petnames, not global. A `linda://` handler for the OS is not shipped: paste links into
  `add` or the gateway URL.
- A `expose` tunnel has no per-user auth; rotate it by deleting `<storage>/tunnel.seed`.

## Develop

```
npm install
npm test
```

Tests publish `example/` (public and private) on one node and read it over HTTP through another, and run the
tunnel over in-memory streams. Real holepunching is not covered: try `publish` and `serve` on two machines.

Design, link formats and threat model: [docs/design.md](docs/design.md).

License: ISC.
