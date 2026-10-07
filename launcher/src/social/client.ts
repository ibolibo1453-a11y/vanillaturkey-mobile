// SocialClient: one WebSocket + REST + voice per signed-in user. Pure TS + a tiny store; React binds via useSocial().
// Reused by the launcher (Electron adapter) and the mobile PWA (web adapter).
import { DEFAULT_VOICE, type ApiRes, type Attachment, type DmEntry, type FriendEntry, type Message, type Room, type SocialAdapter, type ToastItem, type VoicePrefs } from './types'
import { VoiceEngine, type VoiceSnapshot } from './voice'
import { sfx } from './sounds'
import { setRoleDefs } from './roles'

export type Status = 'off' | 'connecting' | 'online' | 'offline'
export interface ChanData { list: Message[]; hasMore: boolean; loading: boolean; loaded: boolean }
export interface SocialState {
  status: Status; me: string; role: string
  /** R5-B: lower-case name -> VT role (KURUCU / YETKİLİ / SPONSOR / VIP), learned from every payload + live role_upd */
  roles: Record<string, string>
  rooms: Room[]; myRoomId: string; channel: string
  unread: Record<string, number>; dms: DmEntry[]
  friends: FriendEntry[]; incoming: string[]; outgoing: string[]
  typing: Record<string, Record<string, number>>
  windowOpen: boolean; toasts: ToastItem[]
  voice: VoiceSnapshot; prefs: VoicePrefs
  sanction: { kind: string; until?: number } | null
  notice: string; ver: number
}
export type LiveEvent =
  | { t: 'msg'; channel: string; message: Message } | { t: 'rooms' } | { t: 'dms' } | { t: 'friends' } | { t: 'voice' }
  | { t: 'notify'; toast: ToastItem } | { t: 'history'; channel: string; messages: Message[] }
  | { t: 'live'; frame: any }

const IDLE_VOICE: VoiceSnapshot = { status: 'idle', error: '', muted: false, deafened: false, micOk: true, speaking: [], remote: {}, selfSpeaking: false, selfQuality: 'unknown', db: -100 }
const num = (id: string) => Number(id) || 0
const lc = (s: string) => (s || '').toLowerCase()
export const chanPath = (ch: string) => { const i = ch.indexOf(':'); return i < 0 ? ch : ch.slice(0, i + 1) + encodeURIComponent(ch.slice(i + 1)) }

export class SocialClient {
  state: SocialState
  private subs = new Set<() => void>()
  private evs = new Set<(e: LiveEvent) => void>()
  private chans = new Map<string, ChanData>()
  private ws: WebSocket | null = null
  private wsTimer = 0
  private pingTimer = 0
  private backoff = 1000
  private started = false
  private stopped = false
  private voice: VoiceEngine
  private lastTyping = 0
  private toastId = 0
  private recentNotify = new Map<string, number>()
  private readTimer: Record<string, number> = {}
  private offHost?: () => void
  private joined: { id: string; password?: string } | null = null
  private retry = 0
  private noticeTimer = 0
  private typingTimer = 0

  constructor(public a: SocialAdapter) {
    this.state = {
      status: 'off', me: a.me(), role: '', roles: {}, rooms: [], myRoomId: '', channel: 'global', unread: {}, dms: [], friends: [], incoming: [], outgoing: [], typing: {},
      windowOpen: false, toasts: [], voice: IDLE_VOICE, prefs: { ...DEFAULT_VOICE }, sanction: null, notice: '', ver: 0
    }
    this.voice = new VoiceEngine(this.state.prefs, () => this.state.me)
    this.voice.onNotice = (m) => this.toast({ channel: '', title: 'Ses kirliliği engelleme', body: m, kind: 'info' })
    this.voice.onChange = (v) => { this.set({ voice: v }); this.emit({ t: 'voice' }) }
    this.voice.onLost = () => this.rejoinSoon()
  }

  // ---------------------------------------------------------------- store
  subscribe = (fn: () => void) => { this.subs.add(fn); return () => { this.subs.delete(fn) } }
  getState = () => this.state
  on(fn: (e: LiveEvent) => void) { this.evs.add(fn); return () => { this.evs.delete(fn) } }
  private emit(e: LiveEvent) { for (const f of this.evs) { try { f(e) } catch { /* */ } } }
  private set(p: Partial<SocialState>) { this.state = { ...this.state, ...p }; for (const f of this.subs) f() }
  private bump() { this.set({ ver: this.state.ver + 1 }) }
  chan(ch: string): ChanData { return this.chans.get(ch) || { list: [], hasMore: true, loading: false, loaded: false } }
  notice(msg: string) { clearTimeout(this.noticeTimer); this.set({ notice: msg }); if (msg) this.noticeTimer = window.setTimeout(() => this.set({ notice: '' }), 4500) }
  get myRoom() { return this.state.rooms.find((r) => r.id === this.state.myRoomId) || null }
  unreadTotal() { let n = 0; for (const [k, v] of Object.entries(this.state.unread)) if (k !== 'global') n += v; return n + this.state.incoming.length }

