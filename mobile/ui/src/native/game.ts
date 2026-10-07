// Game pipeline for Android and iOS. The heavy parts (Mojang files, Fabric, JRE, renderer, JVM start) are native (ZL2 core / Amethyst-iOS);
// this file does what launcher/electron/game.ts does around them: fabric-api, our client jars, perf pack, options, session.json.
import { fs, native, emit, deviceInfo, onNative } from './native'
import { getJson, withRetry, explain } from './net'
import { syncClient, cachedManifest, supportedReps } from './client'
import { latestFor, downloadVersion } from './modrinth'
import type { MobileSettings, Profile, Account } from './store'

export const MC_VERSION = '1.21.11'
const join = (...p: string[]) => p.join('/').replace(/\/+/g, '/')

/** Mobile perf pack: only mods that do not touch the GL pipeline (see plans/MOBILE.md). Sodium is an opt-in experiment. */
export const MOBILE_PERF_MODS = ['lithium', 'ferrite-core', 'modernfix', 'entityculling', 'krypton']
export const EXPERIMENTAL_PERF_MODS = ['sodium']
/** mods whose build for exactly this MC version breaks the game (copied from the PC launcher's e2e findings) */
const PERF_SKIP: Record<string, string[]> = { '1.21.2': ['c2me-fabric'], '1.21': ['moreculling'], '1.20.1': ['moreculling'], '1.20': ['moreculling'] }
const FABRIC_API_PROJECT = 'P7dR8mSH'

export const versionName = (p: Profile) => 'VT-' + p.id

export async function profileDir(p: Profile): Promise<string> {
  return (await native<{ dir: string }>('game.dir', { name: versionName(p) })).dir
}

/** First-launch phone defaults for options.txt (existing user choices are never overwritten afterwards). */
export function mobileOptions(dpiClass: 'low' | 'mid' | 'high', refreshHz: number): Record<string, string> {
  return {
    renderDistance: dpiClass === 'high' ? '8' : '6', simulationDistance: '5', graphicsMode: '0', particles: '2', entityShadows: 'false',
    bobView: 'false', biomeBlendRadius: '0', mipmapLevels: '0', cloudRenderMode: '"off"', enableVsync: 'false', maxFps: String(Math.max(60, Math.round(refreshHz || 60))),
    ao: 'false', entityDistanceScaling: '0.75', 'soundCategory_music': '0.0', lang: 'tr_tr', guiScale: '0', fov: '0.25', touchscreen: 'false', narrator: '0', autoJump: 'true'
  }
}

export interface PlayDeps {
  root: string; settings: MobileSettings; log: (...a: any[]) => void
  send: (ch: string, ...a: any[]) => void; account: Account; bridge: { port: number; token: string } | null
  hudLayoutKey?: string
}

let busy = false
export const isBusy = () => busy

