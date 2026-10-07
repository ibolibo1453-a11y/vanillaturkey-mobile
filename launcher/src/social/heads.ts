// Player heads from the server skin system (GET /v1/skins/<name>.png). One cache, placeholder first, never blank.
import type { SocialAdapter } from './types'

const lc = (s: string) => (s || '').toLowerCase()
const heads = new Map<string, string>()
const skins = new Map<string, string>()
const pending = new Map<string, Promise<string>>()
const subs = new Set<(name: string) => void>()
export const onSkinChange = (fn: (name: string) => void) => { subs.add(fn); return () => { subs.delete(fn) } }

const defaults: Record<string, string> = {}
const DEFAULT_SRC: Record<string, string> = { steve: 'skins/steve.png', alex: 'skins/alex.png' }
const stale = new Set<string>()
const tiny = 'data:image/gif;base64,R0lGODlhAQABAIAAAIdhRwAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw=='
/** Java UUID.hashCode() parity picks Steve (even) or Alex (odd), like the game. Without a uuid: by name. */
export function defaultKind(name: string, uuid?: string): 'steve' | 'alex' {
  const hex = (uuid || '').replace(/-/g, '')
  if (hex.length === 32) { const hi = BigInt('0x' + hex.slice(0, 16)), lo = BigInt('0x' + hex.slice(16)); return Number((hi ^ lo) & 1n) ? 'alex' : 'steve' }
  let h = 0; for (const c of name.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) | 0
  return h & 1 ? 'alex' : 'steve'
}
function loadDefaults() {
  for (const k of Object.keys(DEFAULT_SRC)) {
    const im = new Image(); im.onload = () => { defaults[k] = drawHead(im); for (const f of subs) f('') }; im.src = DEFAULT_SRC[k]
  }
}
/** Real default face (Steve/Alex head + hat layer) while the actual skin loads; never a flat color. */
export function placeholderHead(name: string): string { return defaults[defaultKind(name)] || tiny }
export const cachedHead = (name: string) => heads.get(lc(name))
export const isStale = (name: string) => stale.has(lc(name))
export const cachedSkin = (name: string) => skins.get(lc(name))

function drawHead(img: HTMLImageElement): string {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64
  const c = cv.getContext('2d')!; c.imageSmoothingEnabled = false
  c.drawImage(img, 8, 8, 8, 8, 0, 0, 64, 64)
  if (img.height >= 64) c.drawImage(img, 40, 8, 8, 8, 0, 0, 64, 64) // hat layer (not present on 64x32 legacy skins)
  return cv.toDataURL('image/png')
}
let globalLoader: ((n: string) => Promise<string | null>) | null = null
/** Host-level skin source used before a SocialClient exists (topbar avatar, login). */
export const setSkinLoader = (fn: (n: string) => Promise<string | null>) => { globalLoader = fn }
export function loadHead(a: Pick<SocialAdapter, 'skin'> | null, name: string): Promise<string> {
  const k = lc(name); const hit = heads.get(k); if (hit && !stale.has(k)) return Promise.resolve(hit)
  let p = pending.get(k)
  if (!p) {
    p = (async () => {
      for (let i = 0; i < 2; i++) {
        const url = await (a ? a.skin(name) : globalLoader ? globalLoader(name) : Promise.resolve(null)).catch(() => null)
        if (url) {
          const head = await new Promise<string | null>((res) => { const im = new Image(); im.onload = () => { try { skins.set(k, url); res(drawHead(im)) } catch { res(null) } }; im.onerror = () => res(null); im.src = url })
          if (head) { heads.set(k, head); stale.delete(k); return head }
        }
        await new Promise((r) => setTimeout(r, 1200))
      }
      return heads.get(k) || placeholderHead(name)
    })().finally(() => pending.delete(k))
    pending.set(k, p)
  }
  return p
}
export function invalidateHead(a: Pick<SocialAdapter, 'invalidateSkin'> | null, name: string) {
  const k = lc(name); stale.add(k); skins.delete(k); a?.invalidateSkin?.(name) // keep showing the old face until the new one arrives
  for (const f of subs) f(name)
}
loadDefaults()
