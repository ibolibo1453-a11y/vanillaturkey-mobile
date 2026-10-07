// Modrinth browser backend for Android (port of launcher/electron/modrinth.ts on top of the Kotlin fs/http bridge).
import { fs, http, download } from './native'
import { getJson, withRetry, explain, MR_UA } from './net'

export type Kind = 'mod' | 'pack' | 'shader'
const API = 'https://api.modrinth.com/v2'
const TYPE: Record<Kind, string> = { mod: 'mod', pack: 'resourcepack', shader: 'shader' }
const FOLDER: Record<Kind, string> = { mod: 'mods', pack: 'resourcepacks', shader: 'shaderpacks' }
export const IRIS_ID = 'YL57xq9U'
const FABRIC_API_ID = 'P7dR8mSH'
const SYSTEM = /^(vtclient|vtcosmetics|fabric-api)/i
const join = (...p: string[]) => p.join('/').replace(/\/+/g, '/')
const base = (p: string) => p.split('/').pop() || p

interface Tracked { kind: Kind; file: string; versionId: string; version: string; title: string; slug: string; icon: string; auto?: boolean }
type TrackFile = Record<string, Tracked>
let cacheDir = ''
export const initModrinth = (dir: string) => { cacheDir = dir }

const memo = new Map<string, { t: number; v: any }>()
async function cached<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
  const h = memo.get(key)
  if (h && Date.now() - h.t < ttl) return h.v
  const v = await fn()
  memo.set(key, { t: Date.now(), v })
  return v
}
const inflight = new Map<string, Promise<any>>()
const dedupe = <T,>(key: string, fn: () => Promise<T>): Promise<T> => {
  const p = inflight.get(key); if (p) return p
  const n = fn().finally(() => inflight.delete(key)); inflight.set(key, n); return n
}

const trackFile = (dir: string) => join(dir, 'vtclient', 'modrinth.json')
const readTrack = (dir: string) => fs.readJson<TrackFile>(trackFile(dir), {})
const writeTrack = async (dir: string, t: TrackFile) => { await fs.mkdir(join(dir, 'vtclient')); await fs.writeJson(trackFile(dir), t) }
const folderOf = (dir: string, k: Kind) => join(dir, FOLDER[k])
const pickVersion = (vs: any[]) => vs.find((v) => v.version_type === 'release') || vs.find((v) => v.version_type === 'beta') || vs.find((v) => v.version_type === 'alpha') || vs[0] || null
const arr = (a: string[]) => encodeURIComponent(JSON.stringify(a))
const loadersFor = (k: Kind) => (k === 'mod' ? ['fabric'] : k === 'shader' ? ['iris'] : [])

export async function versionsOf(projectId: string, mc: string, k: Kind): Promise<any[]> {
  const l = loadersFor(k)
  const key = `v:${projectId}:${mc}:${l.join()}`
  return cached(key, 5 * 60e3, () => dedupe(key, async () => {
    let vs: any[] = await getJson(`${API}/project/${projectId}/version?game_versions=${arr([mc])}${l.length ? '&loaders=' + arr(l) : ''}`, 'Modrinth sürümleri')
    if (!vs.length && k === 'shader') vs = await getJson(`${API}/project/${projectId}/version?game_versions=${arr([mc])}`, 'Modrinth sürümleri')
    return vs
  }))
}
/** newest compatible release of a project (slug or id) for a Minecraft version; null when none / unknown project */
export const latestFor = async (slug: string, mc: string, k: Kind = 'mod') => {
  try { return pickVersion(await versionsOf(slug, mc, k)) } catch (e: any) { if (e?.status === 404) return null; throw e }
}

