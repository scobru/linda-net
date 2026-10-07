# linda-net design

## Pieces

| File | Role |
|---|---|
| `src/index.js` | `createNode` (one Corestore + one Hyperswarm), `publish`, `pin`, `createGateway`, link parsing |
| `src/sites.js` | local registry `<storage>/sites.json`: petname -> `{ key, enc? }` |
| `src/tunnel.js` | TCP tunnels over HyperDHT: `exposePort`, `connectPort` |
| `bin/linda-net.js` | CLI |

A node replicates every drive it opens and announces it on the DHT as both client and server, so reading a
site also re-hosts it for as long as the process runs.

## Links

- Site: `linda://<key>` where `<key>` is the drive's public key in z-base-32 (52 chars).
- Private site: `linda://<key>#<enc>`; `<enc>` is the 32-byte encryption key, z-base-32. It is never sent
  to the network, only stored in `sites.json` (mode 0600) and in the link you hand out.
- Tunnel: `linda-tunnel://<publicKey>` (HyperDHT server key, z-base-32).
- A bare `<key>` is accepted wherever a site link is.

## Publish

`publish <dir> --name n` mirrors `<dir>` into the single-writer Hyperdrive `store.namespace(n)`: files are
written, files no longer present are deleted. Same storage + same name = same key, so republishing keeps the
link. With `--private` (or if the name was ever private) the drive is created with an `encryptionKey`
and Hyperdrive encrypts every block; hosts and pinners see ciphertext only. A site cannot be made public
again under the same name.

## Gateway

HTTP server on `127.0.0.1` only. Request routing:

1. `Host` must be `localhost`, `*.localhost` or `127.0.0.1` (blocks DNS rebinding); otherwise 403.
2. Site = first label of `<label>.localhost`, or first path segment (`/<label>/...`).
3. `<label>` is a petname from `sites.json` or a z-base-32 key; unknown -> 400.
4. The drive is opened (with the stored encryption key if any), the DHT lookup is awaited, then the drive
   updates. No data within `timeoutMs` (15 s) -> 504.
5. `path/` serves `path/index.html`; `path` falls back to `path/index.html`; otherwise 404.
6. Range requests (206/416) and HEAD are supported. Responses carry `X-Content-Type-Options: nosniff`.

Each site gets its own browser origin (`<key>.localhost`), so sites cannot read each other's cookies or
storage. The path form shares one origin and is meant for quick checks.

## Tunnel

`expose <port>` runs a HyperDHT server whose key pair derives from `<storage>/tunnel.seed` and the tunnel
name, so the link is stable. Each incoming stream is piped to `127.0.0.1:<port>`. `connect <link>` listens
on a loopback port and opens one HyperDHT connection per local client. There is no authentication beyond
holding the link. Deleting `tunnel.seed` rotates the link.

## Threat model

Protects against: a server or DNS takedown (there is none), tampered content (blocks are verified against
the site key), hosts reading private sites, other sites reading your gateway cookies, web pages driving the
gateway through DNS rebinding.

Does not protect against: IP exposure to peers you connect to, a censor that blocks UDP or the DHT (no
fallback yet), traffic analysis, a leaked link (public or private), pinning content you did not review.

## Testing

`npm test` replicates over in-memory streams and runs tunnels over in-memory streams. Real holepunching is
not covered; test `publish` + `serve` and `expose` + `connect` across two machines before a release.

## Not built

WebSocket/TCP fallback for UDP-blocked networks, global signed names on the DHT, an OS `linda://` handler,
per-user tunnel authentication.
