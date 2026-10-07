// Voice: LiveKit room + a WebAudio microphone pipeline (input volume, voice activity / push-to-talk gate, level meter).
// Self-contained (no Electron): reused by the PWA.
import { Room, RoomEvent, Track, LocalAudioTrack, ConnectionQuality, DisconnectReason, type RemoteTrack, type RemoteParticipant, type Participant } from 'livekit-client'
import type { VoicePrefs, VoiceStatus, NoisePreset } from './types'
import { createDenoise, takeBrokenNotice, markDenoiseBroken, denoiseHasVad } from './denoise'
import { sfx } from './sounds'

export const dbFromThreshold = (t: number) => -70 + (t / 100) * 60 // 0..100 -> -70..-10 dBFS
export const thresholdFromDb = (db: number) => Math.max(0, Math.min(100, Math.round(((db + 70) / 60) * 100)))

/** Input devices that carry the computer's own audio ("Bu cihaz bilgisayar sesini de gönderir"). */
export const isLoopbackLabel = (label: string) => /stereo\s*mix|stereo\s*kar[ıi]ş[ıi]m[ıi]|what\s*u\s*hear|cable\s*output|wave\s*out|loopback|vb-audio/i.test(label || '')

/** Per preset: voice-likeness needed to open the gate, hold / release. */
const PRESETS: Record<NoisePreset, { voiceMin: number; holdMs: number; release: number }> = {
  off: { voiceMin: 0, holdMs: 380, release: 0.012 },
  low: { voiceMin: 0.45, holdMs: 340, release: 0.04 },
  medium: { voiceMin: 0.55, holdMs: 300, release: 0.05 },
  high: { voiceMin: 0.65, holdMs: 260, release: 0.06 }
}
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

export interface MicInfo { db: number; voice: number; vad: number; hot: boolean; open: boolean; denoise: boolean }

/** Mic -> gain -> (RNNoise) -> voice-aware noise gate (delay for look-ahead) -> MediaStreamDestination.
 *  Also used on its own for the settings "mikrofon testi" and the "Otomatik" threshold calibration. */
export class MicPipeline {
  ctx: AudioContext | null = null
  stream: MediaStream | null = null
  out: MediaStreamTrack | null = null
  private gain!: GainNode
  private gate!: GainNode
  private an!: AnalyserNode
  private anPre!: AnalyserNode
  private denoise: AudioWorkletNode | null = null
  private delay: DelayNode | null = null
  private startedAt = 0
  private buf = new Float32Array(1024)
  private bufPre = new Float32Array(1024)
  private spec = new Float32Array(1024)
  private hist: number[] = []
  private vadHist: number[] = []
  private timer = 0
  private holdUntil = 0
  db = -100
  voice = 0 // smoothed voice-likeness 0..1 (RNNoise retention + 300-3400 Hz energy ratio + syllabic modulation)
  gateOpen = false
  voiceOpen = false
  hasDenoise = false
  vad = -1 // RNNoise voice probability (0..1), -1 = not available
  private vadAt = 0
  onTick?: (db: number, speaking: boolean, info: MicInfo) => void
  onFallback?: (msg: string) => void
  forcedOpen = false // meter test: the signal always passes, the indicator still follows the detector
  muted = false
  pttDown = false

  constructor(public prefs: VoicePrefs) {}

