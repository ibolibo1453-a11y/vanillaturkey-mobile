import React, { useEffect, useRef, useState } from 'react'
import { Play, Square, Home, Shirt, Puzzle, Settings, User, Lock, Upload, FolderOpen, Zap, RefreshCw, Search, LogOut, Check, Minus, X, Plus, Trash2, Pencil, ChevronDown, Copy, Clock, Swords, Skull, Image, Sparkles, Newspaper, Users, Layers, Gamepad2, Download, Package, Palette, MessageCircle, Mic, ShieldCheck } from 'lucide-react'
import { Head } from '../social/react'

const MAP: Record<string, any> = {
  shield: ShieldCheck,
  play: Play, stop: Square, home: Home, shirt: Shirt, puzzle: Puzzle, gear: Settings, user: User, lock: Lock, upload: Upload, folder: FolderOpen, bolt: Zap,
  refresh: RefreshCw, search: Search, logout: LogOut, check: Check, min: Minus, close: X, plus: Plus, trash: Trash2, edit: Pencil, chevron: ChevronDown, copy: Copy,
  clock: Clock, swords: Swords, skull: Skull, image: Image, sparkles: Sparkles, news: Newspaper, users: Users, layers: Layers, game: Gamepad2, download: Download, pkg: Package, palette: Palette, chat: MessageCircle, mic: Mic
}

/** lucide-style line icons, 1.75 stroke. */
export const Icon = ({ name, size = 18 }: { name: string; size?: number }) => {
  if (name === 'ms') return <svg width={size} height={size} viewBox="0 0 24 24"><rect x="3" y="3" width="8.6" height="8.6" fill="#F25022"/><rect x="12.4" y="3" width="8.6" height="8.6" fill="#7FBA00"/><rect x="3" y="12.4" width="8.6" height="8.6" fill="#00A4EF"/><rect x="12.4" y="12.4" width="8.6" height="8.6" fill="#FFB900"/></svg>
  if (name === 'max') return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="5.5" y="5.5" width="13" height="13" rx="2" /></svg>
  const I = MAP[name] || Package
  const filled = name === 'play' || name === 'stop'
  return <I size={size} strokeWidth={1.75} {...(filled ? { fill: 'currentColor' } : {})} />
}

export const Toggle = ({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) => (
  <button type="button" className={'toggle' + (on ? ' on' : '')} onClick={() => onChange(!on)} aria-pressed={on} disabled={disabled}><i /></button>
)

/** Fallback backdrop if neither video, stills nor panorama exist: soft blue-white clouds. */
export const Smoke = ({ intense = 1 }: { intense?: number }) => {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current!; const ctx = c.getContext('2d')!
    const W = (c.width = 320), H = (c.height = 190)
    const blobs = Array.from({ length: 10 }, () => ({ x: Math.random() * W, y: Math.random() * H, r: 50 + Math.random() * 70, vx: (Math.random() - 0.5) * 0.2, ph: Math.random() * 6.28 }))
    let raf = 0, t = 0
    const draw = () => {
      t += 0.004
      const g0 = ctx.createLinearGradient(0, 0, 0, H); g0.addColorStop(0, '#5C9BE8'); g0.addColorStop(1, '#BFE0FF')
      ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = g0; ctx.fillRect(0, 0, W, H)
      for (const b of blobs) {
        b.x += b.vx; if (b.x < -80) b.x = W + 80; if (b.x > W + 80) b.x = -80
        const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r)
        const a = (0.25 + 0.08 * Math.sin(t * 2 + b.ph)) * intense
        g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = g; ctx.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2)
      }
      raf = requestAnimationFrame(draw)
    }
    draw(); return () => cancelAnimationFrame(raf)
  }, [intense])
  return <canvas ref={ref} className="smoke" />
}

export const WinControls = () => (
  <div className="winctl pill nodrag">
    <button onClick={() => window.vt.invoke('win:min')} aria-label="Küçült"><Icon name="min" size={16} /></button>
    <button onClick={() => window.vt.invoke('win:max')} aria-label="Büyüt"><Icon name="max" size={15} /></button>
    <button className="x" onClick={() => window.vt.invoke('win:close')} aria-label="Kapat"><Icon name="close" size={16} /></button>
  </div>
)

/** Frameless window handle for screens without the top bar (splash / login). */
export const TitleBar = () => (
  <div className="drag" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 72, zIndex: 50 }}>
    <div style={{ position: 'absolute', top: 16, right: 22 }}><WinControls /></div>
  </div>
)

/** Player head from the server skin system (any name; placeholder first, never blank). */
export const Avatar = ({ name, size = 36 }: { name: string; size?: number }) => <Head name={name} size={size} className="avatar" />

export function Select({ value, options, onChange, width, up }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; width?: number; up?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', h); return () => window.removeEventListener('mousedown', h)
  }, [open])
  const cur = options.find((o) => o.value === value)
  return (
    <div className={'dd' + (open ? ' open' : '') + (up ? ' up' : '')} ref={ref} style={{ minWidth: width || 230 }}>
      <button type="button" className="dd-btn" onClick={() => setOpen(!open)}><span>{cur?.label ?? value}</span><ChevronDown size={15} strokeWidth={2} /></button>
      {open && <div className="dd-list">{options.map((o) => <button key={o.value} type="button" className={o.value === value ? 'on' : ''} onClick={() => { onChange(o.value); setOpen(false) }}>{o.label}{o.value === value && <Check size={14} />}</button>)}</div>}
    </div>
  )
}
