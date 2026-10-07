import fs from 'node:fs/promises'
import path from 'node:path'
import z32 from 'z32'

// Local registry: petname -> { key, enc? }. `enc` is the encryption key of a private site.
const file = (storage) => path.join(storage, 'sites.json')

export async function loadSites (storage) {
  try { return JSON.parse(await fs.readFile(file(storage), 'utf8')) } catch { return {} }
}

export async function saveSite (storage, name, site) {
  const sites = await loadSites(storage)
  sites[name] = site
  await fs.mkdir(storage, { recursive: true })
  await fs.writeFile(file(storage), JSON.stringify(sites, null, 2), { mode: 0o600 })
}

/** A gateway label is either a petname or a z32 key; returns { key, encryptionKey? } or null. */
export async function resolveSite (storage, label) {
  const sites = await loadSites(storage)
  const byName = Object.hasOwn(sites, label) ? sites[label] : null
  let key = byName && z32.decode(byName.key)
  if (!key) { try { key = z32.decode(label) } catch { return null } }
  if (key.length !== 32) return null
  const enc = byName?.enc ?? Object.values(sites).find((s) => s.key === z32.encode(key))?.enc
  return { key, encryptionKey: enc ? z32.decode(enc) : undefined }
}
