// Launcher <-> game bridge, renderer side (plans/BRIDGE.md). The main process owns the socket; this module is the brain:
// it answers game requests from the SocialClient and pushes live state/events to the running game.
import type { SocialClient } from './social'
import { MicPipeline } from './social/voice'

export interface BridgeHooks {
  /** apply settings that came from the game to the launcher store (no echo back) */
  applyRemote: (patch: Record<string, any>) => void
  getSettings: () => Record<string, any>
}

const lc = (s: string) => (s || '').toLowerCase()

export function attachBridge(c: SocialClient, hooks: BridgeHooks): () => void {
  const vt = window.vt
  const out = (msg: any, id: number | null = null) => { vt.invoke('bridge:send', id, msg) }
  vt.invoke('social:ready', true)

  const stateMsg = () => {
    const s = c.state; const room = c.myRoom
    const unread = Object.entries(s.unread).reduce((n, [k, v]) => n + (k === 'global' ? 0 : v), 0) + s.incoming.length
    return {
      t: 'state', me: s.me, status: s.status, voice: s.voice.status, room: room ? { id: room.id, name: room.name, icon: room.icon || '', access: room.access, owner: room.owner } : null,
      members: room ? room.members.map((m) => {
        const self = lc(m.name) === lc(s.me); const rv = s.voice.remote[m.name]
        return { name: m.name, speaking: self ? s.voice.selfSpeaking : s.voice.speaking.includes(m.name), muted: self ? s.voice.muted : !!rv?.muted, deafened: self ? s.voice.deafened : !!rv?.deafened }
      }) : [],
      selfMuted: s.voice.muted, selfDeafened: s.voice.deafened, unread, channel: s.channel
    }
  }
  let timer = 0
  const pushState = () => { if (timer) return; timer = window.setTimeout(() => { timer = 0; out(stateMsg()) }, 90) }
  const roomsMsg = () => ({ t: 'rooms', rooms: c.state.rooms })
  const dmsMsg = () => ({ t: 'dms', dms: c.state.dms })
  const friendsMsg = () => ({ t: 'friends', friends: c.state.friends, incoming: c.state.incoming.map((name) => ({ name })), outgoing: c.state.outgoing.map((name) => ({ name })) })
  let devices = { inputs: [] as { id: string; label: string }[], outputs: [] as { id: string; label: string }[] }
  const loadDevices = async () => {
    try {
      const l = await navigator.mediaDevices.enumerateDevices()
      const f = (k: string) => l.filter((d) => d.kind === k && d.deviceId !== 'default' && d.deviceId !== 'communications').map((d, i) => ({ id: d.deviceId, label: d.label || (k === 'audioinput' ? 'Mikrofon ' : 'Hoparlör ') + (i + 1) }))
      devices = { inputs: f('audioinput'), outputs: f('audiooutput') }
    } catch { /* */ }
  }
  const voiceFrame = () => ({ t: 'settings', section: 'voice', data: { ...c.state.prefs, devices } })
  loadDevices().then(() => out(voiceFrame()))
  const onDev = () => loadDevices().then(() => out(voiceFrame()))
  navigator.mediaDevices?.addEventListener?.('devicechange', onDev)
  let mic: MicPipeline | null = null
  const stopMic = () => { mic?.stop(); mic = null }
  const mediaCache = new Map<string, string>()
  const toPng = async (url: string): Promise<string | null> => {
    const hit = mediaCache.get(url); if (hit) return hit
    const data: string | null = await vt.invoke('social:media', url); if (!data) return null
    const bmp = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('decode')); im.src = data }) // (CSP allows data: images, not fetch)
    const k = Math.min(1, 1024 / Math.max(bmp.naturalWidth, bmp.naturalHeight))
    const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(bmp.naturalWidth * k)); cv.height = Math.max(1, Math.round(bmp.naturalHeight * k))
    cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height)
    const b64 = cv.toDataURL('image/png').split(',')[1]
    mediaCache.set(url, b64); if (mediaCache.size > 40) mediaCache.delete(mediaCache.keys().next().value!)
    return b64
  }
  const settingsMsgs = () => {
    const st = hooks.getSettings()
    return [
      voiceFrame(),
      { t: 'settings', section: 'modules', data: st.modules || {} },
      { t: 'settings', section: 'hud', data: st.hud || {} },
      { t: 'settings', section: 'client', data: st.clientCfg || {} },
      { t: 'settings', section: 'cosmetics', data: st.equipped || {} }
    ]
  }
  const snapshot = (id: number | null) => { out(stateMsg(), id); out(roomsMsg(), id); out(dmsMsg(), id); out(friendsMsg(), id); for (const m of settingsMsgs()) out(m, id) }

  const offEv = c.on((e) => {
    switch (e.t) {
      case 'voice': pushState(); break
      case 'rooms': out(roomsMsg()); pushState(); break
      case 'dms': out(dmsMsg()); break
      case 'friends': out(friendsMsg()); break
      case 'msg': out({ t: 'msg', channel: e.channel, message: e.message }); pushState(); break
      case 'notify': out({ t: 'notify', kind: e.toast.kind, channel: e.toast.channel, title: e.toast.title, body: e.toast.body, from: e.toast.from || '' }); break
      case 'live': out(e.frame); break
    }
  })
  const offSub = c.subscribe(() => pushState())

  const reply = async (id: number, m: any) => {
    switch (m.t) {
      case 'state_get': out(stateMsg(), id); break
      case 'rooms_get': c.refreshRooms().then(() => out(roomsMsg(), id)); break
      case 'dms_get': c.refreshDms().then(() => out(dmsMsg(), id)); break
      case 'friends_get': c.refreshFriends().then(() => out(friendsMsg(), id)); break
      case 'send': {
        const ok = await c.send(String(m.channel || 'global'), { text: m.text, replyTo: m.replyTo })
        out({ t: 'send_result', channel: m.channel, ok, error: ok ? '' : c.state.notice }, id); break
      }
      case 'history': {
        const ch = String(m.channel || 'global')
        let list = await c.history(ch)
        if (m.before) { await c.loadMore(ch); list = c.chan(ch).list.filter((x) => Number(x.id) < Number(m.before)) }
        c.markRead(ch)
        out({ t: 'history', channel: ch, messages: list.slice(-50), hasMore: c.chan(ch).hasMore }, id); break
      }
      case 'join': { const r = await c.joinRoom(String(m.roomId), m.password); out({ t: 'join_result', roomId: m.roomId, ...r }, id); break }
      case 'leave': await c.leaveRoom(); break
      case 'mute': c.voiceMute(!!m.on); break
      case 'deafen': c.voiceDeafen(!!m.on); break
      case 'volume': c.setUserVolume(String(m.name), Math.max(0, Math.min(100, Number(m.value))))
        break
      case 'create_room': { const r = await c.createRoom({ name: m.name, access: m.access || 'public', password: m.password, icon: m.icon, max: m.max }); out({ t: 'create_result', ...r }, id); break }
      case 'friend_request': { const r = await c.friendAct(m.act || 'request', String(m.name)); out({ t: 'friend_result', name: m.name, act: m.act || 'request', ...r }, id); break }
      case 'upload_screenshot': {
        const ch = String(m.channel || c.state.channel || 'global')
        const r = await vt.invoke('social:uploadPath', String(m.path))
        if (r?.status === 200 && r.data?.id) {
          const d = r.data; const ok = await c.send(ch, { text: m.text || '', attachment: { id: d.id, kind: d.kind || 'image', url: c.a.mediaUrl(d.url), thumbUrl: d.thumbUrl ? c.a.mediaUrl(d.thumbUrl) : undefined } })
          out({ t: 'upload_result', ok, channel: ch }, id)
        } else out({ t: 'upload_result', ok: false, error: r?.data?.error || 'Yüklenemedi', channel: ch }, id)
        break
      }
      case 'settings_get': { for (const x of settingsMsgs()) if (!m.section || m.section === x.section) out(x, id); break }
      case 'settings_set': {
        const sec = String(m.section || ''); const data = m.data
        if (sec === 'voice' && data && typeof data === 'object') { const { devices: _d, ...pv } = data; c.prefsFromHost(pv); vt.invoke('settings:set', { voice: c.state.prefs }, { src: 'game' }) }
        else if (sec === 'modules' && data) {
          // accept {id: bool} or {id: {enabled: bool, ...}}
          const flat: Record<string, boolean> = { ...(hooks.getSettings().modules || {}) }
          for (const [k, v] of Object.entries<any>(data)) flat[k] = typeof v === 'boolean' ? v : !!v?.enabled
          hooks.applyRemote({ modules: flat }); vt.invoke('settings:set', { modules: flat }, { src: 'game' })
        } else if (sec === 'hud' || sec === 'client') {
          const key = sec === 'hud' ? 'hud' : 'clientCfg'; const merged = { ...(hooks.getSettings()[key] || {}), ...(data || {}) }
          hooks.applyRemote({ [key]: merged }); vt.invoke('settings:set', { [key]: merged }, { src: 'game' })
        }
        break
      }
      case 'cosmetics_set': {
        const eq = m.equipped || {}
        const r = await c.a.api('PUT', '/v1/cosmetics', eq)
        hooks.applyRemote({ equipped: eq }); vt.invoke('settings:set', { equipped: eq }, { src: 'game' })
        window.dispatchEvent(new CustomEvent('vt-cosmetics-remote', { detail: eq }))
        out({ t: 'cosmetics_result', ok: r.status === 200 }, id); break
      }
      case 'ptt': c.setPtt(!!m.down); break
      case 'mic_test': {
        stopMic()
        if (m.on) {
          const p = new MicPipeline(c.state.prefs); p.forcedOpen = true; let last = 0
          p.onTick = (db) => { const n = performance.now(); if (n - last < 66) return; last = n; out({ t: 'mic_level', value: Math.max(0, Math.min(1, (db + 70) / 70)) }, id) }
          mic = p; p.start().catch(() => { mic = null; out({ t: 'mic_level', value: 0, error: true }, id) })
        }
        break
      }
      case 'media': {
        const png = await toPng(String(m.url)).catch(() => null)
        out({ t: 'media', url: m.url, png, ok: !!png }, id); break
      }
      case 'open_window': c.openWindow(m.channel); vt.invoke('social:focus'); break
    }
  }
  const offBridge = vt.on((ch, a, b) => {
    if (ch === 'bridge:open') snapshot(a)
    else if (ch === 'bridge:msg') reply(a, b).catch(() => {})
    else if (ch === 'bridge:close') stopMic()
  })
  return () => { offEv(); offSub(); offBridge(); clearTimeout(timer); stopMic(); navigator.mediaDevices?.removeEventListener?.('devicechange', onDev); vt.invoke('social:ready', false) }
}
