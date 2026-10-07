import React, { useEffect, useRef, useState } from 'react'
import { Smoke } from './ui'
import { useApp } from '../store'

// Cinematic backdrop (bright, barely darkened). Priority: cinematic video -> stills (Ken-Burns cross-fade) -> panorama -> clouds.
const videos = import.meta.glob('../assets/bg/*.{mp4,webm}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const sorted = (g: Record<string, string>) => Object.entries(g).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v)
const stills = sorted(import.meta.glob('../assets/bg/stills/*.{jpg,jpeg,png,webp}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>)
const pano = Object.values(import.meta.glob('../assets/bg/panorama/panorama.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>)[0]
export const newsShots: string[] = stills.length ? stills : sorted(import.meta.glob('../assets/bg/panorama/shot*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>)

/** mode: 0 = video, 1 = stills slideshow, 2 = blurred video. */
interface Props { blur?: number; mode?: number; useVideo?: boolean }

export function LoginBg({ blur = 0, mode = 0, useVideo = true }: Props) {
  const video = useVideo && mode !== 1 ? Object.values(videos)[0] : undefined
  const [videoOk, setVideoOk] = useState(true)
  const { awake } = useApp()
  const vref = useRef<HTMLVideoElement>(null)
  const showVideo = !!video && videoOk
  const [i, setI] = useState(0)
  useEffect(() => {
    if (showVideo || stills.length < 2 || !awake) return
    const t = setInterval(() => setI((x) => (x + 1) % stills.length), 7000)
    return () => clearInterval(t)
  }, [showVideo, awake])
  // the video only plays while the window is visible and the game is not running (30 fps source, hardware decoded)
  useEffect(() => { const v = vref.current; if (!v) return; if (awake) v.play().catch(() => {}); else v.pause() }, [awake, showVideo])
  const b = blur || (mode === 2 ? 14 : 0)
  return (
    <div className="lbg">
      <div className="lbg-media" style={b ? { filter: `blur(${b}px)`, transform: 'scale(1.06)' } : undefined}>
        {showVideo && <video ref={vref} src={video} autoPlay muted loop playsInline disablePictureInPicture onError={() => setVideoOk(false)} />}
        {!showVideo && stills.length > 0 && stills.map((s, k) => <div key={s} className={'kb' + (k === i ? ' on' : '')} style={{ backgroundImage: `url(${s})` }} />)}
        {!showVideo && stills.length === 0 && pano && <div className="pano" style={{ backgroundImage: `url(${pano})` }} />}
        {!showVideo && stills.length === 0 && !pano && <Smoke />}
      </div>
      <div className="lbg-shade" />
    </div>
  )
}
