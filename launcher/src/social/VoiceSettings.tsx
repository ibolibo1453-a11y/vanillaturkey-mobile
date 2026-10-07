import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, Square, TriangleAlert, Wand2 } from 'lucide-react'
import { useSocial, useSocialClient } from './react'
import { GlassSelect, KeyCapture, Slider } from './bits'
import { MicPipeline, dbFromThreshold, thresholdFromDb, isLoopbackLabel, type MicInfo } from './voice'
import { DEFAULT_VOICE, type VoicePrefs, type NoisePreset } from './types'

const PRESET_LABEL: Record<NoisePreset, string> = { off: 'Kapalı', low: 'Düşük', medium: 'Orta', high: 'Yüksek' }
const PRESET_DESC: Record<NoisePreset, string> = {
  off: 'Yalnızca ses seviyesi eşiği (müzik ve videolar geçebilir)',
  low: 'Yapay zeka gürültü temizleme + hafif konuşma süzgeci',
  medium: 'Müzik, video ve klavye seslerini büyük ölçüde keser (önerilen)',
  high: 'En sıkı süzgeç: yalnızca net konuşma geçer, fısıltı kesilebilir'
}

const Row = ({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) => (
  <div className="set-row"><div><b>{title}</b>{desc && <span>{desc}</span>}</div><div className="set-ctl">{children}</div></div>
)
const Switch = ({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) => (
  <button type="button" className={'toggle' + (on ? ' on' : '')} onClick={() => onChange(!on)} aria-pressed={on}><i /></button>
)
function Dev({ value, kind, devices, onChange }: { value: string; kind: string; devices: MediaDeviceInfo[]; onChange: (v: string) => void }) {
  const list = devices.filter((d) => d.kind === kind && d.deviceId !== 'default' && d.deviceId !== 'communications')
  const opts = [{ value: '', label: 'Sistem varsayılanı' }, ...list.map((d, i) => ({ value: d.deviceId, label: d.label || (kind === 'audioinput' ? 'Mikrofon ' : 'Hoparlör ') + (i + 1) }))]
  return <GlassSelect value={opts.some((o) => o.value === value) ? value : ''} options={opts} onChange={onChange} />
}

/** Ses Ayarları: devices, volumes, mic test meter, PTT / voice activity, processing, keybinds, sounds. */
export function VoiceSettings() {
  const c = useSocialClient()
  const s = useSocial()
  const p = s.prefs
  const set = useCallback((x: Partial<VoicePrefs>) => c.setPrefs(x), [c])
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [testing, setTesting] = useState(false)
  const [db, setDb] = useState(-100)
  const [err, setErr] = useState('')
  const pipe = useRef<MicPipeline | null>(null)
  const [info, setInfo] = useState<MicInfo | null>(null)
  const [cal, setCal] = useState(0) // seconds left of the automatic threshold measurement (0 = idle)
  const calRef = useRef(0)

  const refreshDevices = useCallback(async () => {
    try { setDevices(await navigator.mediaDevices.enumerateDevices()) } catch { /* */ }
  }, [])
  useEffect(() => {
    refreshDevices()
    // device labels need mic permission once
    navigator.mediaDevices.getUserMedia({ audio: true }).then((st) => { st.getTracks().forEach((t) => t.stop()); refreshDevices() }).catch(() => {})
    navigator.mediaDevices.addEventListener?.('devicechange', refreshDevices)
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', refreshDevices)
  }, [refreshDevices])

  const stopTest = useCallback(() => { pipe.current?.stop(); pipe.current = null; setTesting(false); setDb(-100); setInfo(null) }, [])
  useEffect(() => () => { pipe.current?.stop(); clearInterval(calRef.current) }, [])
  const startTest = async () => {
    setErr('')
    const m = new MicPipeline(p); m.forcedOpen = true; m.onFallback = (t) => c.toast({ channel: '', title: 'Ses kirliliği engelleme', body: t, kind: 'info' })
    m.onTick = (d, _sp, i) => { setDb(d); setInfo(i) }
    try { await m.start(); pipe.current = m; setTesting(true) } catch (e: any) { setErr('Mikrofon açılamadı: ' + (e?.name || e)) }
  }
  // restart the test when the capture settings change
  useEffect(() => { if (testing) { stopTest(); startTest() } /* eslint-disable-next-line */ }, [p.inputDevice, p.noiseSuppression, p.echoCancellation, p.autoGain, p.noisePreset === 'off'])
  useEffect(() => { pipe.current?.setPrefs(p) }, [p])

  const lvl = Math.max(0, Math.min(100, ((db + 70) / 70) * 100))
  const thr = ((dbFromThreshold(p.vadThreshold) + 70) / 70) * 100
  const speaking = testing && !!info && info.open && db > -62
  const noisy = testing && !!info && info.hot && !info.open && p.noisePreset !== 'off' // loud but not voice-like: music / video
  const sel = devices.find((d) => d.kind === 'audioinput' && d.deviceId === (p.inputDevice || 'default'))
  const loop = isLoopbackLabel(sel?.label || '') || (!p.inputDevice && isLoopbackLabel(devices.find((d) => d.kind === 'audioinput' && d.deviceId === 'communications')?.label || ''))
  const autoThreshold = async () => {
    if (cal) return
    setErr(''); const m = new MicPipeline({ ...p, vadThreshold: 100 }); m.forcedOpen = true
    const vals: number[] = []; let on = false
    m.onTick = (d) => { if (on) vals.push(d) }
    try { await m.start() } catch (e: any) { setErr('Mikrofon açılamadı: ' + (e?.name || e)); return }
    await new Promise((r) => setTimeout(r, 500)); on = true; setCal(3); calRef.current = window.setInterval(() => setCal((n) => (n > 1 ? n - 1 : n)), 1000)
    await new Promise((r) => setTimeout(r, 3000)); clearInterval(calRef.current); setCal(0)
    await m.stop()
    if (vals.length < 20) { setErr('Ölçüm yapılamadı.'); return }
    vals.sort((a, b) => a - b); const p95 = vals[Math.floor(vals.length * 0.95)]
    set({ vadThreshold: Math.max(10, thresholdFromDb(p95 + 6)) }) // 6 dB above the loudest 5 % of the room noise
  }
  return (
    <div className="sx-vs">
      <section className="card">
        <h3>Cihazlar</h3>
        <Row title="Mikrofon" desc="Giriş cihazı"><Dev value={p.inputDevice} kind="audioinput" devices={devices} onChange={(v) => set({ inputDevice: v })} /></Row>
        <Row title="Hoparlör / kulaklık" desc="Çıkış cihazı"><Dev value={p.outputDevice} kind="audiooutput" devices={devices} onChange={(v) => set({ outputDevice: v })} /></Row>
        <Row title="Giriş ses seviyesi"><Slider value={p.inputVolume} min={0} max={200} onChange={(v) => set({ inputVolume: v })} /></Row>
        <Row title="Çıkış ses seviyesi" desc="Odadaki herkesin sesi"><Slider value={p.outputVolume} min={0} max={100} onChange={(v) => set({ outputVolume: v })} /></Row>
      </section>
      <section className="card">
        <h3>Mikrofon testi</h3>
        <div className="sx-meter-row">
          <button className={testing ? 'btn-danger sm' : 'btn-primary sm'} onClick={testing ? stopTest : startTest}>{testing ? <><Square size={14} /> Testi durdur</> : <><Mic size={15} /> Mikrofonu test et</>}</button>
          <div className={'sx-meter' + (speaking ? ' hot' : '')}>
            <i style={{ width: lvl + '%' }} />
            {p.mode === 'vad' && <b style={{ left: thr + '%' }} title="Ses algılama eşiği" />}
          </div>
          <span className="sx-meter-t">{testing ? (speaking ? 'Konuşuyorsun' : noisy ? 'Ses var, konuşma değil' : 'Sessiz') : 'Kapalı'}</span>
        </div>
        {testing && p.noisePreset !== 'off' && info && <div className="sx-voice-row"><span>Konuşma benzerliği</span><div className="sx-vbar"><i style={{ width: Math.round(info.voice * 100) + '%' }} /></div><em>{info.denoise ? 'RNNoise açık' : 'RNNoise yok'}</em></div>}
        {err && <div className="form-err">{err}</div>}
        {loop && <div className="sx-warn"><TriangleAlert size={15} /> Bu cihaz bilgisayar sesini de gönderir. Müzik ve videolar odaya karışır; gerçek mikrofonunu seç.</div>}
        <Row title="Giriş modu" desc={p.mode === 'vad' ? 'Sesin eşiği geçince otomatik gönderilir' : 'Tuşa basılı tutarken konuşursun'}>
          <div className="seg"><button className={p.mode === 'vad' ? 'on' : ''} onClick={() => set({ mode: 'vad' })}>Ses algılama</button><button className={p.mode === 'ptt' ? 'on' : ''} onClick={() => set({ mode: 'ptt' })}>Bas-konuş</button></div>
        </Row>
        {p.mode === 'vad'
          ? <Row title="Ses algılama eşiği" desc="Metrenin üstündeki işaret: bu çizgiyi geçince mikrofon açılır"><div className="sx-thr"><Slider value={p.vadThreshold} min={0} max={100} onChange={(v) => set({ vadThreshold: v })} suffix="" /><button className="btn-ghost sm" disabled={!!cal} onClick={autoThreshold} title="3 saniye oda sesini ölçer"><Wand2 size={14} /> {cal ? 'Ölçülüyor… ' + cal + ' (sessiz kal)' : 'Otomatik'}</button></div></Row>
          : <Row title="Bas-konuş tuşu" desc="Fare yan tuşları da olur (Fare 4/5)"><KeyCapture value={p.keyPtt} onChange={(v) => set({ keyPtt: v })} /></Row>}
      </section>
      <section className="card">
        <h3>Ses işleme</h3>
        <Row title="Ses kirliliği engelleme" desc={PRESET_DESC[p.noisePreset] || PRESET_DESC.medium}>
          <div className="seg">{(['off', 'low', 'medium', 'high'] as NoisePreset[]).map((k) => <button key={k} className={p.noisePreset === k ? 'on' : ''} onClick={() => set({ noisePreset: k })}>{PRESET_LABEL[k]}</button>)}</div>
        </Row>
        <Row title="Gürültü engelleme" desc={p.noisePreset !== 'off' ? 'Ses kirliliği engelleme açıkken her zaman açık' : 'Klavye, fan gibi arka plan seslerini azaltır'}><Switch on={p.noiseSuppression} onChange={(v) => set({ noiseSuppression: v })} /></Row>
        <Row title="Yankı önleme" desc="Hoparlörden gelen sesin mikrofona karışmasını engeller"><Switch on={p.echoCancellation} onChange={(v) => set({ echoCancellation: v })} /></Row>
        <Row title="Otomatik kazanç" desc="Sesini otomatik dengeler"><Switch on={p.autoGain} onChange={(v) => set({ autoGain: v })} /></Row>
      </section>
      <section className="card">
        <h3>Kısayollar</h3>
        <Row title="Mikrofonu aç/kapat" desc="Oyun kapalıyken sistem genelinde, oyunda oyunun içinden çalışır"><KeyCapture value={p.keyMute} onChange={(v) => set({ keyMute: v })} /></Row>
        <Row title="Sesi aç/kapat (sağır)"><KeyCapture value={p.keyDeafen} onChange={(v) => set({ keyDeafen: v })} /></Row>
        <Row title="Oyunda sohbeti aç" desc="Oyun içinde Sohbet & Ses penceresi"><KeyCapture value={p.keyChat} onChange={(v) => set({ keyChat: v })} /></Row>
        <button className="btn-ghost sm" onClick={() => set({ keyPtt: DEFAULT_VOICE.keyPtt, keyMute: DEFAULT_VOICE.keyMute, keyDeafen: DEFAULT_VOICE.keyDeafen, keyChat: DEFAULT_VOICE.keyChat })}>Varsayılan kısayollar</button>
      </section>
      <section className="card">
        <h3>Sesler</h3>
        <Row title="Katılma / ayrılma sesleri" desc="Odaya biri girince ve çıkınca, mikrofon aç/kapa"><Switch on={p.joinSounds} onChange={(v) => set({ joinSounds: v })} /></Row>
        <Row title="Bildirim sesi" desc="Yeni mesaj ve arkadaşlık isteği"><Switch on={p.notifSounds} onChange={(v) => set({ notifSounds: v })} /></Row>
      </section>
    </div>
  )
}
(window as any).__MicPipeline = MicPipeline // dev/test hook