const TR_CAT: Record<string, string> = {
  optimization: 'Optimizasyon', adventure: 'Macera', technology: 'Teknoloji', magic: 'Büyü', utility: 'Araçlar', library: 'Kütüphane', decoration: 'Dekorasyon',
  storage: 'Depolama', worldgen: 'Dünya üretimi', mobs: 'Yaratıklar', equipment: 'Ekipman', food: 'Yiyecek', economy: 'Ekonomi', 'game-mechanics': 'Oyun mekaniği',
  management: 'Yönetim', social: 'Sosyal', transportation: 'Ulaşım', cursed: 'Garip', minigame: 'Mini oyun', realistic: 'Gerçekçi', vanilla: 'Vanilla benzeri',
  cartoon: 'Çizgi film', fantasy: 'Fantastik', 'semi-realistic': 'Yarı gerçekçi', simplistic: 'Sade', themed: 'Temalı', tweaks: 'İnce ayarlar', combat: 'Dövüş',
  audio: 'Ses', blocks: 'Bloklar', 'core-shaders': 'Çekirdek shader', entities: 'Varlıklar', environment: 'Ortam', fonts: 'Yazı tipleri', gui: 'Arayüz',
  items: 'Eşyalar', locale: 'Dil', models: 'Modeller', 'colored-lighting': 'Renkli ışık', 'path-tracing': 'Path tracing', pbr: 'PBR', reflections: 'Yansımalar',
  low: 'Düşük', medium: 'Orta', high: 'Yüksek', potato: 'Patates', screenshot: 'Ekran görüntüsü', atmosphere: 'Atmosfer', bloom: 'Bloom'
}
export async function categories(k: Kind) {
  const all: any[] = await cached('cats', 24 * 3600e3, async () => {
    const f = join(cacheDir, 'modrinth-categories.json')
    try { const v = await getJson<any[]>(`${API}/tag/category`, 'Modrinth kategorileri', { attempts: 3 }); await fs.write(f, JSON.stringify(v)); return v }
    catch (e) { const c = await fs.readJson<any[] | null>(f, null); if (c) return c; throw e }
  })
  return all
    .filter((c) => c.project_type === TYPE[k] && (c.header === 'categories' || c.header === 'features' || c.header === 'resolutions' || c.header === 'performance impact' || c.header == null) && c.name !== 'fabric')
    .map((c) => ({ id: c.name, label: TR_CAT[c.name] || (c.name[0].toUpperCase() + c.name.slice(1).replace(/-/g, ' ')) }))
}

export async function search(a: { kind: Kind; mc: string; query?: string; category?: string; sort?: string; offset?: number }) {
  const facets: string[][] = [[`project_type:${TYPE[a.kind]}`], [`versions:${a.mc}`]]
  if (a.kind === 'mod') facets.push(['categories:fabric'])
  if (a.kind === 'shader') facets.push(['categories:iris'])
  if (a.category) facets.push([`categories:${a.category}`])
  const index = ['relevance', 'downloads', 'follows', 'newest', 'updated'].includes(a.sort || '') ? a.sort : 'relevance'
  const url = `${API}/search?query=${encodeURIComponent(a.query || '')}&facets=${encodeURIComponent(JSON.stringify(facets))}&index=${index}&limit=20&offset=${a.offset || 0}`
  const r: any = await cached('s:' + url, 10 * 60e3, () => dedupe('s:' + url, () => getJson(url, 'Modrinth araması', { attempts: 4 })))
  return {
    total: r.total_hits as number,
    hits: (r.hits as any[]).map((h) => ({ id: h.project_id, slug: h.slug, title: h.title, description: h.description, icon: h.icon_url || '', author: h.author, downloads: h.downloads, follows: h.follows, categories: h.display_categories || h.categories || [], updated: h.date_modified }))
  }
}

export interface InstalledItem { file: string; name: string; enabled: boolean; size: number; system: boolean; isDir: boolean; projectId?: string; versionId?: string; title?: string; icon?: string; version?: string; auto?: boolean }
const extOk = (k: Kind, f: string) => (k === 'mod' ? /\.jar(\.disabled)?$/i : /\.zip(\.disabled)?$/i).test(f)