  async start(): Promise<void> {
    await this.stop()
    const p = this.prefs
    const on = p.noisePreset !== 'off'
    const cons = { echoCancellation: on || p.echoCancellation, noiseSuppression: on || p.noiseSuppression, autoGainControl: on || p.autoGain }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: p.inputDevice ? { exact: p.inputDevice } : undefined, ...cons, channelCount: 1 }
    }).catch(async (e) => {
      if (p.inputDevice) return navigator.mediaDevices.getUserMedia({ audio: cons }) // device unplugged: fall back to default
      throw e
    })
    this.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 })
    const ctx = this.ctx
    const src = ctx.createMediaStreamSource(this.stream)
    this.gain = ctx.createGain(); this.gain.gain.value = p.inputVolume / 100
    this.gate = ctx.createGain(); this.gate.gain.value = 0
    this.an = ctx.createAnalyser(); this.an.fftSize = 2048; this.an.smoothingTimeConstant = 0.2
    this.anPre = ctx.createAnalyser(); this.anPre.fftSize = 1024
    const dest = ctx.createMediaStreamDestination()
    const delay = this.delay = ctx.createDelay(0.1); delay.delayTime.value = on ? 0.04 : 0 // look-ahead: the gate opens before the first syllable arrives
    src.connect(this.gain); this.gain.connect(this.anPre)
    let tail: AudioNode = this.gain
    this.hasDenoise = false; this.denoise = null
    if (on) {
      try {
        this.denoise = await createDenoise(ctx); this.hasDenoise = true; this.vad = -1
        this.denoise.port.onmessage = (e) => { const v = e.data?.vad; if (typeof v === 'number' && v >= 0) { this.vad = v; this.vadAt = performance.now() } }
        this.gain.connect(this.denoise); tail = this.denoise
      } catch (e: any) {
        this.denoise = null; this.hasDenoise = false
        if (takeBrokenNotice()) this.onFallback?.('Ses kirliliği engelleme başlatılamadı (' + (e?.message || e) + '), yalnızca kapı filtresi kullanılıyor.')
      }
    }
    // The RNNoise worklet emits a 2-channel buffer with only the left channel filled, so listeners heard us in
    // the left ear only. Take channel 0 into an explicit mono node and publish a mono track: Opus mono plays
    // centred (both ears) on every receiver.
    const split = ctx.createChannelSplitter(2)
    const mono = ctx.createGain(); mono.channelCount = 1; mono.channelCountMode = 'explicit'; mono.channelInterpretation = 'speakers'
    dest.channelCount = 1; dest.channelCountMode = 'explicit'
    tail.connect(this.an); tail.connect(delay); delay.connect(split); split.connect(mono, 0); mono.connect(this.gate); this.gate.connect(dest)
    this.out = dest.stream.getAudioTracks()[0]
    this.hist = []; this.voice = 0; this.startedAt = performance.now()
    this.timer = window.setInterval(() => this.tick(), 25)
  }
  setPrefs(p: VoicePrefs) { this.prefs = p; if (this.gain) this.gain.gain.value = p.inputVolume / 100 }

  private rms(a: AnalyserNode, buf: Float32Array<ArrayBuffer>) {
    a.getFloatTimeDomainData(buf)
    let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]
    const r = Math.sqrt(s / buf.length); return r > 0 ? 20 * Math.log10(r) : -100
  }
  /** voice-likeness of the last frame, 0..1 */
  private score(db: number, dbPre: number): number {
    if (db < -75) { this.hist = []; this.vadHist = []; return 0 }
    this.an.getFloatFrequencyData(this.spec as Float32Array<ArrayBuffer>)
    const binHz = (this.ctx!.sampleRate / 2) / this.spec.length
    let band = 0, total = 0
    for (let i = Math.floor(80 / binHz); i < Math.min(this.spec.length, Math.floor(8000 / binHz)); i++) {
      const e = Math.pow(10, this.spec[i] / 10); total += e
      const f = i * binHz; if (f >= 300 && f <= 3400) band += e
    }
    const bandScore = total > 0 ? clamp01(((band / total) - 0.45) / 0.4) : 0
    this.hist.push(db); if (this.hist.length > 28) this.hist.shift()
    let mean = 0; for (const v of this.hist) mean += v; mean /= this.hist.length
    let vr = 0; for (const v of this.hist) vr += (v - mean) * (v - mean)
    const modScore = this.hist.length < 8 ? 0.5 : clamp01((Math.sqrt(vr / this.hist.length) - 1.5) / 5)
    if (this.hasDenoise && this.vad >= 0 && performance.now() - this.vadAt < 400) {
      // RNNoise's voice probability, judged over ~300 ms: speech keeps it near 1 on most frames, music / video only flickers there
      this.vadHist.push(this.vad); if (this.vadHist.length > 12) this.vadHist.shift()
      let m = 0, strong = 0; for (const v of this.vadHist) { m += v; if (v > 0.9) strong++ }
      return 0.2 * (m / this.vadHist.length) + 0.8 * clamp01(strong / this.vadHist.length / 0.8)
    }
    if (this.hasDenoise) {
      const ret = dbPre < -70 ? 0 : Math.pow(10, Math.min(0, db - dbPre) / 20) // RNNoise passes speech, attenuates music / noise
      return 0.4 * clamp01((ret - 0.15) / 0.6) + 0.3 * bandScore + 0.3 * modScore
    }
    return 0.5 * bandScore + 0.5 * modScore
  }

  /** The worklet loaded but its wasm never produced audio (silent output): route around it and tell the user once. */
  private bypassDenoise(why: string) {
    if (!this.denoise || !this.delay) return
    try { this.gain.disconnect(this.denoise); this.denoise.disconnect(); this.denoise.port.postMessage('destroy') } catch { /* */ }
    this.gain.connect(this.an); this.gain.connect(this.delay)
    this.denoise = null; this.hasDenoise = false; this.vad = -1
    markDenoiseBroken(why)
    if (takeBrokenNotice()) this.onFallback?.('Ses kirliliği engelleme başlatılamadı (' + why + '), yalnızca kapı filtresi kullanılıyor.')
  }

  private tick() {
    if (!this.ctx) return
    const pr = PRESETS[this.prefs.noisePreset] || PRESETS.medium
    const db = this.rms(this.an, this.buf as Float32Array<ArrayBuffer>); const dbPre = this.rms(this.anPre, this.bufPre as Float32Array<ArrayBuffer>)
    this.db = db
    if (this.hasDenoise && denoiseHasVad() && this.vad < 0 && performance.now() - this.startedAt > 2500 && dbPre > -55 && db < -90) this.bypassDenoise('worklet çıkış vermedi')
    const sc = pr.voiceMin > 0 ? this.score(db, dbPre) : 1
    this.voice += (sc - this.voice) * (sc > this.voice ? 0.3 : 0.18)
    const now = performance.now()
    const hot = db > dbFromThreshold(this.prefs.vadThreshold)
    if (hot && this.voice >= pr.voiceMin) this.holdUntil = now + pr.holdMs
    this.voiceOpen = now < this.holdUntil
    let open = false
    if (this.forcedOpen) open = true
    else if (!this.muted) open = this.prefs.mode === 'ptt' ? this.pttDown : this.voiceOpen
    if (open !== this.gateOpen) {
      this.gateOpen = open
      this.gate.gain.setTargetAtTime(open ? 1 : 0, this.ctx.currentTime, open ? 0.004 : pr.release) // attack ~10 ms, release by preset
    }
    const speaking = this.prefs.mode === 'ptt' ? this.gateOpen && db > -62 : this.voiceOpen && !this.muted && db > -62
    this.onTick?.(db, speaking, { db, voice: this.voice, vad: this.vad, hot, open: this.voiceOpen, denoise: this.hasDenoise })
  }
  async stop() {
    clearInterval(this.timer); this.timer = 0
    try { this.denoise?.port.postMessage('destroy') } catch { /* */ }
    try { this.stream?.getTracks().forEach((t) => t.stop()) } catch { /* */ }
    try { await this.ctx?.close() } catch { /* */ }
    this.stream = null; this.ctx = null; this.out = null; this.gateOpen = false; this.voiceOpen = false; this.denoise = null
  }
}

