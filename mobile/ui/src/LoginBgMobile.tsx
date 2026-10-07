import React, { useEffect, useState } from 'react'
import { Smoke } from '@launcher/components/ui'
import { useApp } from '@launcher/store'

// Phone variant of launcher/src/components/LoginBg.tsx: stills slideshow only (no 25 MB video), cheaper blur.
const sorted = (g: Record<string, string>) => Object.entries(g).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v)
const stills = sorted(import.meta.glob('../../../launcher/src/assets/bg/stills/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>)
export const newsShots: string[] = stills

interface Props { blur?: number; mode?: number; useVideo?: boolean }
export function LoginBg({ blur = 0, mode = 0 }: Props) {
  const { awake } = useApp()
  const [i, setI] = useState(0)
  useEffect(() => {
    if (stills.length < 2 || !awake) return
    const t = setInterval(() => setI((x) => (x + 1) % stills.length), 9000)
    return () => clearInterval(t)
  }, [awake])
  const b = Math.min(blur || (mode === 2 ? 10 : 0), 10)
  return (
    <div className="lbg">
      <div className="lbg-media" style={b ? { filter: `blur(${b}px)`, transform: 'scale(1.06)' } : undefined}>
        {stills.length > 0 ? stills.map((s, k) => (Math.abs(k - i) <= 1 || (i === 0 && k === stills.length - 1) ? <div key={s} className={'kb' + (k === i ? ' on' : '')} style={{ backgroundImage: `url(${s})` }} /> : null)) : <Smoke />}
      </div>
      <div className="lbg-shade" />
    </div>
  )
}
