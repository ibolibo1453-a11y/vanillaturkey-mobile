import { emit } from './native'
// Browser-preview stand-in for the Kotlin bridge: lets the phone UI be laid out and screenshotted in a normal browser.
// It is only installed when window.VTAndroid is missing (never inside the APK).
const mem = new Map<string, string>()
const info = {
  version: '1.0.0', versionCode: 1, sdk: 34, abi: 'arm64-v8a', model: 'Preview', cpus: 8, totalMemMb: 8192, freeMemMb: 4096,
  widthPx: 2400, heightPx: 1080, dpi: 420, density: 2.6, refreshHz: 120, root: '/vt', gameHome: '/vt/game', vulkan: true
}

async function handle(name: string, a: any): Promise<any> {
  switch (name) {
    case 'app.info': return info
    case 'kv.get': return localStorage.getItem('mock.' + a.key)
    case 'kv.set': localStorage.setItem('mock.' + a.key, a.value); return true
    case 'kv.del': localStorage.removeItem('mock.' + a.key); return true
    case 'fs.read': return mem.get(a.path) ?? null
    case 'fs.write': mem.set(a.path, a.text); return true
    case 'fs.exists': return mem.has(a.path)
    case 'fs.list': return []
    case 'fs.mkdir': case 'fs.rm': case 'fs.rename': case 'fs.copy': case 'fs.writeB64': return true
    case 'fs.readB64': case 'fs.stat': return null
    case 'game.dir': return { dir: '/vt/game/versions/' + a.name }
    case 'bridge.info': return { port: 0, token: 'mock' }
    case 'uuid.offline': return { uuid: '00000000-0000-3000-8000-000000000000' }
    case 'http': {
      try {
        const r = await fetch(a.url, { method: a.method || 'GET', headers: a.headers, body: a.body })
        const headers: Record<string, string> = {}; r.headers.forEach((v, k) => { headers[k] = v })
        if (a.binary) { const b = new Uint8Array(await r.arrayBuffer()); let s = ''; b.forEach((x) => { s += String.fromCharCode(x) }); return { status: r.status, headers, b64: btoa(s) } }
        return { status: r.status, headers, text: await r.text() }
      } catch { return { status: 0, headers: {}, text: '' } }
    }
    case 'game.ensure': case 'game.launch': return { ok: true }
    case 'game.renderers': return []
    default: return null
  }
}

export function installMock() {
  window.VTAndroid = {
    call: (id, name, argsJson) => {
      let args: any = {}; try { args = JSON.parse(argsJson) } catch { /* */ }
      handle(name, args).then((v) => window.__vtResult!(id, true, JSON.stringify(v ?? null)), (e) => window.__vtResult!(id, false, JSON.stringify(String(e))))
    }
  }
  ;(window as any).__vtEmit = emit
  document.documentElement.dataset.mock = '1'
}