export interface VoiceSnapshot {
  status: VoiceStatus; error: string; muted: boolean; deafened: boolean; micOk: boolean
  speaking: string[]; remote: Record<string, { muted: boolean; deafened: boolean; quality: string }>; selfSpeaking: boolean; selfQuality: string; db: number
}

export class VoiceEngine {
  private room: Room | null = null
  private mic: MicPipeline | null = null
  private snap: VoiceSnapshot = { status: 'idle', error: '', muted: false, deafened: false, micOk: true, speaking: [], remote: {}, selfSpeaking: false, selfQuality: 'unknown', db: -100 }
  private tracks = new Map<string, RemoteTrack[]>()
  private els = new Set<HTMLMediaElement>()
  private mutedBeforeDeafen = false
  private pttDown = false
  private serial = 0
  onChange?: (s: VoiceSnapshot) => void
  onLost?: () => void
  onPeer?: (name: string, joined: boolean) => void
  onNotice?: (msg: string) => void

  constructor(public prefs: VoicePrefs, private me: () => string) {}
  get state() { return this.snap }
  private set(p: Partial<VoiceSnapshot>) { this.snap = { ...this.snap, ...p }; this.onChange?.(this.snap) }

  async join(url: string, token: string) {
    const my = ++this.serial
    await this.leave(true)
    this.set({ status: 'connecting', error: '', remote: {}, speaking: [] })
    const room = new Room({ adaptiveStream: false, dynacast: false, audioOutput: this.prefs.outputDevice ? { deviceId: this.prefs.outputDevice } : undefined })
    this.room = room
    this.wire(room, my)
    try {
      await room.connect(url, token, { autoSubscribe: true })
    } catch (e: any) {
      if (my !== this.serial) return
      this.room = null; this.set({ status: 'error', error: 'Ses sunucusuna bağlanılamadı: ' + (e?.message || e) }); throw e
    }
    if (my !== this.serial) { room.disconnect(); return }
    // microphone (listen-only if it fails)
    this.mic = new MicPipeline(this.prefs); this.mic.onFallback = (m) => this.onNotice?.(m)
    this.mic.muted = this.snap.muted || this.snap.deafened; this.mic.pttDown = this.pttDown
    this.mic.onTick = (db, speaking) => { const sp = speaking && !this.mic!.muted; if (sp !== this.snap.selfSpeaking || Math.abs(db - this.snap.db) > 3) this.set({ selfSpeaking: sp, db }) }
    try {
      await this.mic.start()
      const track = new LocalAudioTrack(this.mic.out!, undefined, true)
      await room.localParticipant.publishTrack(track, { name: 'mic', source: Track.Source.Microphone, dtx: true, red: true })
      this.set({ micOk: true })
    } catch (e: any) {
      this.set({ micOk: false, error: 'Mikrofon açılamadı (' + (e?.name || e) + '). Dinleme modundasın.' }); try { await this.mic?.stop() } catch { /* */ } this.mic = null
    }
    this.set({ status: 'connected' })
    this.sendDeaf()
  }