export async function listInstalled(dir: string, k: Kind): Promise<InstalledItem[]> {
  const d = folderOf(dir, k)
  let names: Awaited<ReturnType<typeof fs.list>> = []
  try { names = await fs.list(d) } catch { return [] }
  const track = await readTrack(dir)
  const byFile = new Map(Object.entries(track).map(([id, t]) => [t.file.replace(/\.disabled$/i, ''), { id, t }]))
  const items: InstalledItem[] = []
  for (const e of names.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isDir && !extOk(k, e.name)) continue
    const bse = e.name.replace(/\.disabled$/i, '')
    const tr = byFile.get(bse)
    items.push({ file: e.name, name: bse.replace(/\.(jar|zip)$/i, ''), enabled: !e.name.endsWith('.disabled'), size: e.isDir ? 0 : e.size, isDir: e.isDir, system: k === 'mod' && SYSTEM.test(e.name), projectId: tr?.id, versionId: tr?.t.versionId, title: tr?.t.title, icon: tr?.t.icon, version: tr?.t.version, auto: tr?.t.auto })
  }
  const unknown = items.filter((i) => !i.projectId && !i.isDir)
  if (unknown.length) {
    try {
      const hashes = await Promise.all(unknown.map((i) => fs.sha(join(d, i.file), 'sha1')))
      const need = hashes.filter((h) => !memo.has('h:' + h))
      if (need.length) {
        const r = await http({ method: 'POST', url: `${API}/version_files`, headers: { 'content-type': 'application/json', 'user-agent': MR_UA }, body: JSON.stringify({ hashes: need, algorithm: 'sha1' }), timeoutMs: 15000 })
        const map: Record<string, any> = r.status === 200 ? JSON.parse(r.text || '{}') : {}
        for (const h of need) memo.set('h:' + h, { t: Date.now(), v: map[h] || null })
        const ids = [...new Set(Object.values(map).map((v: any) => v.project_id))]
        if (ids.length) {
          const ps: any[] = await getJson(`${API}/projects?ids=${arr(ids)}`, 'Modrinth projeleri', { attempts: 2 })
          for (const p of ps) memo.set('p:' + p.id, { t: Date.now(), v: p })
        }
      }
      unknown.forEach((i, n) => {
        const v = memo.get('h:' + hashes[n])?.v
        if (!v) return
        const p = memo.get('p:' + v.project_id)?.v
        i.projectId = v.project_id; i.versionId = v.id; i.version = v.version_number; i.title = p?.title; i.icon = p?.icon_url
      })
    } catch { /* offline: plain file names */ }
  }
  return items
}

type Progress = (text: string) => void
interface Plan { projectId: string; version: any; auto: boolean }
async function resolvePlan(dir: string, mc: string, k: Kind, projectId: string, onP: Progress): Promise<Plan[]> {
  const installed = new Set((await listInstalled(dir, k)).map((i) => i.projectId).filter(Boolean) as string[])
  if (k === 'mod') { try { for (const e of await fs.list(join(dir, 'mods'))) if (/^fabric-api/i.test(e.name)) installed.add(FABRIC_API_ID) } catch { /* */ } }
  const plan: Plan[] = []
  const seen = new Set<string>()
  const visit = async (id: string, auto: boolean, versionId?: string) => {
    if (seen.has(id)) return
    seen.add(id)
    if (auto && installed.has(id)) return
    onP(auto ? 'Bağımlılık çözümleniyor…' : 'Sürüm aranıyor…')
    const v = versionId ? await getJson(`${API}/version/${versionId}`, 'Modrinth sürümü') : pickVersion(await versionsOf(id, mc, k))
    if (!v) { if (auto) return; throw Object.assign(new Error(`Bu proje ${mc} sürümü için uyumlu bir dosya sunmuyor.`), { user: true }) }
    plan.push({ projectId: id, version: v, auto })
    if (k === 'mod') for (const dep of v.dependencies || []) if (dep.dependency_type === 'required' && dep.project_id && dep.project_id !== FABRIC_API_ID) await visit(dep.project_id, true, dep.version_id || undefined)
  }
  await visit(projectId, false)
  return plan
}

export async function downloadVersion(dir: string, k: Kind, version: any, onP: Progress) {
  const file = version.files.find((f: any) => f.primary) || version.files[0]
  const d = folderOf(dir, k)
  await fs.mkdir(d)
  const dest = join(d, base(file.filename))
  onP(`İndiriliyor: ${file.filename}`)
  await withRetry(() => download({ url: file.url, dest, timeoutMs: 120000, ...(file.hashes?.sha1 ? { sha1: file.hashes.sha1 } : {}) }), { attempts: 4, baseMs: 700 })
  return base(file.filename)
}

