import React, { useEffect, useRef, useState } from 'react'
import { Mic } from 'lucide-react'
import { fmtDur } from './bits'

/** Hold-to-record voice message (opus/webm via MediaRecorder). Release = send, Esc = cancel. */
export function RecordButton({ onDone, onError }: { onDone: (blob: Blob, durationMs: number) => void; onError: (m: string) => void }) {
  const [rec, setRec] = useState(false)
  const [ms, setMs] = useState(0)
  const [bars, setBars] = useState<number[]>([])
  const st = useRef<{ mr: MediaRecorder; stream: MediaStream; t0: number; chunks: Blob[]; cancel: boolean; ctx: AudioContext; timer: number } | null>(null)
  const starting = useRef(false)
  const wantStop = useRef(false)

  const finish = (cancel: boolean) => {
    wantStop.current = true
    const s = st.current; if (!s) return
    s.cancel = cancel; st.current = null; clearInterval(s.timer)
    try { if (s.mr.state !== 'inactive') s.mr.stop() } catch { /* */ }
    s.stream.getTracks().forEach((t) => t.stop()); s.ctx.close().catch(() => {})
    setRec(false); setMs(0); setBars([])
  }
  const start = async (e: React.PointerEvent) => {
    if (st.current || starting.current || e.button !== 0) return
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    starting.current = true; wantStop.current = false
    let stream: MediaStream
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } }) } catch { starting.current = false; onError('Mikrofona erişilemedi.'); return }
    starting.current = false
    if (wantStop.current) { stream.getTracks().forEach((t) => t.stop()); onError('Sesli mesaj için basılı tut.'); return }
    const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m))
    const mr = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 24000 })
    const ctx = new AudioContext(); const an = ctx.createAnalyser(); an.fftSize = 512; ctx.createMediaStreamSource(stream).connect(an)
    const buf = new Uint8Array(an.fftSize); const t0 = performance.now()
    const s = { mr, stream, t0, chunks: [] as Blob[], cancel: false, ctx, timer: 0 }
    s.timer = window.setInterval(() => {
      an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128))
      setBars((b) => [...b.slice(-39), Math.min(1, m / 90)]); const el = performance.now() - t0; setMs(el)
      if (el > 59000) finish(false)
    }, 80)
    mr.ondataavailable = (ev) => { if (ev.data.size) s.chunks.push(ev.data) }
    mr.onstop = () => {
      const dur = performance.now() - t0
      if (s.cancel) return
      if (dur < 600) { onError('Sesli mesaj için basılı tut.'); return }
      onDone(new Blob(s.chunks, { type: mr.mimeType || 'audio/webm' }), dur)
    }
    st.current = s; mr.start(250); setRec(true)
  }
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && st.current) finish(true) }; window.addEventListener('keydown', k); return () => { window.removeEventListener('keydown', k); finish(true) } }, [])
  return (
    <>
      {rec && (
        <div className="sx-recording"><i className="sx-recdot" /><b>{fmtDur(ms)}</b><div className="sx-recbars">{bars.map((b, i) => <i key={i} style={{ height: 4 + b * 26 }} />)}</div><span>Bırak = gönder · Esc = iptal</span></div>
      )}
      <button type="button" className={'sx-ibtn rec' + (rec ? ' on' : '')} title="Basılı tut: sesli mesaj" aria-label="Sesli mesaj" onPointerDown={start} onPointerUp={() => finish(false)} onPointerCancel={() => finish(true)}><Mic size={18} /></button>
    </>
  )
}