  // ---------------------------------------------------------------- lifecycle
  async start() {
    if (this.started) return
    this.started = true; this.stopped = false
    this.hookUnload()
    this.set({ me: this.a.me() })
    try { const p = await this.a.loadPrefs(); this.applyPrefs({ ...DEFAULT_VOICE, ...p }, true) } catch { /* */ }
    this.offHost = this.a.onHost?.((ev) => {
      if (ev.type === 'key') { if (ev.action === 'ptt') this.voice.setPtt(!!ev.down); else if (ev.down !== false) { if (ev.action === 'mute') this.voice.toggleMute(); else this.toggleDeafen() } }
      else if (ev.type === 'open') this.openWindow(ev.channel || undefined)
    })
    if (!this.state.me) { this.set({ status: 'off' }); return }
    this.connect()
    this.refreshAll()
  }
  private unloadHooked = false
  private hookUnload() {
    if (this.unloadHooked || typeof window === 'undefined') return
    this.unloadHooked = true
    window.addEventListener('pagehide', () => this.leaveOnUnload())
    window.addEventListener('beforeunload', () => this.leaveOnUnload())
  }
  async stop() {
    this.started = false; this.stopped = true
    clearTimeout(this.wsTimer); clearInterval(this.pingTimer); this.offHost?.()
    if (this.state.myRoomId) { this.wsSend({ t: 'leave', room: this.state.myRoomId }); this.leaveApi(this.state.myRoomId) }
    try { this.ws?.close() } catch { /* */ }
    this.ws = null
    await this.voice.leave()
    this.a.setInRoom?.(false); this.a.setBadge?.(0)
    this.chans.clear(); this.joined = null
    this.state = { ...this.state, status: 'off', rooms: [], myRoomId: '', unread: {}, dms: [], friends: [], incoming: [], outgoing: [], toasts: [], voice: IDLE_VOICE }
    for (const f of this.subs) f()
  }

