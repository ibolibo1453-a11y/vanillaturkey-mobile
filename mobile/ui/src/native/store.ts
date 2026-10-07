// Persistent state of the Android launcher: settings.json, profiles.json and the signed-in account (all in the app's private storage).
import { fs, kv, deviceInfo, type DeviceInfo } from './native'
import { DEFAULT_API } from './net'

export interface MobileSettings {
  ramMb: number; javaPath: string; resW: number; resH: number; fullscreen: boolean
  autoConnect: boolean; discordRpc: boolean; autoUpdate: boolean; startWithWindows: boolean
  lang: string; remember: boolean; closeOnLaunch: boolean; afterLaunch: string; apiBase: string
  jvmPreset: string; perfPack: boolean; perfActive: string[]; fastGraphics: boolean; muteGame: boolean
  modules: Record<string, boolean>; customSkin: string; skinName: string; equipped: Record<string, string>; lastUser: string
  voice: Record<string, any>; closeToTray: boolean; skinSlim: boolean; hud: Record<string, any>; clientCfg: Record<string, any>
  // mobile only
  renderer: string; experimentalSodium: boolean; hudMobile: Record<string, any>
}
export interface Profile { id: string; name: string; version: string; ramMb: number; perfPack: boolean; dir: string; createdAt: number; lastPlayed?: number }
export interface Account {
  username: string; uuid: string; apiToken: string; offline: boolean
  ms?: { accessToken: string; uuid: string; name: string }
}

let dev: DeviceInfo | null = null
export const device = async () => dev || (dev = await deviceInfo())

export async function defaults(): Promise<MobileSettings> {
  const d = await device()
  const ram = Math.max(1536, Math.min(6144, Math.round((d.totalMemMb * 0.42) / 256) * 256))
  return {
    ramMb: ram, javaPath: '', resW: d.widthPx, resH: d.heightPx, fullscreen: true, autoConnect: false, discordRpc: false,
    autoUpdate: true, startWithWindows: false, lang: 'tr', remember: true, closeOnLaunch: false, afterLaunch: 'keep', apiBase: DEFAULT_API,
    jvmPreset: 'balanced', perfPack: true, perfActive: [], fastGraphics: true, muteGame: false, modules: {}, customSkin: '', skinName: '', equipped: {}, lastUser: '',
    voice: {}, closeToTray: true, skinSlim: false, hud: {}, clientCfg: {},
    renderer: '', experimentalSodium: false, hudMobile: {}
  }
}

let settings: MobileSettings | null = null
export async function loadSettings(): Promise<MobileSettings> {
  const base = await defaults()
  let saved: Partial<MobileSettings> = {}
  try { saved = JSON.parse((await kv.get('settings')) || '{}') } catch { /* fresh install */ }
  settings = { ...base, ...saved }
  if (!settings.apiBase || /trhub\.net/.test(settings.apiBase)) settings.apiBase = DEFAULT_API
  // developer override for emulator tests (adb: run-as <pkg> sh -c 'echo http://10.0.2.2:4899/vtapi > files/vt/dev-api.txt'); debug builds only matter in practice
  try { const o = ((await fs.read((await device()).root + '/dev-api.txt')) || '').trim(); if (/^https?:\/\//.test(o)) settings.apiBase = o } catch { /* no override */ }
  return settings
}
export const getSettings = () => settings!
export async function patchSettings(p: Partial<MobileSettings>) { settings = { ...settings!, ...p }; await kv.set('settings', JSON.stringify(settings)); return settings }

// ---- account (token kept in the app-private key/value store) ----
let account: Account | null = null
export const getAccount = () => account
export const setAccount = (a: Account | null) => { account = a }
export async function persistAccount() {
  if (!account || !settings?.remember || account.offline) { await kv.del('account'); return }
  await kv.set('account', JSON.stringify(account))
}
export async function restoreAccount(): Promise<Account | null> {
  try { const t = await kv.get('account'); if (!t) return null; account = JSON.parse(t) as Account; return account } catch { return null }
}
export const publicAccount = (a: Account | null) => a && ({ username: a.username, uuid: a.uuid, offline: a.offline, ms: !!a.ms })

// ---- profiles ----
const file = (root: string) => root + '/profiles.json'
interface PStore { selected: string; profiles: Profile[] }
let pstore: PStore = { selected: '', profiles: [] }
let root = ''
export async function loadProfiles(r: string, defaultVersion: string) {
  root = r
  pstore = await fs.readJson<PStore>(file(root), { selected: '', profiles: [] })
  if (!Array.isArray(pstore.profiles) || !pstore.profiles.length) {
    const s = getSettings()
    pstore = { selected: 'vanillaturkey', profiles: [{ id: 'vanillaturkey', name: 'VanillaTurkey', version: defaultVersion, ramMb: s.ramMb, perfPack: true, dir: '', createdAt: Date.now() }] }
  }
  if (!pstore.profiles.find((p) => p.id === pstore.selected)) pstore.selected = pstore.profiles[0].id
  await saveProfiles()
}
const saveProfiles = () => fs.writeJson(file(root), pstore)
export const profilesList = () => ({ selected: pstore.selected, profiles: pstore.profiles.map((p) => ({ ...p, modCount: 0 })) })
export const getProfile = (id?: string): Profile => pstore.profiles.find((p) => p.id === (id || pstore.selected)) || pstore.profiles[0]
export async function selectProfile(id: string) { if (pstore.profiles.some((p) => p.id === id)) { pstore.selected = id; await saveProfiles() } return profilesList() }
export async function touchProfile(id: string) { getProfile(id).lastPlayed = Date.now(); await saveProfiles() }
export async function upsertProfile(p: Partial<Profile> & { name: string; version: string }) {
  const s = getSettings()
  const name = String(p.name || '').trim().slice(0, 32) || 'Profil'
  const ramMb = Math.max(1024, Math.min(65536, Number(p.ramMb) || s.ramMb))
  const perfPack = p.perfPack !== false
  const ex = p.id ? pstore.profiles.find((x) => x.id === p.id) : undefined
  if (ex) Object.assign(ex, { name, version: p.version, ramMb, perfPack })
  else {
    let id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'profil'
    while (pstore.profiles.some((x) => x.id === id)) id += '-' + Math.random().toString(16).slice(2, 6)
    pstore.profiles.push({ id, name, version: p.version, ramMb, perfPack, dir: '', createdAt: Date.now() })
    pstore.selected = id
  }
  await saveProfiles(); return profilesList()
}
export async function removeProfile(id: string) {
  if (pstore.profiles.length <= 1) return profilesList()
  pstore.profiles = pstore.profiles.filter((p) => p.id !== id)
  if (pstore.selected === id) pstore.selected = pstore.profiles[0].id
  await saveProfiles(); return profilesList()
}
