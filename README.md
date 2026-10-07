# linda-net

Publish a website from a folder, read it from a link. No server, no DNS, no hosting account.
A companion service to [Linda](https://github.com/scobru/linda), built on the same Holepunch
stack (Hyperswarm, Hyperdrive, Corestore).

```
linda-net publish example        # -> linda://<key>   (keeps seeding)
linda-net serve                  # local gateway on http://localhost:7777
# open http://<key>.localhost:7777/
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

## How it works

- `publish` mirrors a folder into a single-writer Hyperdrive. The site's address is the drive's
  public key, so republishing keeps the link and readers get the new version.
- `serve` runs an HTTP gateway bound to loopback. It finds peers for the key on the DHT, replicates
  the drive and serves files (range requests included). Every block is verified against the key.
  Each site gets its own origin (`<key>.localhost`), so sites cannot read each other's cookies.
- `--private` encrypts the drive. The decryption key is the part of the link after `#`; hosts and pinners only see ciphertext. `add --name` stores the key locally and gives the site a short name (`<name>.localhost`).
- `expose` / `connect` is a TCP tunnel (any protocol: HTTP, SSH...) over a HyperDHT connection, no public IP or port forwarding. The tunnel link is the secret: anyone holding it reaches the port.
- Reading a site re-hosts it while the gateway runs; `pin` does it on purpose and downloads everything.

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
