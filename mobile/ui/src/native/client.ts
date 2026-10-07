// plans/UPDATE.md client manifest sync, ported for Android (same schema-2 manifest, same sha256 rules as launcher/electron/update.ts).
import { fs, download } from './native'
import { getJson, UPDATE_BASE } from './net'
import { mcMatches } from './mcrange'

export interface ManifestFile { path: string; url: string; sha256: string; size?: number; mc?: string; rep?: string }
export interface Manifest { version: string; mc?: string; schema?: number; notes?: string; files: ManifestFile[]; targets?: ManifestFile[] }
export interface SyncResult { ok: boolean; offline: boolean; unsupported?: boolean; version?: string; changed: boolean; notes?: string; error?: string }

const join = (...p: string[]) => p.join('/').replace(/\/+/g, '/')
const LEGACY_MC = '1.21.11'

export const cmpVer = (a: string, b: string) => {
  const pa = String(a).split(/[.\-+]/).map((x) => parseInt(x) || 0), pb = String(b).split(/[.\-+]/).map((x) => parseInt(x) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d < 0 ? -1 : 1 }
  return 0
}

export async function fetchManifest(): Promise<Manifest | null> {
  try {
    const m = await getJson<Manifest>(UPDATE_BASE + '/client/manifest.json?t=' + Math.floor(Date.now() / 60000), 'Client manifesti', { timeoutMs: 6000, attempts: 1 })
    if (!m || typeof m.version !== 'string' || !Array.isArray(m.files)) return null
    return m
  } catch { return null }
}
export const manifestEntries = (m: Manifest): ManifestFile[] => (m.targets?.length ? m.targets : m.files.map((f) => ({ ...f, mc: f.mc || m.mc || LEGACY_MC })))
export const entriesFor = (m: Manifest, mc: string) => {
  const best = new Map<string, ManifestFile>()
  const rank = (f: ManifestFile) => (f.rep === mc ? 2 : f.rep && cmpVer(f.rep, mc) <= 0 ? 1 : 0)
  for (const f of manifestEntries(m)) {
    if (!mcMatches(f.mc, mc)) continue
    const cur = best.get(f.path)
    if (!cur || rank(f) > rank(cur) || (rank(f) === rank(cur) && f.rep && cur.rep && cmpVer(f.rep, cur.rep) > 0)) best.set(f.path, f)
  }
  return [...best.values()]
}
export const supportedReps = (m: Manifest) => [...new Set(manifestEntries(m).map((f) => f.rep || (/^[\d.]+$/.test(String(f.mc)) ? String(f.mc) : '')).filter(Boolean))]
let manCache: { t: number; m: Manifest | null } | null = null
export async function cachedManifest(): Promise<Manifest | null> {
  if (manCache && Date.now() - manCache.t < 5 * 60e3 && manCache.m) return manCache.m
  const m = await fetchManifest(); manCache = { t: Date.now(), m }; return m
}
export const installedVersion = async (gameDir: string) => ((await fs.read(join(gameDir, 'vtclient', 'client-version.txt'))) || '').trim()

const shaOf = async (f: string) => { try { return (await fs.exists(f)) ? await fs.sha(f, 'sha256') : '' } catch { return '' } }

/** Downloads the files for the profile's MC version (sha256 checked) into <root>/client/<version>/mc<rep>/ and copies them into the game dir. */
export async function syncClient(o: { root: string; gameDir: string; mc: string; log: (...a: any[]) => void; progress: (t: string) => void }): Promise<SyncResult> {
  const { root, gameDir, mc, log, progress } = o
  const man = await fetchManifest()
  if (!man) {
    log('[update] manifest alınamadı (çevrimdışı) - önbellek kullanılıyor')
    await restoreFromCache(root, gameDir, mc, log)
    return { ok: true, offline: true, changed: false, version: (await installedVersion(gameDir)) || undefined }
  }
  const entries = entriesFor(man, mc)
  if (!entries.length) { await fs.rm(join(gameDir, 'vtclient', 'client-version.txt')); return { ok: true, offline: false, unsupported: true, changed: false } }
  const cache = join(root, 'client', man.version.replace(/[^\w.\-]/g, '_'), 'mc' + (entries[0].rep || mc).replace(/[^\w.\-]/g, '_'))
  await fs.mkdir(cache)
  let changed = false
  try {
    const staged: { dest: string; src: string }[] = []
    for (const f of entries) {
      const rel = f.path.replace(/\\/g, '/')
      if (!/^(mods|vtclient)\//.test(rel) || rel.includes('..')) continue
      const cached = join(cache, rel.split('/').pop()!)
      if ((await shaOf(cached)) !== f.sha256.toLowerCase()) {
        progress(`Client güncelleniyor (v${man.version}): ${rel.split('/').pop()}`)
        await download({ url: f.url, dest: cached, sha256: f.sha256.toLowerCase(), timeoutMs: 120000 })
      }
      staged.push({ dest: join(gameDir, rel), src: cached })
    }
    for (const s of staged) {
      if ((await shaOf(s.dest)) !== (await shaOf(s.src))) {
        if (s.dest.includes('/mods/')) {
          const dir = s.dest.slice(0, s.dest.lastIndexOf('/')); const name = s.dest.split('/').pop()!
          const fam = name.replace(/[-_]?v?\d.*$/i, '').toLowerCase()
          for (const e of await fs.list(dir)) if (fam && e.name.toLowerCase().startsWith(fam) && e.name !== name && /\.jar$/i.test(e.name)) await fs.rm(join(dir, e.name))
        }
        await fs.mkdir(s.dest.slice(0, s.dest.lastIndexOf('/')))
        await fs.copy(s.src, s.dest); changed = true
      }
    }
    await fs.mkdir(join(gameDir, 'vtclient'))
    await fs.write(join(gameDir, 'vtclient', 'client-version.txt'), man.version)
    return { ok: true, offline: false, version: man.version, changed, notes: man.notes }
  } catch (e: any) {
    log('[update] client güncellemesi başarısız', e)
    return { ok: false, offline: false, changed, error: String(e?.message || e), version: (await installedVersion(gameDir)) || undefined }
  }
}

async function restoreFromCache(root: string, gameDir: string, mc: string, log: (...a: any[]) => void) {
  try {
    const base = join(root, 'client')
    const vers = (await fs.list(base)).filter((e) => e.isDir).map((e) => e.name).sort(cmpVer)
    for (const v of vers.reverse()) {
      const sub = (await fs.list(join(base, v))).filter((e) => e.isDir && e.name.startsWith('mc'))
      const pick = sub.find((e) => e.name === 'mc' + mc) || sub.filter((e) => cmpVer(e.name.slice(2), mc) <= 0).sort((a, b) => cmpVer(a.name, b.name)).pop()
      if (!pick) continue
      const modsDir = join(gameDir, 'mods'); await fs.mkdir(modsDir)
      for (const f of await fs.list(join(base, v, pick.name))) if (/\.jar$/i.test(f.name)) await fs.copy(join(base, v, pick.name, f.name), join(modsDir, f.name))
      await fs.mkdir(join(gameDir, 'vtclient')); await fs.write(join(gameDir, 'vtclient', 'client-version.txt'), v)
      return
    }
  } catch (e) { log('[update] önbellek yok', e) }
}
