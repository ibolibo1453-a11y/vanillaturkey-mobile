// window.vt for Android: the same IPC surface the Electron preload exposes, implemented in TypeScript on top of the Kotlin bridge.
import { native, onNative, emit, fs, kv, http, download, deviceInfo, type DeviceInfo } from './native'
import { apiCall, apiRaw, multipart, bytesFromB64, b64FromBytes, getJson, explain, DEFAULT_API, UPDATE_BASE } from './net'
import * as S from './store'
import * as mr from './modrinth'
import { play, profileDir, supportedVersions, MC_VERSION } from './game'
import { cachedManifest, installedVersion } from './client'

const APP_VERSION = (typeof __VT_VERSION__ !== 'undefined' ? __VT_VERSION__ : '1.0.0')
declare const __VT_VERSION__: string
const join = (...p: string[]) => p.join('/').replace(/\/+/g, '/')
const log = (...a: any[]) => { try { console.log('[vt]', ...a) } catch { /* */ } void native('log', { text: a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ').slice(0, 1500) }).catch(() => {}) }

let dev: DeviceInfo
let root = ''
let bridge: { port: number; token: string } | null = null
let gstate: 'idle' | 'installing' | 'launching' | 'playing' = 'idle'
let rendererReady = false
let versionCache: { t: number; v: string[] } | null = null
let lastError: { step: string; message: string } | null = null

const offlineUuid = async (name: string) => {
  // md5 is not in WebCrypto: Kotlin computes the Java-compatible OfflinePlayer uuid
  return (await native<{ uuid: string }>('uuid.offline', { name })).uuid
}

// ------------------------------------------------------------------ skins
const skinMem = new Map<string, { data: string; t: number }>()
const skinKey = (n: string) => n.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16)
async function assetDataUrl(path: string): Promise<string | null> {
  try { const r = await fetch(path); if (!r.ok) return null; const b = await r.blob(); return await new Promise((res) => { const f = new FileReader(); f.onload = () => res(String(f.result)); f.readAsDataURL(b) }) } catch { return null }
}
async function skinGet(name: string): Promise<string | null> {
  const k = skinKey(name); if (!k) return null
  const hit = skinMem.get(k); if (hit && Date.now() - hit.t < 10 * 60e3) return hit.data
  const cache = join(root, 'skins', k + '.png')
  try {
    const r = await http({ url: `${S.getSettings().apiBase.replace(/\/+$/, '')}/v1/skins/${encodeURIComponent(k)}.png`, binary: true, timeoutMs: 8000 })
    if (r.status === 404) {
      const kind = r.headers['x-skin-default'] === 'slim' ? 'alex' : 'steve'
      const d = await assetDataUrl(`skins/${kind}.png`); if (d) { skinMem.set(k, { data: d, t: Date.now() - 9 * 60e3 }); return d }
    }
    if (r.status === 200 && r.b64) { await fs.writeB64(cache, r.b64); const d = 'data:image/png;base64,' + r.b64; skinMem.set(k, { data: d, t: Date.now() }); return d }
  } catch { /* offline */ }
  const stale = await fs.readB64(cache)
  if (stale) { const d = 'data:image/png;base64,' + stale; skinMem.set(k, { data: d, t: Date.now() - 9.5 * 60e3 }); return d }
  return null
}

// ------------------------------------------------------------------ catalog (bundled with the APK as web assets)
const catCache: Record<string, any> = {}
async function readCatalog(kind: 'cosmetics' | 'modules') {
  if (catCache[kind]) return catCache[kind]
  try {
    const url = kind === 'cosmetics' ? 'cos/catalog.json' : 'cos/modules.json'
    const raw = await (await fetch(url)).json()
    let items: any[] = Array.isArray(raw) ? raw : raw.items || raw.cosmetics || raw.modules || []
    if (kind === 'cosmetics') items = items.map((it) => { const ic = it.icon || it.iconPath || ''; return { ...it, iconData: ic ? 'cos/icons/' + String(ic).split('/').pop() : '' } })
    const r = { source: url, items, rarities: Array.isArray(raw.rarities) ? raw.rarities : [], slots: Array.isArray(raw.slots) ? raw.slots : [] }
    if (items.length) catCache[kind] = r
    return r
  } catch { return { source: 'sample', items: [] as any[] } }
}

// ------------------------------------------------------------------ game
async function playProfile(id: string, joinIp?: string) {
  const account = S.getAccount()
  if (!account) return { ok: false, error: 'Giriş yapılmadı.' }
  lastError = null
  const p = S.getProfile(id)
  await pullConfigs(await profileDir(p)).catch(() => {})
  const r = await play({
    root, settings: S.getSettings(), log, send: (ch, ...a) => emit(ch, ...a), account, bridge
  }, p, joinIp)
  if (r.ok) { gstate = 'playing'; await S.touchProfile(p.id) } else { gstate = 'idle'; lastError = { step: r.step || 'Başlatma', message: r.error || '' } }
  return r
}

// ------------------------------------------------------------------ updater (APK self-update, same idea as latest.yml)
let updaterState: { state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'; version?: string; pct?: number; error?: string } = { state: 'idle' }
let apkPath = ''
const setUpd = (u: typeof updaterState) => { updaterState = u; emit('updater', u) }
const cmp = (a: string, b: string) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 4; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1 } return 0 }
let lastCheck = 0
async function checkApkUpdate() {
  if (!S.getSettings().autoUpdate || updaterState.state === 'downloading' || updaterState.state === 'ready') return
  if (Date.now() - lastCheck < 2 * 60e3) return
  lastCheck = Date.now()
  try {
    setUpd({ state: 'checking' })
    if (dev.platform === 'ios') {
      // iOS: updates come through the AltStore / SideStore source (/vtclient/ios/apps.json); the app only announces a newer version
      const src = await getJson<any>(UPDATE_BASE + '/ios/apps.json?t=' + Math.floor(Date.now() / 60000), 'iOS kaynağı', { attempts: 1, timeoutMs: 6000 })
      const app = src?.apps?.[0]; const v = String(app?.versions?.[0]?.version || app?.version || '')
      if (!v || cmp(v, APP_VERSION) <= 0) { setUpd({ state: 'idle' }); return }
      setUpd({ state: 'ready', version: v }); return
    }
    const m = await getJson<{ version: string; url: string; sha256: string; size?: number; minSdk?: number }>(UPDATE_BASE + '/mobile/latest.json?t=' + Math.floor(Date.now() / 60000), 'APK manifesti', { attempts: 1, timeoutMs: 6000 })
    if (!m?.version || cmp(m.version, APP_VERSION) <= 0) { setUpd({ state: 'idle' }); return }
    setUpd({ state: 'downloading', version: m.version, pct: 0 })
    const dest = join(root, 'update', `VanillaTurkey-${m.version}.apk`)
    const off = onNative((ch, a) => { if (ch === 'dl:progress' && a.tag === 'apk') setUpd({ state: 'downloading', version: m.version, pct: Math.round(a.pct) }) })
    try { await download({ url: m.url, dest, sha256: (m.sha256 || '').toLowerCase() || undefined, timeoutMs: 600000, tag: 'apk' }) } finally { off() }
    apkPath = dest
    setUpd({ state: 'ready', version: m.version })
  } catch (e) { log('[updater]', e); setUpd({ state: 'idle' }) } // no manifest published yet = no update
}

// ------------------------------------------------------------------ handlers
type H = (...a: any[]) => any
const handlers: Record<string, H> = {
  'app:info': () => ({ version: APP_VERSION, totalMemMb: dev.totalMemMb, freeMemMb: dev.freeMemMb, cpus: dev.cpus, gameDir: dev.gameHome, platform: dev.platform || 'android', model: dev.model, sdk: dev.sdk, abi: dev.abi, dpi: dev.dpi, refreshHz: dev.refreshHz }),
  'win:min': () => native('ui.moveToBack'), 'win:max': () => true, 'win:close': () => native('ui.moveToBack'),
  'shell:open': (url: string) => { if (/^https:\/\//.test(url)) return native('ui.openUrl', { url }) },
  'shell:openGameDir': () => true,
  'settings:get': () => S.getSettings(),
  'settings:set': async (patch: Partial<S.MobileSettings>, opts?: { src?: string }) => {
    const s = await S.patchSettings(patch)
    if ('modules' in patch) syncPush('modules', patch.modules)
    if ('hud' in patch) syncPush('hud_mobile', patch.hud) // HUD layouts are per device class: the phone never overwrites the PC layout
    if (opts?.src !== 'game') {
      for (const sec of ['modules', 'voice', 'hud'] as const) if (sec in patch) bridgeSend(null, { t: 'settings_upd', section: sec, data: (patch as any)[sec], source: 'launcher' })
      if ('clientCfg' in patch) bridgeSend(null, { t: 'settings_upd', section: 'client', data: patch.clientCfg, source: 'launcher' })
    }
    return s
  },
  'account:restore': async () => { const a = await S.restoreAccount(); if (a) void syncPull(); return S.publicAccount(a) },
  'account:logout': async () => { S.setAccount(null); await kv.del('account'); await S.patchSettings({ remember: false }); return true },
  'auth:login': async (username: string, password: string, remember: boolean, repeat?: string) => {
    const isReg = repeat !== undefined
    const s = S.getSettings()
    const r = await apiCall(s.apiBase, 'POST', isReg ? '/v1/auth/register' : '/v1/auth/login', isReg ? { username, password, passwordRepeat: repeat } : { username, password })
    if (r.networkError) return { ok: false, networkError: true, error: 'Sunucuya ulaşılamadı.' }
    if (!r.data?.ok) return { ok: false, error: r.data?.error || r.data?.message || 'İşlem başarısız.' }
    S.setAccount({ username: r.data.username, uuid: r.data.uuid, apiToken: r.data.token, offline: false })
    await S.patchSettings({ remember: !!remember, lastUser: r.data.username }); await S.persistAccount(); void syncPull()
    return { ok: true, account: S.publicAccount(S.getAccount()) }
  },
  'auth:offline': async (username: string) => {
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) return { ok: false, error: 'Kullanıcı adı 3-16 karakter (harf, rakam, _) olmalı.' }
    S.setAccount({ username, uuid: await offlineUuid(username), apiToken: '', offline: true })
    await S.patchSettings({ lastUser: username })
    return { ok: true, account: S.publicAccount(S.getAccount()) }
  },
  'auth:microsoft': async () => {
    try {
      const r = await native<{ ok: boolean; error?: string; accessToken?: string; uuid?: string; name?: string }>('auth.microsoft')
      if (!r.ok) return { ok: false, error: r.error || 'Microsoft girişi iptal edildi.' }
      const prev = S.getAccount()
      S.setAccount({ username: r.name!, uuid: r.uuid!, apiToken: prev?.apiToken || '', offline: false, ms: { accessToken: r.accessToken!, uuid: r.uuid!, name: r.name! } })
      return { ok: true, account: S.publicAccount(S.getAccount()) }
    } catch (e) { return { ok: false, error: 'Microsoft girişi başarısız: ' + explain(e) } }
  },
  'api:call': (method: string, p: string, body?: any, auth?: boolean) => apiCall(S.getSettings().apiBase, method, p, body, auth ? S.getAccount()?.apiToken : undefined),
  'api:upload': async (p: string, a: { data: ArrayBuffer | string; name: string; type: string }) => {
    const acc = S.getAccount(); if (!acc?.apiToken) return { status: 401, data: { ok: false, error: 'Giriş gerekli.' } }
    if (!/^\/v1\/(admin\/[\w\-\/]+|cosmetics\/custom-cape)$/.test(String(p))) return { status: 400, data: { ok: false, error: 'Geçersiz yol.' } }
    const bytes = typeof a.data === 'string' ? bytesFromB64(a.data) : new Uint8Array(a.data)
    const mp = multipart(a.name, a.type, bytes)
    return apiRaw(S.getSettings().apiBase, 'POST', p, { ...mp, token: acc.apiToken, timeoutMs: 120000 })
  },
  // the API shows the device next to "online": phones announce "Telefonda"
  'api:presence': async (status?: string) => { const a = S.getAccount(); return a?.apiToken && gstate !== 'playing' ? apiCall(S.getSettings().apiBase, 'POST', '/v1/presence', { status: String(status || 'Telefonda').slice(0, 64), device: 'mobile' }, a.apiToken) : null },
  'social:session': () => { const a = S.getAccount(); return { apiBase: S.getSettings().apiBase, token: a?.apiToken || '', username: a?.username || '', offline: !!a?.offline, platform: dev.platform || 'android', version: APP_VERSION, quiet: false } },
  'social:upload': async (a: { data: ArrayBuffer | string; name: string; type: string }) => {
    const acc = S.getAccount(); if (!acc?.apiToken) return { status: 401, data: { ok: false, error: 'Giriş gerekli.' } }
    const bytes = typeof a.data === 'string' ? bytesFromB64(a.data) : new Uint8Array(a.data)
    return apiRaw(S.getSettings().apiBase, 'POST', '/v1/uploads', { ...multipart(a.name, a.type, bytes), token: acc.apiToken })
  },
  'social:uploadPath': async (file: string) => {
    const st = await fs.stat(file); if (!st) return { status: 0, data: { ok: false, error: 'Dosya okunamadı.' } }
    if (st.size > 6 * 1048576) return { status: 413, data: { ok: false, error: 'Dosya çok büyük (en fazla 5 MB).' } }
    const ext = (file.split('.').pop() || '').toLowerCase(); const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg'
    const b64 = await fs.readB64(file); if (!b64) return { status: 0, data: { ok: false, error: 'Dosya okunamadı.' } }
    return handlers['social:upload']({ data: b64, name: file.split('/').pop(), type })
  },
  'social:media': async (url: string) => {
    try {
      const u = new URL(url); const base = new URL(S.getSettings().apiBase)
      if (u.host !== base.host) return null
      const r = await http({ url, binary: true, timeoutMs: 15000 }); if (r.status !== 200 || !r.b64) return null
      return `data:${r.headers['content-type'] || 'application/octet-stream'};base64,${r.b64}`
    } catch { return null }
  },
  'social:unread': (n: number) => native('notif.badge', { n }),
  'social:inRoom': (v: boolean) => native('voice.service', { on: !!v }),
  'social:ready': (v: boolean) => { rendererReady = !!v; return native('bridge.ready', { ready: !!v }) },
  'social:notify': (a: { title: string; body: string; channel?: string }) => native('notif.show', a),
  'social:focus': () => native('ui.moveToFront'),
  'keys:set': () => true,
  'bridge:send': (id: number | null, msg: any) => bridgeSend(id, msg),
  'bridge:clients': () => native('bridge.count'),
  'skin:get': (name: string) => skinGet(String(name || '')),
  'skin:invalidate': (name: string) => { skinMem.delete(skinKey(String(name || ''))); return true },
  'skin:fetch': (name: string) => skinGet(String(name || '')),
  'skin:upload': async (dataUrl: string, slim: boolean) => {
    const a = S.getAccount(); if (!a?.apiToken) return { ok: false, error: 'Skin yüklemek için VanillaTurkey hesabıyla giriş yap.' }
    const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl || ''); if (!m) return { ok: false, error: 'Geçersiz skin dosyası.' }
    if (m[1].length * 0.75 > 65536) return { ok: false, error: 'Skin dosyası 64 KB sınırını aşıyor.' }
    const r = await apiRaw(S.getSettings().apiBase, 'PUT', '/v1/skin?model=' + (slim ? 'slim' : 'classic'), { bodyB64: m[1], headers: { 'content-type': 'image/png' }, token: a.apiToken })
    skinMem.delete(skinKey(a.username))
    if (r.networkError) return { ok: false, error: 'Sunucuya ulaşılamadı.' }
    return r.data?.ok === false || r.status >= 400 ? { ok: false, error: r.data?.error || 'Skin yüklenemedi.' } : { ok: true }
  },
  'skin:reset': async () => { const a = S.getAccount(); if (!a?.apiToken) return { ok: false }; const r = await apiRaw(S.getSettings().apiBase, 'DELETE', '/v1/skin', { token: a.apiToken }); skinMem.delete(skinKey(a.username)); return { ok: r.status > 0 && r.status < 400 } },
  'skin:pick': async () => {
    const f = await native<{ path: string }[]>('ui.pickFiles', { mime: 'image/png', multiple: false }); if (!f.length) return null
    const b64 = await fs.readB64(f[0].path); if (!b64) return null
    const data = 'data:image/png;base64,' + b64; await S.patchSettings({ customSkin: data }); return data
  },
  'catalog:cosmetics': () => readCatalog('cosmetics'),
  'catalog:modules': () => readCatalog('modules'),
  'cosmetic:model': async (id: string) => {
    if (!/^[a-z0-9_]+$/i.test(id)) return null
    try {
      const json = await (await fetch(`cos/models/${id}.json`)).json()
      const tex = (await assetDataUrl(`cos/models/${json.texture || id + '.png'}`)) || ''
      const tpl = id === 'renklerin' ? (await assetDataUrl('cos/models/renklerin_template.png')) || '' : ''
      return { json, tex, tpl }
    } catch { return null }
  },
  'cosmetics:writeLocal': async (body: Record<string, string | null>, renk?: [number, number]) => {
    try {
      const dir = join(await profileDir(S.getProfile()), 'vtcosmetics'); await fs.mkdir(dir)
      await fs.write(join(dir, 'equipped.json'), JSON.stringify(body))
      if (renk) await fs.write(join(dir, 'renk.json'), JSON.stringify({ a: renk[0], b: renk[1] }))
      return true
    } catch (e) { log('cosmetics:writeLocal', e); return false }
  },
  'modules:save': async (m: Record<string, boolean>) => {
    await S.patchSettings({ modules: m })
    const dir = join(await profileDir(S.getProfile()), 'vtclient'); await fs.mkdir(dir)
    await fs.write(join(dir, 'launcher-defaults.json'), JSON.stringify({ modules: m }, null, 2)); return true
  },
  'java:pick': () => null,
  'card:copy': () => false,
  'game:play': () => playProfile(S.getProfile().id),
  'game:playServer': (ip: string) => {
    if (!/^[A-Za-z0-9.\-_]+(:\d{1,5})?$/.test(String(ip || '').trim())) return { ok: false, error: 'Sunucu IP adresi geçersiz.' }
    return playProfile(S.getProfile().id, String(ip).trim())
  },
  'game:stop': () => native('game.stop'),
  'game:state': () => gstate,
  'game:lastError': () => lastError,
  'profiles:list': async () => { const l = S.profilesList(); for (const p of l.profiles) p.dir = await profileDir(p as S.Profile).catch(() => ''); return l },
  'profiles:select': (id: string) => S.selectProfile(id),
  'profiles:save': (p: any) => S.upsertProfile(p),
  'profiles:remove': (id: string) => S.removeProfile(id),
  'profiles:openDir': () => true,
  'profiles:versions': async () => {
    if (versionCache && Date.now() - versionCache.t < 3600e3) return versionCache.v
    try {
      const [mj, fj] = await Promise.all([getJson<any>('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json'), getJson<any[]>('https://meta.fabricmc.net/v2/versions/game')])
      const fab = new Set<string>(fj.filter((g) => g.stable).map((g) => g.version))
      const v = mj.versions.filter((x: any) => x.type === 'release' && fab.has(x.id)).map((x: any) => x.id)
      versionCache = { t: Date.now(), v }; return v
    } catch { return versionCache?.v || ['1.21.11', '1.21.8', '1.21.4', '1.20.6', '1.20.1'] }
  },
  'profiles:supported': () => supportedVersions(),
  'stats:local': async () => fs.readJson(join(await profileDir(S.getProfile()), 'vtclient', 'stats.json'), null),
  'client:version': async () => installedVersion(await profileDir(S.getProfile())),
  // ---- Modrinth ----
  'mr:categories': async (k: mr.Kind) => { try { return await mr.categories(k) } catch { return [] } },
  'mr:search': async (a: any) => { try { return { ok: true, ...(await mr.search({ ...a, mc: S.getProfile(a.profileId).version })) } } catch (e) { return { ok: false, error: mr.describe(e).message } } },
  'mr:installed': async (a: any) => { try { return { ok: true, items: await mr.listInstalled(await profileDir(S.getProfile(a.profileId)), a.kind) } } catch { return { ok: false, items: [] } } },
  'mr:install': async (a: any) => { const p = S.getProfile(a.profileId); try { return { ok: true, installed: await mr.install(await profileDir(p), p.version, a.kind, a.projectId, (text) => emit('mr:progress', { projectId: a.projectId, text })) } } catch (e) { return { ok: false, error: mr.describe(e).message } } },
  'mr:updates': async (a: any) => { const p = S.getProfile(a.profileId); try { return { ok: true, updates: await mr.checkUpdates(await profileDir(p), p.version, a.kind) } } catch (e) { return { ok: false, updates: {}, error: mr.describe(e).message } } },
  'mr:update': async (a: any) => { const p = S.getProfile(a.profileId); try { return { ok: true, installed: await mr.updateItem(await profileDir(p), p.version, a.kind, a.file, (text) => emit('mr:progress', { projectId: a.file, text })) } } catch (e) { return { ok: false, error: mr.describe(e).message } } },
  'mr:remove': async (a: any) => { try { await mr.removeItem(await profileDir(S.getProfile(a.profileId)), a.kind, a.file); return { ok: true } } catch (e: any) { return { ok: false, error: e.message } } },
  'mr:toggle': async (a: any) => { try { await mr.toggleItem(await profileDir(S.getProfile(a.profileId)), a.kind, a.file); return { ok: true } } catch (e: any) { return { ok: false, error: e.message } } },
  'mr:addFiles': async (a: any) => mr.addFiles(await profileDir(S.getProfile(a.profileId)), a.kind, a.paths || []),
  'mr:pickFiles': async (a: any) => {
    const f = await native<{ path: string }[]>('ui.pickFiles', { mime: a.kind === 'mod' ? '*/*' : 'application/zip', multiple: true })
    return f.length ? mr.addFiles(await profileDir(S.getProfile(a.profileId)), a.kind, f.map((x) => x.path)) : 0
  },
  'mr:openDir': () => true,
  'mr:iris': async (profileId: string) => ({ installed: await mr.irisInstalled(await profileDir(S.getProfile(profileId))), id: mr.IRIS_ID }),
  // ---- updates ----
  'updater:state': () => updaterState,
  'updater:install': () => {
    if (dev.platform === 'ios') return native('app.openSource', { url: UPDATE_BASE + '/ios/apps.json', fallback: 'https://80-91-71-177.sslip.io/#iphone' })
    if (apkPath) return native('app.installApk', { path: apkPath })
  },
  'updater:check': () => { void checkApkUpdate(); return true },
  // ---- mobile only ----
  'mobile:info': () => dev,
  'mobile:renderers': () => native('game.renderers'),
  'mobile:openControls': () => native('ui.openNative', { screen: 'controls' }),
  'mobile:openNativeSettings': () => native('ui.openNative', { screen: 'settings' }),
  'mobile:requestMic': () => native('perm.mic'),
  'mobile:perm': () => native('perm.state'),
  'mobile:overlayPermission': () => native('perm.overlay'),
  'mobile:openNativeAccounts': () => native('ui.openNative', { screen: 'accounts' })
}

// ------------------------------------------------------------------ per-account settings sync (GET/PUT /v1/settings)
const pushTimers = new Map<string, ReturnType<typeof setTimeout>>()
function syncPush(section: string, data: any) {
  const a = S.getAccount(); if (!a?.apiToken || !data || typeof data !== 'object') return
  clearTimeout(pushTimers.get(section))
  pushTimers.set(section, setTimeout(() => { void apiCall(S.getSettings().apiBase, 'PUT', '/v1/settings/' + section, { data }, a.apiToken) }, 1500))
}
/** named client configs: pulled before launch (never overwrite local files), pushed when the game exits */
async function pullConfigs(dir: string) {
  const a = S.getAccount(); if (!a?.apiToken) return
  const r = await apiCall(S.getSettings().apiBase, 'GET', '/v1/settings', undefined, a.apiToken)
  const c = r.data?.sections?.configs?.data; if (!c || typeof c !== 'object') return
  const d = join(dir, 'vtclient', 'configs'); await fs.mkdir(d)
  for (const [name, text] of Object.entries<any>(c)) if (/^[\w .\-]{1,60}\.json$/.test(name) && typeof text === 'string' && !(await fs.exists(join(d, name)))) await fs.write(join(d, name), text)
}
async function pushConfigs(dir: string) {
  const out: Record<string, string> = {}
  try { for (const e of await fs.list(join(dir, 'vtclient', 'configs'))) if (/\.json$/i.test(e.name) && e.size < 20000) { const t = await fs.read(join(dir, 'vtclient', 'configs', e.name)); if (t) out[e.name] = t } } catch { /* none */ }
  if (Object.keys(out).length) syncPush('configs', out)
}
async function syncPull() {
  const a = S.getAccount(); if (!a?.apiToken) return
  const r = await apiCall(S.getSettings().apiBase, 'GET', '/v1/settings', undefined, a.apiToken)
  const sec = r.data?.sections; if (!sec) return
  const patch: Partial<S.MobileSettings> = {}
  if (sec.modules?.data) patch.modules = sec.modules.data
  if (sec.hud_mobile?.data) { patch.hud = sec.hud_mobile.data; patch.hudMobile = sec.hud_mobile.data }
  if (sec.voice?.data) patch.voice = { ...S.getSettings().voice, ...sec.voice.data }
  if (Object.keys(patch).length) { await S.patchSettings(patch); emit('settings:remote', patch) }
}

function bridgeSend(id: number | null, msg: any) { return native('bridge.send', { id, msg }) }

export async function installVt() {
  dev = await S.device()
  root = dev.root
  await S.loadSettings()
  mr.initModrinth(join(root, 'cache'))
  await fs.mkdir(join(root, 'cache'))
  await S.loadProfiles(root, MC_VERSION)
  bridge = await native<{ port: number; token: string }>('bridge.info')
  const listeners = new Set<(ch: string, ...a: any[]) => void>()
  onNative((ch, ...a) => {
    if (ch === 'game:exit') { void profileDir(S.getProfile()).then(pushConfigs).catch(() => {}); gstate = 'idle'; emit('game:state', 'idle'); emit('game:progress', { pct: 0, text: '' }) }
    if (ch === 'win:visible') { /* forwarded as is */ }
    for (const l of listeners) { try { l(ch, ...a) } catch (e) { console.error(e) } }
  })
  const vt = {
    invoke: async (name: string, ...args: any[]) => {
      const h = handlers[name]
      if (!h) { log('unhandled vt.invoke', name); return null }
      try { return await h(...args) } catch (e) { log('vt.invoke error', name, explain(e)); throw e }
    },
    pathFor: (_f: File) => '',
    on: (cb: (ch: string, ...a: any[]) => void) => { listeners.add(cb); return () => { listeners.delete(cb) } }
  }
  ;(window as any).vt = vt
  // events emitted from JS (emit) must reach vt.on listeners too
  onNative(() => {}) // keep the native listener registry alive
  setInterval(() => { void checkApkUpdate() }, 10 * 60e3)
  // iOS: the game runs inside the app process and quitting it closes the app (no game:exit), so named client configs are pushed while playing
  setInterval(() => { if (gstate === 'playing') void profileDir(S.getProfile()).then(pushConfigs).catch(() => {}) }, 2 * 60e3)
  setTimeout(() => { void checkApkUpdate() }, 8000)
  document.addEventListener('visibilitychange', () => { emit('win:visible', document.visibilityState !== 'hidden'); if (document.visibilityState === 'visible') void checkApkUpdate() })
  void native('ui.ready').catch(() => {})
  void rendererReady; void b64FromBytes; void DEFAULT_API; void deviceInfo; void cachedManifest; void download
}