export async function install(dir: string, mc: string, k: Kind, projectId: string, onP: Progress) {
  const plan = await resolvePlan(dir, mc, k, projectId, onP)
  const track = await readTrack(dir)
  const done: string[] = []
  for (const p of plan) {
    const old = track[p.projectId]
    const fname = await downloadVersion(dir, k, p.version, onP)
    if (old && old.file.replace(/\.disabled$/i, '') !== fname) await fs.rm(join(folderOf(dir, k), old.file))
    let meta: any = memo.get('p:' + p.projectId)?.v
    if (!meta) { try { meta = await getJson(`${API}/project/${p.projectId}`, 'Modrinth projesi', { attempts: 2 }); memo.set('p:' + p.projectId, { t: Date.now(), v: meta }) } catch { meta = {} } }
    track[p.projectId] = { kind: k, file: fname, versionId: p.version.id, version: p.version.version_number, title: meta.title || fname, slug: meta.slug || '', icon: meta.icon_url || '', auto: p.auto || (old?.auto && p.projectId !== projectId) || undefined }
    done.push(meta.title || fname)
  }
  await writeTrack(dir, track)
  return done
}

export async function checkUpdates(dir: string, mc: string, k: Kind) {
  const items = (await listInstalled(dir, k)).filter((i) => i.projectId && !i.isDir && i.enabled)
  if (!items.length) return {}
  const d = folderOf(dir, k)
  const hashes = await Promise.all(items.map((i) => fs.sha(join(d, i.file), 'sha1')))
  const l = loadersFor(k)
  const r = await http({ method: 'POST', url: `${API}/version_files/update`, headers: { 'content-type': 'application/json', 'user-agent': MR_UA }, body: JSON.stringify({ hashes, algorithm: 'sha1', loaders: l.length ? l : undefined, game_versions: [mc] }), timeoutMs: 20000 })
  if (r.status !== 200) throw new Error('HTTP ' + r.status)
  const map = JSON.parse(r.text || '{}') as Record<string, any>
  const out: Record<string, { versionId: string; version: string }> = {}
  items.forEach((i, n) => {
    const v = map[hashes[n]]
    if (v && v.version_type === 'release' && v.id !== i.versionId && !v.files.some((f: any) => f.hashes?.sha1 === hashes[n])) out[i.file] = { versionId: v.id, version: v.version_number }
  })
  return out
}
export async function updateItem(dir: string, mc: string, k: Kind, file: string, onP: Progress) {
  const it = (await listInstalled(dir, k)).find((i) => i.file === file)
  if (!it?.projectId) throw new Error('Bu dosya Modrinth ile eşleşmiyor.')
  return install(dir, mc, k, it.projectId, onP)
}
export async function removeItem(dir: string, k: Kind, file: string) {
  const b = base(file)
  if (k === 'mod' && SYSTEM.test(b)) throw new Error('Sistem modu kaldırılamaz.')
  await fs.rm(join(folderOf(dir, k), b))
  const t = await readTrack(dir)
  let ch = false
  for (const [id, v] of Object.entries(t)) if (v.file.replace(/\.disabled$/i, '') === b.replace(/\.disabled$/i, '')) { delete t[id]; ch = true }
  if (ch) await writeTrack(dir, t)
}
export async function toggleItem(dir: string, k: Kind, file: string) {
  const b = base(file)
  if (k === 'mod' && SYSTEM.test(b)) throw new Error('Sistem modu kapatılamaz.')
  const to = b.endsWith('.disabled') ? b.slice(0, -9) : b + '.disabled'
  await fs.rename(join(folderOf(dir, k), b), join(folderOf(dir, k), to))
  const t = await readTrack(dir)
  let ch = false
  for (const v of Object.values(t)) if (v.file === b) { v.file = to; ch = true }
  if (ch) await writeTrack(dir, t)
}
/** files picked through the Android document picker (already copied into the app cache) */
export async function addFiles(dir: string, k: Kind, paths: string[]) {
  const d = folderOf(dir, k)
  await fs.mkdir(d)
  let n = 0
  for (const p of paths) {
    const b = base(p)
    if (!(k === 'mod' ? /\.jar$/i : /\.zip$/i).test(b)) continue
    if (await fs.copy(p, join(d, b))) n++
  }
  return n
}
export const irisInstalled = async (dir: string) => (await listInstalled(dir, 'mod')).some((i) => i.projectId === IRIS_ID || /^iris/i.test(i.file))
export const describe = (e: any) => ({ message: e?.user ? e.message : `Modrinth: ${explain(e)}` })
