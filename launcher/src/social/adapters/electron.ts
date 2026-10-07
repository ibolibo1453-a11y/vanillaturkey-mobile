import type { SocialAdapter, VoicePrefs, ApiRes } from '../types'
import { DEFAULT_VOICE } from '../types'

export interface ElectronSession { apiBase: string; token: string; username: string; offline: boolean }

/** Adapter for the Electron launcher: REST + uploads + skins go through the main process (IPv4-safe, token stays in main). */
export function createElectronAdapter(s: ElectronSession): SocialAdapter {
  const vt = window.vt
  const origin = (() => { try { return new URL(s.apiBase).origin } catch { return '' } })()
  const base = s.apiBase.replace(/\/+$/, '')
  return {
    platform: 'electron',
    me: () => (s.offline || !s.token ? '' : s.username),
    api: (method, path, body) => vt.invoke('api:call', method, path, body, true) as Promise<ApiRes>,
    upload: (data, name, type) => vt.invoke('social:upload', { data, name, type }) as Promise<ApiRes>,
    wsUrl: async () => (s.token ? base.replace(/^http/, 'ws') + '/v1/ws?token=' + encodeURIComponent(s.token) : null),
    mediaUrl: (p) => (!p ? '' : /^(https?:|data:|blob:)/.test(p) ? p : p.startsWith('/vtapi/') ? origin + p : p.startsWith('/') ? base + p : base + '/' + p),
    skin: (name) => vt.invoke('skin:get', name).catch(() => null),
    mediaData: (u) => vt.invoke('social:media', u).catch(() => null),
    invalidateSkin: (name) => { vt.invoke('skin:invalidate', name) },
    loadPrefs: async () => ((await vt.invoke('settings:get'))?.voice || {}) as Partial<VoicePrefs>,
    savePrefs: (p) => { vt.invoke('settings:set', { voice: { ...DEFAULT_VOICE, ...p } }) },
    osNotify: (n) => { vt.invoke('social:notify', n) },
    setBadge: (n) => { vt.invoke('social:unread', n) },
    setInRoom: (v) => { vt.invoke('social:inRoom', v) },
    setKeys: (k) => { vt.invoke('keys:set', k) },
    isActive: () => !document.hidden && document.hasFocus(),
    onHost: (cb) => vt.on((ch, a) => {
      if (ch === 'keys:event') cb({ type: 'key', action: a.action, down: a.down })
      else if (ch === 'social:open') cb({ type: 'open', channel: String(a || '') })
    }),
    openExternal: (u) => { vt.invoke('shell:open', u) }
  }
}
