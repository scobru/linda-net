# linda-net

Publish a website from a folder, read it from a link. No server, no DNS, no hosting account.
A companion service to [Linda](https://github.com/scobru/linda), built on the same Holepunch
stack (Hyperswarm, Hyperdrive, Corestore).

```
linda-net publish example        # -> linda://<key>   (keeps seeding)
linda-net serve                  # local gateway on http://localhost:7777
# open http://<key>.localhost:7777/
linda-net pin linda://<key>      # host someone else's site too
```

## How it works

- `publish` mirrors a folder into a single-writer Hyperdrive. The site's address is the drive's
  public key, so republishing keeps the link and readers get the new version.
- `serve` runs an HTTP gateway bound to loopback. It finds peers for the key on the DHT, replicates
  the drive and serves files (range requests included). Every block is verified against the key.
  Each site gets its own origin (`<key>.localhost`), so sites cannot read each other's cookies.
- Reading a site re-hosts it while the gateway runs; `pin` does it on purpose and downloads everything.

Try it with the [`example/`](example) folder: a small static page with a stylesheet, an image and a
second page.

## Limits (v1)

- A site is reachable only while some peer hosts it. If the author and every reader are offline, the
  link does not open. Pin sites you care about.
- Static sites only. Dynamic apps (`expose <port>` tunnel), signed names on the DHT, private sites and
  a WebSocket fallback for networks that block UDP are not built yet.
- Not anonymous: peers you connect to can see your IP address.
- Content is public to anyone with the link, and you serve what you pin. Pin only what you are ok hosting.

## Develop

```
npm install
npm test
```

The test publishes `example/` on one node and reads it over HTTP through another, replicating over an
in-memory pipe. Real holepunching is not covered by it.

License: ISC.
