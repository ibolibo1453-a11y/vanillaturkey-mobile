import { onSkinChange } from './social'
import { defaultKind } from './social/heads'
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

export interface Settings {
  ramMb: number; javaPath: string; resW: number; resH: number; fullscreen: boolean
  autoConnect: boolean; discordRpc: boolean; autoUpdate: boolean; startWithWindows: boolean
  lang: string; remember: boolean; closeOnLaunch: boolean; afterLaunch: string; apiBase: string
  jvmPreset: string; perfPack: boolean; perfActive: string[]; fastGraphics: boolean; muteGame: boolean
  modules: Record<string, boolean>; customSkin: string; skinName: string; equipped: Record<string, string>; lastUser: string
  voice: Record<string, any>; closeToTray: boolean; skinSlim: boolean; hud: Record<string, any>; clientCfg: Record<string, any>
}
export interface Acc { username: string; uuid: string; offline: boolean; ms: boolean }
export interface Profile { id: string; name: string; version: string; ramMb: number; perfPack: boolean; dir: string; createdAt: number; lastPlayed?: number; modCount: number }
export interface ProfilesState { selected: string; profiles: Profile[] }
export type GState = 'idle' | 'installing' | 'launching' | 'playing'
export interface GameErr { step: string; message: string }
export interface Updater { state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'; version?: string; pct?: number; error?: string }
export interface Friend { name: string; online: boolean; status: string; since?: number }
export interface FriendsState { friends: Friend[]; incoming: { name: string; at: number }[]; outgoing: { name: string; at: number }[]; loaded: boolean; error: string }

interface Ctx {
  settings: Settings; setSetting: (p: Partial<Settings>) => void; applyRemote: (p: Partial<Settings>) => void
  account: Acc | null; setAccount: (a: Acc | null) => void
  skin: string; gstate: GState; progress: { pct: number; text: string }; gameError: GameErr | null; clearError: () => void
  updater: Updater; clientUpdating: string
  friends: FriendsState; refreshFriends: () => Promise<void>; friendAct: (act: 'request' | 'accept' | 'decline' | 'remove', name: string) => Promise<{ ok: boolean; error?: string }>
  awake: boolean // window visible and game not running: backdrop video may play
  info: { totalMemMb: number; freeMemMb: number; cpus: number; gameDir: string; version: string }
  toast: (msg: string, kind?: 'ok' | 'err') => void
  play: () => Promise<void>; playServer: (ip: string) => Promise<void>; stop: () => void
  fakeProgress: () => void
  profiles: ProfilesState; setProfiles: (p: ProfilesState) => void; current: Profile | null
}
const C = createContext<Ctx>(null as any)
export const useApp = () => useContext(C)

export const Provider = ({ initial, info, children }: { initial: Settings; info: Ctx['info']; children: React.ReactNode }) => {
  const [settings, setSettings] = useState<Settings>(initial)
  const [account, setAccount] = useState<Acc | null>(null)
  const [fetched, setFetched] = useState('')
  const prevUser = useRef<string | undefined>(undefined)
  const [gstate, setG] = useState<GState>('idle')
  const [progress, setProgress] = useState({ pct: 0, text: '' })
  const [gameError, setErr] = useState<GameErr | null>(null)
  const [updater, setUpdater] = useState<Updater>({ state: 'idle' })
  const [clientUpdating, setClientUpdating] = useState('')
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden')
  const [friends, setFriends] = useState<FriendsState>({ friends: [], incoming: [], outgoing: [], loaded: false, error: '' })
  const prevOnline = useRef<Set<string> | null>(null)
  const prevIn = useRef<Set<string> | null>(null)
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([])
  const idRef = useRef(0)
  const [profiles, setProfiles] = useState<ProfilesState>({ selected: '', profiles: [] })
  useEffect(() => { window.vt.invoke('profiles:list').then(setProfiles) }, [])
  const current = profiles.profiles.find((p) => p.id === profiles.selected) || null

  // Skin = server skin system (GET /v1/skins/<name>.png via the main process, cached, refreshed on skin_upd).
  // Offline accounts have no server skin, so their locally chosen skin wins; a placeholder is always drawn, never blank.
  useEffect(() => {
    if (prevUser.current !== account?.username) { prevUser.current = account?.username; setFetched('') }
    if (!account) return
    let live = true; let tries = 0
    const load = () => window.vt.invoke('skin:get', account.username).then((d: string | null) => {
      if (!live) return
      if (d) setFetched(d); else if (tries++ < 4) setTimeout(load, 3000 * tries)
    })
    load()
    const off = onSkinChange((n) => { if (n.toLowerCase() === account.username.toLowerCase()) { tries = 0; load() } })
    return () => { live = false; off() }
  }, [account?.username])
  const placeholder = `skins/${defaultKind(account?.username || '', account?.uuid)}.png`
  const skin = account?.offline ? (settings.customSkin || fetched || placeholder) : (fetched || settings.customSkin || placeholder)

  const toast = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    const id = ++idRef.current
    setToasts((t) => [...t, { id, msg, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }, [])
  const applyRemote = useCallback((p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p })), [])
  const setSetting = useCallback((p: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...p }))
    window.vt.invoke('settings:set', p)
  }, [])

  useEffect(() => {
    const h = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', h)
    window.vt.invoke('updater:state').then(setUpdater)
    return () => document.removeEventListener('visibilitychange', h)
  }, [])

  const refreshFriends = useCallback(async () => {
    if (!account || account.offline) { setFriends((f) => ({ ...f, loaded: true })); return }
    const r = await window.vt.invoke('api:call', 'GET', '/v1/friends', undefined, true)
    if (r?.data?.ok) {
      const d = r.data
      const list: Friend[] = (d.friends || []).slice().sort((a: Friend, b: Friend) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))
      const incoming = d.incoming || [], outgoing = d.outgoing || []
      const online = new Set(list.filter((f) => f.online).map((f) => f.name.toLowerCase()))
      if (prevOnline.current) for (const f of list) if (f.online && !prevOnline.current.has(f.name.toLowerCase())) toast(`${f.name} çevrimiçi oldu.`)
      if (prevIn.current) for (const q of incoming) if (!prevIn.current.has(q.name.toLowerCase())) toast(`${q.name} sana arkadaşlık isteği gönderdi.`)
      prevOnline.current = online; prevIn.current = new Set(incoming.map((q: any) => q.name.toLowerCase()))
      setFriends({ friends: list, incoming, outgoing, loaded: true, error: '' })
    } else setFriends((f) => ({ ...f, loaded: true, error: r?.networkError ? 'Sunucuya ulaşılamadı.' : r?.data?.error || (r?.status === 404 ? 'Arkadaş sistemi henüz etkin değil.' : 'Arkadaşlar yüklenemedi.') }))
  }, [account, toast])
  const friendAct = useCallback(async (act: 'request' | 'accept' | 'decline' | 'remove', name: string) => {
    const r = await window.vt.invoke('api:call', 'POST', '/v1/friends/' + act, { name }, true)
    const ok = !!r?.data?.ok
    if (ok) { refreshFriends(); if (act === 'request') toast('Arkadaşlık isteği gönderildi.') }
    return { ok, error: ok ? undefined : r?.networkError ? 'Sunucuya ulaşılamadı.' : r?.data?.error || 'İşlem başarısız.' }
  }, [refreshFriends, toast])
  // poll friends every 30 s and send the launcher presence ("Launcher'da") while logged in
  useEffect(() => {
    if (!account) { prevOnline.current = null; prevIn.current = null; setFriends({ friends: [], incoming: [], outgoing: [], loaded: false, error: '' }); return }
    refreshFriends()
    const beat = () => window.vt.invoke('api:presence', "Launcher'da")
    beat()
    const t = setInterval(() => { refreshFriends(); beat() }, 30000)
    return () => clearInterval(t)
  }, [account?.username])

  useEffect(() => window.vt.on((ch, a) => {
    if (ch === 'game:state') setG(a)
    else if (ch === 'win:visible') setVisible(!!a)
    else if (ch === 'settings:remote') setSettings((st) => ({ ...st, ...a }))
    else if (ch === 'shot:fakeerror') { setG('idle'); setErr(a) }
    else if (ch === 'shot:fakefriends') setFriends({ loaded: true, error: '', friends: [{ name: 'Emre_TR', online: true, status: 'Sunucu: mc.ornek.net' }, { name: 'Zeynep', online: true, status: "Launcher'da" }, { name: 'KaanPvP', online: true, status: 'Tek oyunculu' }, { name: 'Mert34', online: false, status: '' }, { name: 'Elif', online: false, status: '', since: Date.now() - 3 * 3600e3 }], incoming: [{ name: 'Burak_01', at: Date.now() - 600e3 }], outgoing: [{ name: 'Selin', at: Date.now() - 86400e3 }] })
    else if (ch === 'updater') setUpdater(a)
    else if (ch === 'update:client') { setClientUpdating(a.phase === 'start' ? a.version || '?' : ''); if (a.phase === 'failed') toast('Client güncellemesi başarısız oldu.', 'err') }
    else if (ch === 'game:progress') setProgress(a)
    else if (ch === 'game:error') { setErr(typeof a === 'string' ? { step: 'Başlatma', message: a } : a); toast(`${a.step || 'Oyun'}: kurulum başarısız`, 'err') }
    else if (ch === 'game:perf') setSettings((s) => ({ ...s, perfActive: a }))
    else if (ch === 'game:exit') toast('Oyun kapandı.')
  }), [toast])

  const play = useCallback(async () => {
    setErr(null)
    const r = await window.vt.invoke('game:play')
    if (!r.ok && !r.step) toast(r.error || 'Başlatılamadı', 'err')
  }, [toast])
  // R5-A: launch the selected profile and quick-join a sponsor server
  const playServer = useCallback(async (ip: string) => {
    setErr(null)
    const r = await window.vt.invoke('game:playServer', ip)
    if (!r.ok && !r.step) toast(r.error || 'Başlatılamadı', 'err')
  }, [toast])
  const clearError = useCallback(() => setErr(null), [])
  const stop = useCallback(() => { window.vt.invoke('game:stop') }, [])
  const fakeProgress = useCallback(() => { setG('installing'); setProgress({ pct: 63, text: 'Kütüphaneler ve kaynaklar 63%' }) }, [])

  return (
    <C.Provider value={{ profiles, setProfiles, current, skin, settings, setSetting, applyRemote, account, setAccount, gstate, progress, gameError, clearError, updater, clientUpdating, friends, refreshFriends, friendAct, awake: visible && gstate === 'idle', info, toast, play, playServer, stop, fakeProgress }}>
      {children}
      <div className="toasts">{toasts.map((t) => <div key={t.id} className={'toast ' + t.kind}>{t.msg}</div>)}</div>
    </C.Provider>
  )
}