  private async connect() {
    if (this.stopped) return
    this.set({ status: 'connecting' })
    const url = await this.a.wsUrl()
    if (!url || this.stopped) { this.set({ status: 'off' }); return }
    let ws: WebSocket
    try { ws = new WebSocket(url) } catch { this.scheduleReconnect(); return }
    this.ws = ws
    ws.onopen = () => { this.backoff = 1000; this.set({ status: 'online' }); clearInterval(this.pingTimer); this.pingTimer = window.setInterval(() => this.wsSend({ t: 'ping' }), 25000) }
    ws.onmessage = (ev) => { try { this.onFrame(JSON.parse(String(ev.data))) } catch { /* */ } }
    ws.onclose = () => { if (this.ws === ws) { this.ws = null; clearInterval(this.pingTimer); if (!this.stopped) { this.set({ status: 'offline' }); this.scheduleReconnect() } } }
    ws.onerror = () => { /* close follows */ }
  }
  private scheduleReconnect() { clearTimeout(this.wsTimer); this.wsTimer = window.setTimeout(() => this.connect(), this.backoff); this.backoff = Math.min(30000, this.backoff * 1.7) }
  private wsSend(o: any) { try { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(o)) } catch { /* */ } }
  /** Page/app is going away (pagehide / beforeunload): tell the server over the open socket; closing it does the rest. */
  leaveOnUnload() { const id = this.state.myRoomId; if (id) { this.wsSend({ t: 'leave', room: id }); try { this.ws?.close(1000, 'unload') } catch { /* */ } } }
  reconnectNow() { this.backoff = 1000; try { this.ws?.close() } catch { /* */ } if (!this.ws) this.connect() }

  async refreshAll() {
    await Promise.all([this.refreshRooms(), this.refreshDms(), this.refreshFriends(), this.refreshRoleDefs()])
    // after a reconnect catch up the open channel
    const ch = this.state.channel; if (this.chans.get(ch)?.loaded) this.fetchLatest(ch)
  }

  // ---------------------------------------------------------------- frames
  private onFrame(f: any) {
    switch (f.t) {
      case 'hello': {
        const me = typeof f.me === 'string' ? f.me : f.me?.name || this.state.me
        this.set({ me, role: (typeof f.me === 'object' ? f.me?.role : f.role) || '', unread: this.normUnread(f.unread) })
        this.learnRoles({ [me]: f.vtRole ?? null })
        if (f.config) { this.emit({ t: 'live', frame: { t: 'config', config: f.config } }) }   // R5-A+ server-driven config
        // membership is tied to the socket: after a reconnect the server may have dropped us from the room
        if (this.joined && String(f.room?.id ?? f.room ?? '') !== this.joined.id) this.rejoinSoon()
        this.refreshAll(); this.pushBadge(); break
      }
      case 'msg': this.onMsg(f.channel, this.normMsg(f.message, f.channel)); break
      case 'msg_del': this.mutate(this.normCh(f.channel), (l) => l.filter((m) => m.id !== String(f.id))); break
      case 'react': this.mutate(this.normCh(f.channel), (l) => l.map((m) => {
        if (m.id !== String(f.id)) return m
        const r = { ...m.reactions }; const cur = (r[f.emoji] || []).filter((n) => n !== f.name)
        if (f.on) cur.push(f.name)
        if (cur.length) r[f.emoji] = cur; else delete r[f.emoji]
        return { ...m, reactions: r }
      })); break
      case 'typing': {
        const ch = this.normCh(f.channel, f.name); if (lc(f.name) === lc(this.state.me)) break
        const t = { ...this.state.typing, [ch]: { ...(this.state.typing[ch] || {}), [f.name]: Date.now() + 4000 } }
        this.set({ typing: t }); clearTimeout(this.typingTimer); this.typingTimer = window.setTimeout(() => this.pruneTyping(), 4200); break
      }
      case 'room_upd': {
        this.upsertRoom(f.room)
        // the server dropped us (kick, ghost cleanup) while we still believe we are in: re-sync (rejoin or, if refused, leave locally)
        const rid = String(f.room?.id ?? ''), j = this.joined
        if (j && j.id === rid && !(f.room?.members || []).some((x: any) => lc(String(x?.name ?? x)) === lc(this.state.me))) this.rejoinSoon()
        break
      }
      case 'room_del': this.set({ rooms: this.state.rooms.filter((r) => r.id !== String(f.id)) }); if (this.state.myRoomId === String(f.id)) this.afterLeft(); this.emit({ t: 'rooms' }); break
      case 'roles_defs': setRoleDefs(f.roles); this.bump(); this.emit({ t: 'live', frame: f }); break
      case 'role_upd': this.learnRoles({ [f.name]: f.vtRole ?? null }); this.emit({ t: 'live', frame: f }); this.emit({ t: 'friends' }); break
      case 'presence': {
        if ('vtRole' in f) this.learnRoles({ [f.name]: f.vtRole })
        const list = this.state.friends.map((x) => (lc(x.name) === lc(f.name) ? { ...x, online: !!f.online, status: f.status || '', vtRole: f.vtRole ?? x.vtRole } : x))
        this.set({ friends: list }); this.emit({ t: 'friends' }); break
      }
      case 'friend_req': this.refreshFriends().then(() => this.toast({ channel: 'friends', title: f.name, body: 'sana arkadaşlık isteği gönderdi', kind: 'friend', from: f.name })); break
      case 'notify': if (f.kind !== 'dm' && f.kind !== 'room' && f.kind !== 'msg') this.toast({ channel: f.channel || '', title: f.title || 'Bildirim', body: f.body || '', kind: 'info' }); break
      case 'sanction': this.set({ sanction: { kind: f.kind, until: f.until } }); this.notice(f.kind === 'ban' ? 'Hesabın yasaklandı.' : 'Susturuldun.'); break
      case 'announce': this.toast({ channel: 'announce', title: 'Duyuru', body: String(f.announcement?.text || ''), kind: 'info' }); this.emit({ t: 'live', frame: f }); break
      case 'announce_del': case 'config': case 'servers_upd': this.emit({ t: 'live', frame: f }); break
      case 'cosmetics_upd': case 'skin_upd': case 'coins_upd': case 'discord_upd':
        if (f.t === 'skin_upd') this.a.invalidateSkin?.(f.name)
        this.emit({ t: 'live', frame: f }); break
    }
  }
  private normUnread(u: any): Record<string, number> { const o: Record<string, number> = {}; if (u && typeof u === 'object') for (const [k, v] of Object.entries(u)) { const n = Number(v) || 0; if (n > 0) o[k] = n }; return o }
  private pruneTyping() {
    const now = Date.now(); let changed = false; const t: SocialState['typing'] = {}
    for (const [ch, m] of Object.entries(this.state.typing)) { const k = Object.fromEntries(Object.entries(m).filter(([, ex]) => ex > now)); if (Object.keys(k).length !== Object.keys(m).length) changed = true; if (Object.keys(k).length) t[ch] = k }
    if (changed) this.set({ typing: t })
    if (Object.keys(t).length) this.typingTimer = window.setTimeout(() => this.pruneTyping(), 1000)
  }
  /** Server may address a DM by my own name; normalize to dm:<other>. */
  private normCh(ch: string, author?: string) {
    if (ch.startsWith('dm:') && lc(ch.slice(3)) === lc(this.state.me) && author) return 'dm:' + author
    return ch
  }
  private normMsg(m: any, channel?: string): Message {
    const att = m.attachment ? { ...m.attachment, url: this.a.mediaUrl(m.attachment.url), thumbUrl: m.attachment.thumbUrl ? this.a.mediaUrl(m.attachment.thumbUrl) : undefined } as Attachment : undefined
    let t = m.createdAt; if (typeof t === 'string') t = Date.parse(t); if (!t) t = Date.now()
    const ch = this.normCh(m.channel || channel || 'global', m.author)
    if (m.authorRole !== undefined && m.author) this.learnRoles({ [m.author]: m.authorRole })
    return { id: String(m.id), channel: ch, author: m.author, text: m.text || '', attachment: att, replyTo: m.replyTo ?? null, reactions: m.reactions || {}, createdAt: t, authorRole: m.authorRole ?? null }
  }
  private mutate(ch: string, fn: (l: Message[]) => Message[]) {
    const d = this.chans.get(ch); if (!d) return
    this.chans.set(ch, { ...d, list: fn(d.list) }); this.bump()
  }
  private insert(ch: string, m: Message) {
    const d = this.chans.get(ch) || { list: [], hasMore: true, loading: false, loaded: false }
    if (d.list.some((x) => x.id === m.id)) return
    // replace our optimistic copy
    let list = d.list.filter((x) => !(x.pending && x.author === m.author && x.text === m.text && !!x.attachment === !!m.attachment))
    list = [...list, m].sort((a, b) => a.createdAt - b.createdAt || num(a.id) - num(b.id))
    this.chans.set(ch, { ...d, list }); this.bump()
  }

  private onMsg(chRaw: string, m: Message) {
    const ch = this.normCh(chRaw, m.author); m.channel = ch
    const mine = lc(m.author) === lc(this.state.me)
    if (ch.startsWith('dm:') && !this.state.dms.some((d) => lc(d.name) === lc(ch.slice(3)))) this.set({ dms: [{ name: ch.slice(3), lastMessage: m.text || 'Ek', unread: 0 }, ...this.state.dms] })
    if (ch.startsWith('dm:')) this.set({ dms: this.state.dms.map((d) => (lc(d.name) === lc(ch.slice(3)) ? { ...d, lastMessage: m.text || (m.attachment?.kind === 'audio' ? 'Sesli mesaj' : 'Fotoğraf') } : d)) })
    this.insert(ch, m)
    this.emit({ t: 'msg', channel: ch, message: m })
    if (mine) return
    if (this.state.prefs.mutedUsers.some((u) => lc(u) === lc(m.author))) return
    const viewing = this.state.windowOpen && this.state.channel === ch && this.a.isActive()
    // a message arriving means the sender stopped typing
    if (this.state.typing[ch]?.[m.author]) { const t = { ...this.state.typing[ch] }; delete t[m.author]; this.set({ typing: { ...this.state.typing, [ch]: t } }) }
    if (viewing) { this.markRead(ch, m.id); return }
    this.set({ unread: { ...this.state.unread, [ch]: (this.state.unread[ch] || 0) + 1 } }); this.pushBadge()
    // toast + quick reply ONLY for direct messages from a friend (global / room / non-friend DMs just land in the views + unread counters)
    if (!ch.startsWith('dm:') || !this.state.friends.some((f) => lc(f.name) === lc(m.author))) return
    this.toast({ channel: ch, title: m.author, body: m.text || (m.attachment?.kind === 'audio' ? 'Sesli mesaj gönderdi' : 'Fotoğraf gönderdi'), kind: 'dm', from: m.author })
  }

  // ---------------------------------------------------------------- toasts / notifications
  toast(t: Omit<ToastItem, 'id' | 'at'>) {
    const key = t.channel + '|' + t.title + '|' + t.body
    const now = Date.now(); if (now - (this.recentNotify.get(key) || 0) < 3000) return
    this.recentNotify.set(key, now)
    const item: ToastItem = { ...t, id: ++this.toastId, at: now }
    this.emit({ t: 'notify', toast: item })
    if (this.a.isActive()) {
      this.set({ toasts: [...this.state.toasts.slice(-3), item] })
      window.setTimeout(() => this.dismissToast(item.id), t.kind === 'dm' ? 9000 : 6500)
    } else this.a.osNotify?.({ title: t.title, body: t.body, channel: t.channel })
    if (this.state.prefs.notifSounds) sfx.notify()
  }
  dismissToast = (id: number) => { if (this.state.toasts.some((t) => t.id === id)) this.set({ toasts: this.state.toasts.filter((t) => t.id !== id) }) }
  private pushBadge() { this.a.setBadge?.(this.unreadTotal()) }

  // ---------------------------------------------------------------- window / channels
  openWindow(channel?: string) {
    this.set({ windowOpen: true }); if (channel && channel !== 'friends') this.setChannel(channel)
    else if (this.chans.get(this.state.channel)?.loaded) this.markRead(this.state.channel)
    else this.setChannel(this.state.channel)
  }
  closeWindow() { this.set({ windowOpen: false }) }
  async setChannel(ch: string) {
    const first = !this.chans.get(ch)?.loaded
    this.set({ channel: ch })
    if (ch.startsWith('dm:') && !this.state.dms.some((d) => lc(d.name) === lc(ch.slice(3)))) this.set({ dms: [{ name: ch.slice(3), unread: 0 }, ...this.state.dms] })
    if (first) await this.loadMore(ch, true)
    const l = this.chan(ch).list; this.markRead(ch, l[l.length - 1]?.id)
  }
  markRead(ch: string, id?: string) {
    if (!this.state.unread[ch] && !this.state.dms.some((d) => 'dm:' + d.name === ch && d.unread)) return
    const u = { ...this.state.unread }; delete u[ch]
    this.set({ unread: u, dms: this.state.dms.map((d) => ('dm:' + d.name === ch ? { ...d, unread: 0 } : d)) }); this.pushBadge()
    clearTimeout(this.readTimer[ch])
    this.readTimer[ch] = window.setTimeout(() => { const l = this.chan(ch).list; const last = id || l[l.length - 1]?.id; if (last) this.a.api('POST', `/v1/chat/${chanPath(ch)}/read`, { id: last }).catch(() => {}) }, 400)
  }
  private parseList(r: ApiRes): { list: any[]; hasMore?: boolean } {
    const d = r.data; if (Array.isArray(d)) return { list: d }
    return { list: d?.messages || d?.items || [], hasMore: d?.hasMore }
  }
  async loadMore(ch: string, initial = false) {
    const d = this.chan(ch); if (d.loading || (!initial && !d.hasMore)) return
    this.chans.set(ch, { ...d, loading: true }); this.bump()
    const before = initial ? '' : d.list[0]?.id
    const r = await this.a.api('GET', `/v1/chat/${chanPath(ch)}/messages?limit=50${before ? '&before=' + encodeURIComponent(before) : ''}`)
    const cur = this.chan(ch)
    if (r.status !== 200 && !Array.isArray(r.data)) { this.chans.set(ch, { ...cur, loading: false, loaded: cur.loaded }); this.bump(); if (r.status === 403 || r.status === 404) this.notice(r.data?.error || 'Bu sohbete erişimin yok.'); return }
    const p = this.parseList(r); const msgs = p.list.map((m) => this.normMsg(m, ch)).filter((m) => m.id)
    const have = new Set(cur.list.map((m) => m.id))
    const list = [...msgs.filter((m) => !have.has(m.id)), ...cur.list].sort((a, b) => a.createdAt - b.createdAt || num(a.id) - num(b.id))
    this.chans.set(ch, { list, hasMore: p.hasMore ?? msgs.length >= 50, loading: false, loaded: true }); this.bump()
    this.emit({ t: 'history', channel: ch, messages: msgs })
  }
  private async fetchLatest(ch: string) {
    const r = await this.a.api('GET', `/v1/chat/${chanPath(ch)}/messages?limit=50`)
    if (r.status !== 200 && !Array.isArray(r.data)) return
    for (const m of this.parseList(r).list.map((x) => this.normMsg(x, ch))) this.insert(ch, m)
  }
  history(ch: string) { return this.loadMore(ch, !this.chans.get(ch)?.loaded).then(() => this.chan(ch).list) }

  // ---------------------------------------------------------------- sending
  async send(ch: string, o: { text?: string; attachment?: Attachment; replyTo?: string }): Promise<boolean> {
    const text = (o.text || '').trim().slice(0, 1000)
    if (!text && !o.attachment) return false
    if (this.state.sanction?.kind === 'mute') { this.notice('Susturulduğun için mesaj gönderemezsin.'); return false }
    const tempId = 't' + Date.now() + Math.random().toString(36).slice(2, 6)
    const temp: Message = { id: tempId, tempId, channel: ch, author: this.state.me, text, attachment: o.attachment, replyTo: o.replyTo ?? null, reactions: {}, createdAt: Date.now(), pending: true }
    this.insert(ch, temp)
    const r = await this.a.api('POST', `/v1/chat/${chanPath(ch)}/messages`, { text: text || undefined, attachmentId: o.attachment?.id, replyTo: o.replyTo })
    const msg = r.data?.message || (r.data?.id ? r.data : null)
    if (r.status === 200 && r.data?.ok !== false) {
      const real = msg ? this.normMsg(msg, ch) : null
      this.mutate(ch, (l) => { const without = l.filter((x) => x.tempId !== tempId); if (real && !without.some((x) => x.id === real.id)) without.push(real); return without.sort((a, b) => a.createdAt - b.createdAt || num(a.id) - num(b.id)) })
      return true
    }
    this.mutate(ch, (l) => l.filter((x) => x.tempId !== tempId))
    this.notice(r.networkError ? 'Sunucuya ulaşılamadı.' : r.status === 429 ? 'Çok hızlı yazıyorsun, biraz bekle.' : r.data?.error || 'Mesaj gönderilemedi.')
    return false
  }
  async uploadAndSend(ch: string, data: ArrayBuffer, name: string, type: string, text = '', replyTo?: string): Promise<boolean> {
    const isImg = type.startsWith('image/')
    if (isImg && data.byteLength > 5 * 1048576) { this.notice('Fotoğraf en fazla 5 MB olabilir.'); return false }
    if (!isImg && data.byteLength > 1048576) { this.notice('Sesli mesaj çok büyük (en fazla 1 MB).'); return false }
    const r = await this.a.upload(data, name, type)
    if (r.status !== 200 || r.data?.ok === false || !r.data?.id) { this.notice(r.networkError ? 'Sunucuya ulaşılamadı.' : r.data?.error || 'Yükleme başarısız.'); return false }
    const d = r.data
    return this.send(ch, { text, replyTo, attachment: { id: d.id, kind: d.kind || (isImg ? 'image' : 'audio'), url: this.a.mediaUrl(d.url), thumbUrl: d.thumbUrl ? this.a.mediaUrl(d.thumbUrl) : undefined, durationMs: d.durationMs } })
  }
  async react(ch: string, id: string, emoji: string) { await this.a.api('POST', `/v1/chat/messages/${id}/react`, { emoji }) }
  async deleteMessage(ch: string, id: string) {
    const r = await this.a.api('DELETE', `/v1/chat/messages/${id}`)
    if (r.status === 200 && r.data?.ok !== false) this.mutate(ch, (l) => l.filter((m) => m.id !== id)); else this.notice(r.data?.error || 'Silinemedi.')
  }
  typing(ch: string) { const n = Date.now(); if (n - this.lastTyping < 2500) return; this.lastTyping = n; this.wsSend({ t: 'typing', channel: ch.startsWith('dm:') ? ch : ch }) }
  typingNames(ch: string) { const m = this.state.typing[ch]; const now = Date.now(); return m ? Object.entries(m).filter(([, e]) => e > now).map(([n]) => n) : [] }

  // ---------------------------------------------------------------- rooms
  async refreshRooms() {
    const r = await this.a.api('GET', '/v1/rooms')
    const list = Array.isArray(r.data) ? r.data : r.data?.rooms
    if (!Array.isArray(list)) return
    this.set({ rooms: list.map((x: any) => this.normRoom(x)) })
    const mine = this.state.rooms.find((x) => x.members.some((m) => lc(m.name) === lc(this.state.me)))
    if (mine && !this.state.myRoomId && !this.joined) this.set({ myRoomId: mine.id }) // already in a room from another device
    this.emit({ t: 'rooms' })
  }
  private normRoom(x: any): Room { for (const m of x.members || []) if (m && typeof m === 'object' && 'vtRole' in m) this.learnRoles({ [m.name]: m.vtRole }); return { id: String(x.id), name: x.name, icon: x.icon || '', access: x.access || 'public', owner: x.owner, members: (x.members || []).map((m: any) => (typeof m === 'string' ? { name: m } : m)), max: x.max || 20, createdAt: x.createdAt } }
  private upsertRoom(raw: any) {
    const r = this.normRoom(raw); const i = this.state.rooms.findIndex((x) => x.id === r.id)
    const rooms = i < 0 ? [...this.state.rooms, r] : this.state.rooms.map((x) => (x.id === r.id ? r : x))
    this.set({ rooms }); this.emit({ t: 'rooms' })
  }
  async createRoom(o: { name: string; access: string; password?: string; icon?: string; max?: number }): Promise<{ ok: boolean; error?: string }> {
    const r = await this.a.api('POST', '/v1/rooms', o)
    if (r.status !== 200 && r.status !== 201) return { ok: false, error: r.networkError ? 'Sunucuya ulaşılamadı.' : r.data?.error || 'Oda oluşturulamadı.' }
    const room = r.data?.room || r.data
    if (room?.id) { this.upsertRoom(room); return this.joinRoom(String(room.id), o.password) }
    return { ok: true }
  }
  async joinRoom(id: string, password?: string): Promise<{ ok: boolean; error?: string }> {
    if (this.state.myRoomId && this.state.myRoomId !== id) await this.leaveRoom(true)
    const r = await this.a.api('POST', `/v1/rooms/${id}/join`, { password })
    if (r.status !== 200 || r.data?.ok === false) return { ok: false, error: r.networkError ? 'Sunucuya ulaşılamadı.' : r.data?.error || 'Odaya katılınamadı.' }
    this.joined = { id, password }; this.retry = 0
    this.set({ myRoomId: id }); this.a.setInRoom?.(true)
    if (this.state.prefs.joinSounds) sfx.join()
    this.setChannel('room:' + id)
    this.setKeysFromPrefs()
    try { await this.voice.join(r.data.livekitUrl, r.data.livekitToken) } catch { /* error is in voice state */ }
    return { ok: true }
  }
  private rejoinTimer = 0
  private rejoinSoon() {
    clearTimeout(this.rejoinTimer)
    const j = this.joined; if (!j) return
    this.rejoinTimer = window.setTimeout(async () => {
      if (!this.joined) return
      const r = await this.a.api('POST', `/v1/rooms/${j.id}/join`, { password: j.password })
      if (r.status === 200 && r.data?.livekitToken) { try { await this.voice.join(r.data.livekitUrl, r.data.livekitToken); this.retry = 0; return } catch { /* retry */ } }
      if (r.status === 403 || r.status === 404) { this.afterLeft(); return }
      this.retry++; this.rejoinSoon()
    }, Math.min(15000, 1500 * Math.pow(1.6, this.retry)))
  }
  async leaveRoom(silent = false) {
    const id = this.state.myRoomId; if (!id) return
    this.joined = null; clearTimeout(this.rejoinTimer)
    this.wsSend({ t: 'leave', room: id })
    this.leaveApi(id)
    await this.voice.leave()
    this.afterLeft(silent)
    if (!silent && this.state.prefs.joinSounds) sfx.leave()
  }
  /** REST leave with retries: a lost leave leaves a ghost in the room for everybody else. */
  private leaveApi(id: string, n = 0) {
    this.a.api('POST', `/v1/rooms/${id}/leave`).then((r) => {
      if ((r.networkError || r.status >= 500) && n < 4 && !this.joined) window.setTimeout(() => this.leaveApi(id, n + 1), 1500 * (n + 1))
    }).catch(() => { if (n < 4 && !this.joined) window.setTimeout(() => this.leaveApi(id, n + 1), 1500 * (n + 1)) })
  }
  private afterLeft(silent = false) {
    const was = this.state.myRoomId
    this.joined = null; this.set({ myRoomId: '', voice: IDLE_VOICE }); this.a.setInRoom?.(false)
    if (this.state.channel === 'room:' + was && !silent) this.setChannel('global')
    this.emit({ t: 'voice' })
  }
  async kick(id: string, name: string) { await this.a.api('POST', `/v1/rooms/${id}/kick`, { name }) }
  async deleteRoom(id: string) { const r = await this.a.api('DELETE', `/v1/rooms/${id}`); if (r.status !== 200) this.notice(r.data?.error || 'Oda silinemedi.') }
  /** R5-B: remember roles (null clears). Cheap no-op when nothing changed. */
  private learnRoles(m: Record<string, string | null | undefined>) {
    let next: Record<string, string> | null = null
    for (const [n, r] of Object.entries(m)) {
      if (!n) continue
      const k = lc(n), cur = (next || this.state.roles)[k]
      if ((r || undefined) === cur) continue
      next ??= { ...this.state.roles }
      if (r) next[k] = r; else delete next[k]
    }
    if (next) this.set({ roles: next })
  }
  async refreshRoleDefs() { const r = await this.a.api('GET', '/v1/roles/defs'); if (r.data?.ok) { setRoleDefs(r.data.roles); this.bump() } }
  roleOf(name: string): string | undefined { return this.state.roles[lc(name)] }
  isAdmin() { return this.state.role === 'admin' || this.state.role === 'mod' }

  // ---------------------------------------------------------------- DMs / friends
  async refreshDms() {
    const r = await this.a.api('GET', '/v1/chat/dms'); const list = Array.isArray(r.data) ? r.data : r.data?.dms
    if (!Array.isArray(list)) return
    const dms: DmEntry[] = list.map((d: any) => ({ name: d.name, lastMessage: d.lastMessage?.text ?? d.lastMessage, unread: d.unread || 0 }))
    const unread = { ...this.state.unread }; for (const d of dms) if (d.unread) unread['dm:' + d.name] = d.unread
    this.set({ dms, unread }); this.pushBadge(); this.emit({ t: 'dms' })
  }
  openDm(name: string) { this.openWindow('dm:' + name) }
  async refreshFriends() {
    const r = await this.a.api('GET', '/v1/friends')
    if (!r.data?.ok) return
    const d = r.data
    const rl: Record<string, string | null> = {}
    for (const f of [...(d.friends || []), ...(d.incoming || []), ...(d.outgoing || [])]) rl[f.name] = f.vtRole ?? null
    this.learnRoles(rl)
    this.set({ friends: (d.friends || []).map((f: any) => ({ name: f.name, online: !!f.online, status: f.status, vtRole: f.vtRole ?? null })), incoming: (d.incoming || []).map((x: any) => x.name), outgoing: (d.outgoing || []).map((x: any) => x.name) })
    this.pushBadge(); this.emit({ t: 'friends' })
  }
  async friendAct(act: 'request' | 'accept' | 'decline' | 'remove', name: string): Promise<{ ok: boolean; error?: string }> {
    const r = await this.a.api('POST', '/v1/friends/' + act, { name })
    const ok = !!r.data?.ok
    if (ok) this.refreshFriends()
    return { ok, error: ok ? undefined : r.networkError ? 'Sunucuya ulaşılamadı.' : r.data?.error || 'İşlem başarısız.' }
  }
  isFriend(name: string) { return this.state.friends.some((f) => lc(f.name) === lc(name)) }

  // ---------------------------------------------------------------- voice + prefs
  voiceMute = (on: boolean) => this.voice.setMuted(on)
  voiceDeafen = (on: boolean) => this.voice.setDeafened(on)
  toggleMute = () => this.voice.toggleMute()
  toggleDeafen = () => this.voice.toggleDeafen()
  setPtt = (d: boolean) => this.voice.setPtt(d)
  voiceVolume(name: string) { return this.voice.userVolume(name) }
  setUserVolume(name: string, v: number) { this.setPrefs({ userVolumes: { ...this.state.prefs.userVolumes, [name]: v } }) }
  toggleLocalMute(name: string) {
    const m = this.state.prefs.mutedUsers; this.setPrefs({ mutedUsers: m.includes(name) ? m.filter((x) => x !== name) : [...m, name] })
  }
  setPrefs(p: Partial<VoicePrefs>, fromHost = false) { this.applyPrefs({ ...this.state.prefs, ...p }, false, fromHost) }
  private applyPrefs(next: VoicePrefs, init = false, fromHost = false) {
    const prev = this.state.prefs
    this.set({ prefs: next }); this.voice.setPrefs(next, init ? undefined : prev)
    if (!init && !fromHost) this.a.savePrefs(next)
    if (init || prev.keyPtt !== next.keyPtt || prev.keyMute !== next.keyMute || prev.keyDeafen !== next.keyDeafen) this.setKeysFromPrefs(next)
    this.emit({ t: 'voice' })
  }
  private setKeysFromPrefs(p = this.state.prefs) { this.a.setKeys?.({ ptt: p.mode === 'ptt' ? p.keyPtt : '', mute: p.keyMute, deafen: p.keyDeafen }) }
  /** remote (game) changed voice settings */
  prefsFromHost(p: Partial<VoicePrefs>) { this.setPrefs(p, true) }
}
