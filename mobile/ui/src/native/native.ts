// Thin typed wrapper over the native bridge: Android = Kotlin `VTAndroid` JavaScript interface (mobile/launcher-src/.../vt/VtNative.kt),
// iOS = WKScriptMessageHandler `webkit.messageHandlers.vt` (ios/amethyst/Natives/vt/VtRpc.m). Same call names and result shapes on both.
// Every call is async: native runs it off the UI thread and answers through window.__vtResult(id, ok, json).
declare global {
  interface Window {
    VTAndroid?: { call(id: number, name: string, argsJson: string): void }
    webkit?: { messageHandlers?: { vt?: { postMessage(msg: unknown): void } } }
    __vtResult?: (id: number, ok: boolean, json: string) => void
    __vtEvent?: (ch: string, json: string) => void
  }
}

let seq = 1
const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>()
const listeners = new Set<(ch: string, ...a: any[]) => void>()

window.__vtResult = (id, ok, json) => {
  const p = pending.get(id); if (!p) return; pending.delete(id)
  let v: any = null; try { v = json ? JSON.parse(json) : null } catch { v = json }
  if (ok) p.res(v); else p.rej(new Error(typeof v === 'string' ? v : v?.message || 'native error'))
}
window.__vtEvent = (ch, json) => {
  let a: any[] = []; try { a = json ? JSON.parse(json) : [] } catch { a = [json] }
  for (const l of listeners) { try { l(ch, ...(Array.isArray(a) ? a : [a])) } catch (e) { console.error('vt event', ch, e) } }
}

const iosHandler = () => window.webkit?.messageHandlers?.vt
export const isIOS = () => !!iosHandler()
export const hasNative = () => !!window.VTAndroid || !!iosHandler()
export function native<T = any>(name: string, args: any = {}): Promise<T> {
  if (!window.VTAndroid && !iosHandler()) return Promise.reject(new Error('Yerel köprü yok (tarayıcı önizleme)'))
  return new Promise<T>((res, rej) => {
    const id = seq++
    pending.set(id, { res, rej })
    try {
      const argsJson = JSON.stringify(args)
      if (window.VTAndroid) window.VTAndroid.call(id, name, argsJson)
      else iosHandler()!.postMessage({ id, name, args: argsJson })
    } catch (e) { pending.delete(id); rej(e as Error) }
  })
}
/** subscribe to events pushed by Kotlin (game:state, bridge:in, dl:progress, ...) */
export const onNative = (cb: (ch: string, ...a: any[]) => void) => { listeners.add(cb); return () => { listeners.delete(cb) } }
/** events that stay inside JS (the launcher renderer listens through window.vt.on) */
export const emit = (ch: string, ...a: any[]) => { for (const l of listeners) { try { l(ch, ...a) } catch (e) { console.error('vt emit', ch, e) } } }

export interface FsEntry { name: string; isDir: boolean; size: number; mtime: number }
export interface HttpRes { status: number; headers: Record<string, string>; text?: string; b64?: string }
export interface DeviceInfo {
  version: string; versionCode: number; platform?: string; sdk: number; abi: string; model: string; cpus: number
  totalMemMb: number; freeMemMb: number; widthPx: number; heightPx: number; dpi: number; density: number; refreshHz: number
  root: string; gameHome: string; gpu?: string; vulkan?: boolean
}

export const fs = {
  read: (p: string) => native<string | null>('fs.read', { path: p }),
  write: (p: string, text: string) => native<boolean>('fs.write', { path: p, text }),
  writeB64: (p: string, b64: string) => native<boolean>('fs.writeB64', { path: p, b64 }),
  readB64: (p: string) => native<string | null>('fs.readB64', { path: p }),
  exists: (p: string) => native<boolean>('fs.exists', { path: p }),
  list: (p: string) => native<FsEntry[]>('fs.list', { path: p }),
  mkdir: (p: string) => native<boolean>('fs.mkdir', { path: p }),
  rm: (p: string) => native<boolean>('fs.rm', { path: p }),
  rename: (a: string, b: string) => native<boolean>('fs.rename', { from: a, to: b }),
  copy: (a: string, b: string) => native<boolean>('fs.copy', { from: a, to: b }),
  stat: (p: string) => native<{ size: number; mtime: number; isDir: boolean } | null>('fs.stat', { path: p }),
  sha: (p: string, alg: 'sha1' | 'sha256' | 'sha512') => native<string>('fs.sha', { path: p, alg }),
  readJson: async <T,>(p: string, def: T): Promise<T> => { try { const t = await fs.read(p); return t ? (JSON.parse(t) as T) : def } catch { return def } },
  writeJson: (p: string, v: unknown) => fs.write(p, JSON.stringify(v, null, 2))
}
export const kv = {
  get: (k: string) => native<string | null>('kv.get', { key: k }),
  set: (k: string, v: string) => native<boolean>('kv.set', { key: k, value: v }),
  del: (k: string) => native<boolean>('kv.del', { key: k })
}
export const http = (o: { method?: string; url: string; headers?: Record<string, string>; body?: string; bodyB64?: string; timeoutMs?: number; binary?: boolean }) => native<HttpRes>('http', o)
export const download = (o: { url: string; dest: string; sha256?: string; sha1?: string; timeoutMs?: number; tag?: string }) => native<boolean>('download', o)
export const deviceInfo = () => native<DeviceInfo>('app.info')
