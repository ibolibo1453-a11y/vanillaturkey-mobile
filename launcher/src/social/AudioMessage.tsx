import React, { useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { fmtDur, useMediaSrc } from './bits'
import { useSocialMaybe } from './react'

const peaksCache = new Map<string, number[]>()
let inflight = 0
const N = 36
const fake = (seed: string) => { let h = 7; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0; return Array.from({ length: N }, (_, i) => 0.25 + 0.6 * Math.abs(Math.sin(h * 0.001 + i * 0.7)) * (0.6 + 0.4 * Math.abs(Math.cos(i * 1.3 + h)))) }

async function computePeaks(url: string): Promise<number[] | null> {
  try {
    const buf = url.startsWith('data:') ? Uint8Array.from(atob(url.split(',')[1]), (ch) => ch.charCodeAt(0)).buffer : await fetch(url).then((r) => r.arrayBuffer()).catch(() => { throw new Error('x') })
    const ctx = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(1, 44100, 44100)
    const ab = await ctx.decodeAudioData(buf); const d = ab.getChannelData(0); const step = Math.floor(d.length / N) || 1
    const out: number[] = []
    for (let i = 0; i < N; i++) { let m = 0; for (let j = i * step; j < Math.min(d.length, (i + 1) * step); j += 8) m = Math.max(m, Math.abs(d[j])); out.push(m) }
    const mx = Math.max(...out, 0.01); return out.map((v) => Math.max(0.12, v / mx))
  } catch { return null }
}

/** Voice message: waveform (decoded lazily) + play/pause + seek. */
export function AudioMessage({ url, durationMs, id }: { url: string; durationMs?: number; id: string }) {
  const el = useRef<HTMLAudioElement>(null)
  const media = useMediaSrc(url)
  const c = useSocialMaybe()
  const [peaks, setPeaks] = useState<number[]>(() => peaksCache.get(url) || fake(id))
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [dur, setDur] = useState(durationMs || 0)
  useEffect(() => {
    if (peaksCache.has(url) || inflight > 3) return
    let live = true; inflight++
    computePeaks(url).then((p) => p || (c?.a.mediaData ? c.a.mediaData(url).then((d) => (d ? computePeaks(d) : null)) : null)).then((p) => { inflight--; if (p) { peaksCache.set(url, p); if (live) setPeaks(p) } })
    return () => { live = false }
  }, [url])
  const toggle = () => { const a = el.current; if (!a) return; if (a.paused) { document.querySelectorAll('audio.sx-audio').forEach((x) => { if (x !== a) (x as HTMLAudioElement).pause() }); a.play().catch(() => {}) } else a.pause() }
  const ratio = dur ? Math.min(1, pos / dur) : 0
  return (
    <div className="sx-audio-msg">
      <audio ref={el} className="sx-audio" src={media.src} onError={media.onError} preload="none"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setPos(0) }}
        onLoadedMetadata={(e) => { const d = (e.target as HTMLAudioElement).duration; if (isFinite(d) && d > 0) setDur(d * 1000) }}
        onTimeUpdate={(e) => setPos((e.target as HTMLAudioElement).currentTime * 1000)} />
      <button className="sx-play" onClick={toggle} aria-label={playing ? 'Duraklat' : 'Oynat'}>{playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button>
      <div className="sx-wave" onClick={(e) => { const a = el.current; if (!a) return; const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); const d = a.duration; if (isFinite(d)) { a.currentTime = d * ((e.clientX - r.left) / r.width); if (a.paused) a.play().catch(() => {}) } }}>
        {peaks.map((p, i) => <i key={i} className={i / peaks.length < ratio ? 'on' : ''} style={{ height: Math.round(p * 100) + '%' }} />)}
      </div>
      <span className="sx-dur">{fmtDur(playing || pos ? pos : dur)}</span>
    </div>
  )
}
