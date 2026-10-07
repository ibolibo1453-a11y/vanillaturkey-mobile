// R5-C coin economy, client side (launcher + PWA share this file). The API is authoritative: the balance, ownership, prices,
// daily reward and purchases all live on the server; this module only mirrors them and exposes a small store.
import { useSyncExternalStore } from 'react'

export interface ApiRes { status: number; data: any }
export type CoinsApiFn = (method: string, path: string, body?: any) => Promise<ApiRes>
let api: CoinsApiFn = (m, p, b) => (window as any).vt.invoke('api:call', m, p, b, true)
/** The PWA has no window.vt: it plugs its fetch-based client in here. */
export const setCoinsApi = (f: CoinsApiFn) => { api = f }

export interface CoinsMe {
  balance: number; streak: number; claimedToday: boolean; nextReward: number; nextBonus: number
  todayPlayCoins: number; playCapCoins: number; playSecondsToNext: number; owned: string[]
  tasks: Record<string, { coins: number; label: string; done: boolean }>
}
export interface Sale { id: number; name: string; percent: number; scope: string; endsAt: number }
export interface Shop { prices: Record<string, number>; salePrices: Record<string, number>; hidden: string[]; sales: Sale[] }
export interface HistoryRow { id: number; delta: number; kind: string; note: string; balance: number; at: number }
interface State { me: CoinsMe | null; shop: Shop | null }

let state: State = { me: null, shop: null }
const subs = new Set<() => void>()
const set = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach((f) => f()) }
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
export const useCoins = () => useSyncExternalStore(subscribe, () => state)
export const coinsState = () => state
export const resetCoins = () => { state = { me: null, shop: null }; subs.forEach((f) => f()) }

export async function refreshCoins() {
  const r = await api('GET', '/v1/coins/me').catch(() => null)
  if (r?.data?.ok) set({ me: r.data as CoinsMe })
  return state.me
}
export async function refreshShop() {
  const r = await api('GET', '/v1/coins/prices').catch(() => null)
  if (r?.data?.ok) set({ shop: r.data as Shop })
  return state.shop
}
export interface DailyResult { claimed: boolean; reward: number; bonus: number; streak: number; balance: number }
export async function claimDaily(): Promise<DailyResult | null> {
  const r = await api('POST', '/v1/coins/daily', {}).catch(() => null)
  if (!r?.data?.ok) return null
  await refreshCoins()
  return r.data as DailyResult
}
export async function loadHistory(before = 0): Promise<HistoryRow[]> {
  const r = await api('GET', '/v1/coins/history?limit=50' + (before ? '&before=' + before : '')).catch(() => null)
  return r?.data?.ok ? (r.data.history as HistoryRow[]) : []
}
export interface BuyResult { ok: boolean; error?: string; message?: string; price?: number; balance?: number }
export async function buyCosmetic(id: string): Promise<BuyResult> {
  const r = await api('POST', '/v1/coins/buy', { id }).catch(() => null)
  if (!r) return { ok: false, error: 'network', message: 'Sunucuya ulaşılamadı.' }
  if (r.data?.ok) await refreshCoins()
  return { ok: !!r.data?.ok, error: r.data?.error, message: r.data?.message, price: r.data?.price, balance: r.data?.balance }
}

export const baseOf = (id?: string) => (id && id.startsWith('renklerin_') ? 'renklerin' : id || '')
/** price a player pays now: server list price (admin overrides) with a running sale applied; falls back to the bundled catalog price */
export function priceInfo(id: string, catalogPrice: number, s: State = state) {
  const list = s.shop?.prices[id] ?? catalogPrice
  const price = s.shop?.salePrices[id] ?? list
  return { list, price, onSale: price < list, hidden: !!s.shop?.hidden.includes(id) }
}
/** free items (list price 0) are always owned */
export function isOwned(id: string, catalogPrice: number, s: State = state) {
  const b = baseOf(id)
  return priceInfo(b, catalogPrice, s).list <= 0 || !!s.me?.owned.includes(b)
}

export const KIND_LABEL: Record<string, string> = { daily: 'Günlük giriş', streak: 'Seri ödülü', play: 'Oynama', task: 'Görev', buy: 'Satın alma', admin: 'Yönetici', migrate: 'Başlangıç hediyesi' }
export const when = (ms: number) => new Date(ms).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** daily reward text for the toast: "+10 coin · 6 gün seri" */
export const dailyText = (d: DailyResult) => `+${d.reward + d.bonus} coin · ${d.streak} gün seri${d.bonus ? ` (+${d.bonus} bonus)` : ''}`