export async function play(d: PlayDeps, profile: Profile, joinIp?: string): Promise<{ ok: boolean; error?: string; step?: string }> {
  if (busy) return { ok: false, error: 'Oyun zaten çalışıyor.' }
  busy = true
  let lastPct = 0
  const progress = (pct: number, text: string) => { lastPct = pct; d.send('game:progress', { pct: Math.max(0, Math.min(100, pct)), text }) }
  const fail = (step: string, e: any) => {
    const message = `${step} adımı başarısız oldu: ${explain(e)}`
    d.send('game:error', { step, message }); d.send('game:state', 'idle'); progress(0, '')
    return { ok: false, error: message, step }
  }
  let step = 'Başlatma'
  try {
    const mc = profile.version
    const name = versionName(profile)
    d.send('game:state', 'installing'); progress(1, 'Sürüm bilgisi alınıyor…')
    const dev = await deviceInfo()

    // 1. Minecraft + Fabric through the Kotlin installer (resume-safe, Mojang files downloaded on the phone)
    step = 'Minecraft kurulumu'
    const off = onNative((ch, a) => { if (ch === 'ensure:progress') progress(2 + (a.pct / 100) * 70, a.text) })
    try { await native('game.ensure', { name, mc }) } finally { off() }
    const gameDir = await profileDir(profile)
    await fs.mkdir(join(gameDir, 'mods'))

    // 2. fabric-api (per MC version), VanillaTurkey jars, perf pack
    step = 'Modlar'
    progress(74, 'Fabric API hazırlanıyor…')
    await syncFabricApi(gameDir, mc, d.log)
    progress(80, 'VanillaTurkey Client güncelleniyor…')
    const r = await syncClient({ root: d.root, gameDir, mc, log: d.log, progress: (t) => progress(82, t) })
    if (r.unsupported) d.send('game:warn', `VanillaTurkey modları ${mc} için yok, sade Fabric açılıyor.`)
    else if (!r.ok) d.send('game:warn', 'Client güncellemesi uygulanamadı, mevcut sürüm kullanılacak.')
    else if (r.changed) d.send('game:warn', `Client v${r.version} sürümüne güncellendi.`)
    progress(88, 'Performans paketi…')
    await syncPerfPack(gameDir, mc, profile.perfPack, d.settings.experimentalSodium, d.settings.renderer, d.send, d.log)

    // 3. options, session, defaults
    step = 'Ayarlar'
    progress(94, 'Ayarlar yazılıyor…')
    await writeOptions(gameDir, dev.dpi, dev.refreshHz, d.settings)
    await fs.mkdir(join(gameDir, 'vtclient'))
    await fs.write(join(gameDir, 'vtclient', 'session.json'), JSON.stringify({
      username: d.account.username, uuid: d.account.uuid, apiBase: d.settings.apiBase, apiToken: d.account.apiToken,
      discordRpc: false, lang: d.settings.lang, bridge: d.bridge, mobile: true, device: 'mobile'
    }))
    await fs.write(join(gameDir, 'vtclient', 'launcher-defaults.json'), JSON.stringify({ modules: d.settings.modules }, null, 2))
    // the mod reads this to switch to mobile mode (also passed as -Dvt.mobile=true)
    await fs.write(join(gameDir, 'vtclient', 'mobile.json'), JSON.stringify({ mobile: true, dpi: dev.dpi, density: dev.density, widthPx: dev.widthPx, heightPx: dev.heightPx, refreshHz: dev.refreshHz, hudProfile: 'mobile', hudScale: hudScaleFor(dev) }))

    // 4. launch (Kotlin: ZL2 launcher, renderer, touch control layout)
    step = 'Oyun başlatma'
    progress(97, 'Oyun başlatılıyor…'); d.send('game:state', 'launching')
    const ram = Math.max(1024, Math.min(profile.ramMb || 0, Math.floor(dev.totalMemMb * 0.55)))
    const jvm = ['-Dvt.mobile=true', `-Dvt.mobile.dpi=${dev.dpi}`, `-Dvt.mobile.scale=${hudScaleFor(dev)}`, `-Dvt.mobile.size=${dev.widthPx}x${dev.heightPx}`]
    const res = await native<{ ok: boolean; error?: string }>('game.launch', {
      name, username: d.account.username, uuid: d.account.uuid, ramMb: ram, jvmArgs: jvm, renderer: d.settings.renderer,
      joinIp: joinIp || '', control: 'vanillaturkey.json', ms: d.account.ms ? { accessToken: d.account.ms.accessToken } : null
    })
    if (!res.ok) throw new Error(res.error || 'başlatılamadı')
    d.send('game:state', 'playing'); progress(100, 'Oyun açık')
    return { ok: true }
  } catch (e) {
    return fail(step, e)
  } finally { busy = false; void lastPct }
}

/** HUD scale preset by screen: dp width of the landscape short side decides how big our HUD / screens are. */
export function hudScaleFor(dev: { heightPx: number; widthPx: number; dpi: number }): number {
  const shortDp = (Math.min(dev.widthPx, dev.heightPx) / dev.dpi) * 160
  if (shortDp < 340) return 1.35 // small phone
  if (shortDp < 420) return 1.2
  if (shortDp < 600) return 1.1 // large phone / foldable
  return 1.0 // tablet
}

