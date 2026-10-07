import { http } from './native'

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
export const DEFAULT_API = 'https://80-91-71-177.sslip.io/vtapi'
export const UPDATE_BASE = 'https://80-91-71-177.sslip.io/vtclient'
export const MR_UA = 'VanillaTurkeyMobile/1.0 (vanillaturkey)'

export interface ApiResult { status: number; data: any; networkError?: boolean }

export async function withRetry<T>(fn: () => Promise<T>, o: { attempts?: number; baseMs?: number } = {}): Promise<T> {
  const n = o.attempts || 3
  let last: any
  for (let i = 0; i < n; i++) {
    try { return await fn() } catch (e) { last = e; if (i < n - 1) await sleep((o.baseMs || 500) * (i + 1)) }
  }
  throw last
}

export async function getJson<T = any>(url: string, what = 'İstek', o: { attempts?: number; timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<T> {
  return withRetry(async () => {
    const r = await http({ url, headers: { accept: 'application/json', 'user-agent': MR_UA, ...(o.headers || {}) }, timeoutMs: o.timeoutMs || 15000 })
    if (r.status === 0) throw Object.assign(new Error(`${what}: bağlantı kurulamadı`), { status: 0 })
    if (r.status < 200 || r.status >= 300) throw Object.assign(new Error(`${what}: HTTP ${r.status}`), { status: r.status })
    return JSON.parse(r.text || 'null') as T
  }, { attempts: o.attempts || 3 })
}

/** JSON call against the VanillaTurkey API. Never throws. GETs are retried. `x-vt-device: mobile` lets the API show "Telefonda". */
export async function apiCall(base: string, method: string, path: string, body?: any, token?: string): Promise<ApiResult> {
  const tries = method === 'GET' ? 3 : 2
  let net = false
  for (let i = 0; i < tries; i++) {
    try {
      const r = await http({
        method, url: base.replace(/\/+$/, '') + path, timeoutMs: 12000,
        headers: { 'content-type': 'application/json', 'x-vt-device': 'mobile', ...(token ? { authorization: 'Bearer ' + token } : {}) },
        body: body !== undefined && method !== 'GET' ? JSON.stringify(body) : undefined
      })
      if (r.status === 0) throw new Error('net')
      let data: any = null
      try { data = JSON.parse(r.text || 'null') } catch { /* non-json */ }
      if (r.status >= 502 && r.status <= 504 && i < tries - 1) { await sleep(500 * (i + 1)); continue }
      return { status: r.status, data }
    } catch { net = true; if (i < tries - 1) await sleep(500 * (i + 1)) }
  }
  return { status: 0, data: null, networkError: net }
}

export async function apiRaw(base: string, method: string, path: string, o: { bodyB64?: string; headers?: Record<string, string>; token?: string; timeoutMs?: number } = {}): Promise<ApiResult> {
  try {
    const r = await http({ method, url: base.replace(/\/+$/, '') + path, bodyB64: o.bodyB64, timeoutMs: o.timeoutMs || 40000, headers: { 'x-vt-device': 'mobile', ...(o.token ? { authorization: 'Bearer ' + o.token } : {}), ...(o.headers || {}) } })
    if (r.status === 0) return { status: 0, data: null, networkError: true }
    let data: any = null
    try { data = JSON.parse(r.text || 'null') } catch { /* */ }
    return { status: r.status, data }
  } catch { return { status: 0, data: null, networkError: true } }
}

export const explain = (e: any) => String(e?.message || e || 'bilinmeyen hata').slice(0, 300)

export const b64FromBytes = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s) }
export const bytesFromB64 = (s: string) => { const bin = atob(s); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b }

/** multipart body for an uploaded file, returned as base64 + content-type header */
export function multipart(name: string, type: string, data: Uint8Array) {
  const bnd = '----vt' + Math.random().toString(16).slice(2) + Date.now().toString(16)
  const head = new TextEncoder().encode(`--${bnd}\r\nContent-Disposition: form-data; name="file"; filename="${String(name || 'file').replace(/[^\w.\-]/g, '_')}"\r\nContent-Type: ${type || 'application/octet-stream'}\r\n\r\n`)
  const tail = new TextEncoder().encode(`\r\n--${bnd}--\r\n`)
  const all = new Uint8Array(head.length + data.length + tail.length)
  all.set(head, 0); all.set(data, head.length); all.set(tail, head.length + data.length)
  return { bodyB64: b64FromBytes(all), headers: { 'content-type': 'multipart/form-data; boundary=' + bnd } }
}