  private wire(room: Room, my: number) {
    const name = (p: Participant) => p.identity
    room.on(RoomEvent.ActiveSpeakersChanged, (sp) => this.set({ speaking: sp.map(name).filter((n) => n !== this.me()) }))
    room.on(RoomEvent.ConnectionQualityChanged, (q: ConnectionQuality, p: Participant) => {
      const qs = q === ConnectionQuality.Excellent ? 'excellent' : q === ConnectionQuality.Good ? 'good' : q === ConnectionQuality.Poor ? 'poor' : q === ConnectionQuality.Lost ? 'lost' : 'unknown'
      if (p.isLocal) this.set({ selfQuality: qs }); else this.patchRemote(name(p), { quality: qs })
    })
    room.on(RoomEvent.TrackSubscribed, (t: RemoteTrack, _pub, p: RemoteParticipant) => {
      if (t.kind !== Track.Kind.Audio) return
      const el = t.attach() as HTMLMediaElement; el.style.display = 'none'; document.body.appendChild(el); this.els.add(el)
      const l = this.tracks.get(name(p)) || []; l.push(t); this.tracks.set(name(p), l)
      this.applyVolume(name(p))
    })
    room.on(RoomEvent.TrackUnsubscribed, (t: RemoteTrack, _pub, p: RemoteParticipant) => {
      for (const el of t.detach()) { el.remove(); this.els.delete(el as HTMLMediaElement) }
      this.tracks.set(name(p), (this.tracks.get(name(p)) || []).filter((x) => x !== t))
    })
    room.on(RoomEvent.TrackMuted, (_pub, p: Participant) => { if (!p.isLocal) this.patchRemote(name(p), { muted: true }) })
    room.on(RoomEvent.TrackUnmuted, (_pub, p: Participant) => { if (!p.isLocal) this.patchRemote(name(p), { muted: false }) })
    room.on(RoomEvent.ParticipantConnected, (p) => { this.patchRemote(name(p), {}); if (this.prefs.joinSounds) sfx.join(); this.sendDeaf(); this.onPeer?.(name(p), true) })
    room.on(RoomEvent.ParticipantDisconnected, (p) => {
      const r = { ...this.snap.remote }; delete r[name(p)]; this.tracks.delete(name(p)); this.set({ remote: r })
      if (this.prefs.joinSounds) sfx.leave(); this.onPeer?.(name(p), false)
    })
    room.on(RoomEvent.DataReceived, (data: Uint8Array, p?: RemoteParticipant) => {
      if (!p) return
      try { const m = JSON.parse(new TextDecoder().decode(data)); if (m.t === 'deaf') this.patchRemote(name(p), { deafened: !!m.on }) } catch { /* */ }
    })
    room.on(RoomEvent.Reconnecting, () => { if (my === this.serial) this.set({ status: 'reconnecting' }) })
    room.on(RoomEvent.Reconnected, () => { if (my === this.serial) { this.set({ status: 'connected' }); this.sendDeaf() } })
    room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      if (my !== this.serial || this.room !== room) return
      if (reason === DisconnectReason.CLIENT_INITIATED) return
      this.set({ status: 'reconnecting', error: 'Bağlantı koptu, yeniden deneniyor…' })
      this.onLost?.()
    })
    room.on(RoomEvent.MediaDevicesError, (e: Error) => this.set({ error: 'Cihaz hatası: ' + e.message }))
    for (const p of room.remoteParticipants.values()) this.patchRemote(name(p), {})
  }
  private patchRemote(n: string, p: Partial<{ muted: boolean; deafened: boolean; quality: string }>) {
    const cur = this.snap.remote[n] || { muted: false, deafened: false, quality: 'unknown' }
    this.set({ remote: { ...this.snap.remote, [n]: { ...cur, ...p } } })
  }
  private sendDeaf() {
    try { this.room?.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ t: 'deaf', on: this.snap.deafened })), { reliable: true }) } catch { /* */ }
  }

  userVolume(n: string) { return this.prefs.mutedUsers.includes(n) ? 0 : (this.prefs.userVolumes[n] ?? 100) }
  applyVolume(n: string) {
    const v = this.snap.deafened ? 0 : (this.userVolume(n) / 100) * (this.prefs.outputVolume / 100)
    for (const t of this.tracks.get(n) || []) { try { (t as any).setVolume(Math.max(0, Math.min(1, v))) } catch { /* */ } }
  }
  applyAllVolumes() { for (const n of this.tracks.keys()) this.applyVolume(n) }

  setPrefs(p: VoicePrefs, prev?: VoicePrefs) {
    this.prefs = p; this.mic?.setPrefs(p); this.applyAllVolumes()
    if (!this.room) return
    if (prev && prev.outputDevice !== p.outputDevice) this.room.switchActiveDevice('audiooutput', p.outputDevice || 'default').catch(() => {})
    if (prev && (prev.inputDevice !== p.inputDevice || prev.noiseSuppression !== p.noiseSuppression || prev.echoCancellation !== p.echoCancellation || prev.autoGain !== p.autoGain || (prev.noisePreset === 'off') !== (p.noisePreset === 'off')) && this.mic && this.mic.stream) {
      // rebuild the capture graph; the published track keeps its MediaStreamTrack, so swap the sender's source
      const old = this.mic; const next = new MicPipeline(p); next.onFallback = old.onFallback; next.muted = old.muted; next.pttDown = old.pttDown; next.onTick = old.onTick
      next.start().then(async () => {
        const pub = [...this.room!.localParticipant.audioTrackPublications.values()][0]
        const lt = pub?.track as LocalAudioTrack | undefined
        if (lt && next.out) await lt.replaceTrack(next.out, { userProvidedTrack: true })
        this.mic = next; await old.stop()
      }).catch((e) => this.set({ error: 'Mikrofon değiştirilemedi: ' + (e?.name || e) }))
    }
  }

  setPtt(down: boolean) { this.pttDown = down; if (this.mic) this.mic.pttDown = down }
  private pushMute() {
    const m = this.snap.muted || this.snap.deafened
    if (this.mic) this.mic.muted = m
    const lt = [...(this.room?.localParticipant.audioTrackPublications.values() || [])][0]?.track as LocalAudioTrack | undefined
    if (lt) { if (m) lt.mute().catch(() => {}); else lt.unmute().catch(() => {}) }
  }
  setMuted(on: boolean) {
    if (this.snap.deafened && !on) { this.setDeafened(false); return }
    this.set({ muted: on }); this.pushMute(); if (this.prefs.joinSounds) (on ? sfx.mute : sfx.unmute)()
  }
  setDeafened(on: boolean) {
    if (on === this.snap.deafened) return
    if (on) { this.mutedBeforeDeafen = this.snap.muted; this.set({ deafened: true, muted: true }) }
    else this.set({ deafened: false, muted: this.mutedBeforeDeafen })
    this.applyAllVolumes(); this.pushMute(); this.sendDeaf(); if (this.prefs.joinSounds) (on ? sfx.deafen : sfx.undeafen)()
  }
  toggleMute() { this.setMuted(!this.snap.muted) }
  toggleDeafen() { this.setDeafened(!this.snap.deafened) }

  async leave(silent = false) {
    this.serial += silent ? 0 : 1
    const r = this.room; this.room = null
    try { r?.disconnect(true) } catch { /* */ }
    for (const el of this.els) el.remove()
    this.els.clear(); this.tracks.clear()
    try { await this.mic?.stop() } catch { /* */ }
    this.mic = null
    if (!silent) this.set({ status: 'idle', error: '', remote: {}, speaking: [], selfSpeaking: false, selfQuality: 'unknown', db: -100 })
  }
}