async function syncFabricApi(gameDir: string, mc: string, log: (...a: any[]) => void) {
  const modsDir = join(gameDir, 'mods')
  const apiJars = (await fs.list(modsDir)).filter((e) => /^fabric-api/i.test(e.name))
  const ok = (f: string) => f.toLowerCase().endsWith('+' + mc + '.jar')
  for (const e of apiJars) if (!ok(e.name)) await fs.rm(join(modsDir, e.name))
  if ((await fs.list(modsDir)).some((e) => /^fabric-api/i.test(e.name))) return
  const v = await latestFor(FABRIC_API_PROJECT, mc, 'mod')
  if (!v) throw new Error(`Fabric API ${mc} için bulunamadı.`)
  await withRetry(() => downloadVersion(gameDir, 'mod', v, () => {}), { attempts: 3 })
  log('[fabric-api]', v.version_number)
}

async function syncPerfPack(gameDir: string, mc: string, enabled: boolean, sodium: boolean, renderer: string, send: PlayDeps['send'], log: (...a: any[]) => void) {
  const modsDir = join(gameDir, 'mods')
  const mf = join(gameDir, 'vtclient', 'perf-pack.json')
  await fs.mkdir(join(gameDir, 'vtclient'))
  let old = await fs.readJson<Record<string, string>>(mf, {})
  if ((old.__mc || MC_VERSION) !== mc) { for (const [k, f] of Object.entries(old)) if (k !== '__mc') await fs.rm(join(modsDir, f)); old = {} }
  delete old.__mc
  const next: Record<string, string> = {}
  const skip = PERF_SKIP[mc] || []
  const wanted = !enabled ? [] : [...MOBILE_PERF_MODS, ...(sodium && /zink|mobileglues|ltw|osmesa/i.test(renderer || '') ? EXPERIMENTAL_PERF_MODS : [])].filter((m) => !skip.includes(m))
  let fails = 0
  for (const slug of wanted) {
    try {
      const v = await latestFor(slug, mc, 'mod')
      if (!v) { send('game:warn', `${slug}: ${mc} sürümü yok, atlandı.`); continue }
      const file = v.files.find((f: any) => f.primary) || v.files[0]
      if (!(await fs.exists(join(modsDir, file.filename)))) await downloadVersion(gameDir, 'mod', v, () => {})
      next[slug] = file.filename; fails = 0
    } catch (e) {
      log('perf-pack', slug, e)
      if (old[slug] && (await fs.exists(join(modsDir, old[slug])))) next[slug] = old[slug]
      if (++fails >= 2) { send('game:warn', 'Modrinth erişilemiyor, performans paketi mevcut haliyle kullanılacak.'); break }
    }
  }
  for (const [slug, f] of Object.entries(old)) if (next[slug] !== f && !Object.values(next).includes(f)) await fs.rm(join(modsDir, f))
  await fs.writeJson(mf, { __mc: mc, ...next })
  send('game:perf', Object.keys(next))
}

async function writeOptions(gameDir: string, dpi: number, hz: number, s: MobileSettings) {
  const f = join(gameDir, 'options.txt')
  const lines = ((await fs.read(f)) || '').split(/\r?\n/).filter(Boolean)
  const set = (k: string, v: string) => { const i = lines.findIndex((l) => l.startsWith(k + ':')); if (i >= 0) lines[i] = `${k}:${v}`; else lines.push(`${k}:${v}`) }
  const has = (k: string) => lines.some((l) => l.startsWith(k + ':'))
  const flag = join(gameDir, 'vtclient', 'mobile-defaults-applied')
  if (!(await fs.exists(flag))) {
    const cls = dpi >= 440 ? 'high' : dpi >= 300 ? 'mid' : 'low'
    for (const [k, v] of Object.entries(mobileOptions(cls, hz))) if (!has(k) || k === 'maxFps' || k === 'enableVsync') set(k, v)
    await fs.write(flag, new Date().toISOString())
  }
  if (s.muteGame) set('soundCategory_master', '0.0')
  await fs.write(f, lines.join('\n') + '\n')
}

export async function supportedVersions(): Promise<string[]> {
  const m = await cachedManifest()
  return m ? supportedReps(m) : [MC_VERSION]
}
export { emit, getJson }
