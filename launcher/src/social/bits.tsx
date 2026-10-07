import React, { useEffect, useRef, useState } from 'react'
import { X, ChevronDown, Check } from 'lucide-react'
import { useSocialMaybe } from './react'
import { comboFromEvent, displayCombo, mouseName, normalizeKey, MODS } from './keys'

export const fmtTime = (t: number) => { const d = new Date(t); return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0') }
export const fmtDay = (t: number) => {
  const d = new Date(t), n = new Date(); const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  const y = new Date(n); y.setDate(n.getDate() - 1)
  return same(d, n) ? 'Bugün' : same(d, y) ? 'Dün' : d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })
}
export const fmtDur = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + (s % 60).toString().padStart(2, '0') }

const EMOJIS = '😀 😂 🤣 😊 😍 😘 😎 🤔 😅 😭 😡 🥳 😴 🤯 🙄 😏 👍 👎 👏 🙏 💪 👀 🔥 ✨ ❤️ 💔 💯 🎉 🎮 ⚔️ 🏹 🛡️ 💎 ⛏️ 🧱 🌲 🐺 🐉 🚀 👑 🍕 ☕ 🇹🇷 🤝 😈 💀 🤡 ✅ ❌ ⭐ 🌙 ☀️ 🌈 🎵 🎧 📸 🏆'.split(' ')
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥', '😮', '🎉']
export function EmojiPicker({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const t = setTimeout(() => window.addEventListener('mousedown', h), 0)
    return () => { clearTimeout(t); window.removeEventListener('mousedown', h) }
  }, [onClose])
  return <div className="sx-emoji" ref={ref}>{EMOJIS.map((e) => <button key={e} type="button" onClick={() => onPick(e)}>{e}</button>)}</div>
}

export function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }; window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true) }, [onClose])
  return (
    <div className="sx-lightbox" onClick={onClose}>
      <LbImg src={src} />
      <button className="sx-lb-x" onClick={onClose} aria-label="Kapat"><X size={22} /></button>
    </div>
  )
}

/** Click, then press a key combo or a mouse button (incl. side buttons). Esc cancels, Backspace/Delete clears. */
export function KeyCapture({ value, onChange, allowClear = true }: { value: string; onChange: (v: string) => void; allowClear?: boolean }) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!on) return
    let mods: string[] = []
    const kd = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation()
      if (e.code === 'Escape') { setOn(false); return }
      if ((e.code === 'Backspace' || e.code === 'Delete') && allowClear) { onChange(''); setOn(false); return }
      const c = comboFromEvent(e); const parts = c.split('+'); const main = parts[parts.length - 1]
      mods = parts.filter((p) => MODS.includes(p))
      if (MODS.includes(main)) return // modifier only: wait for the main key
      onChange(normalizeKey(c)); setOn(false)
    }
    const ku = (e: KeyboardEvent) => { // a lone modifier (e.g. Shift) is a valid key too
      const k = comboFromEvent(e).split('+').pop() || ''
      if (MODS.includes(k) && mods.length <= 1) { e.preventDefault(); onChange(k); setOn(false) }
    }
    const md = (e: MouseEvent) => { if (e.button > 2) { e.preventDefault(); e.stopPropagation(); onChange(normalizeKey([...(e.ctrlKey ? ['CTRL'] : []), ...(e.shiftKey ? ['SHIFT'] : []), ...(e.altKey ? ['ALT'] : []), mouseName(e.button)].join('+'))); setOn(false) } }
    const ctx = (e: Event) => e.preventDefault()
    window.addEventListener('keydown', kd, true); window.addEventListener('keyup', ku, true); window.addEventListener('mousedown', md, true); window.addEventListener('auxclick', ctx, true)
    return () => { window.removeEventListener('keydown', kd, true); window.removeEventListener('keyup', ku, true); window.removeEventListener('mousedown', md, true); window.removeEventListener('auxclick', ctx, true) }
  }, [on, onChange, allowClear])
  return <button type="button" className={'sx-keycap' + (on ? ' on' : '') + (!value ? ' empty' : '')} onClick={() => setOn(!on)}>{on ? 'Bir tuşa veya fare tuşuna bas…' : displayCombo(value)}</button>
}

export function Slider({ value, min = 0, max = 100, step = 1, onChange, suffix = '%' }: { value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void; suffix?: string }) {
  const p = ((value - min) / (max - min)) * 100
  return (
    <div className="sx-slider"><input className="slider" type="range" min={min} max={max} step={step} value={value} style={{ '--p': p + '%' } as React.CSSProperties} onChange={(e) => onChange(+e.target.value)} /><span>{Math.round(value)}{suffix}</span></div>
  )
}

/** URL that always loads: tries the direct URL first, falls back to the host's fetch (data URL) when the webview refuses it. */
export function useMediaSrc(url: string): { src: string; onError: () => void } {
  const c = useSocialMaybe()
  const [src, setSrc] = useState(url)
  const tried = useRef(false)
  useEffect(() => { setSrc(url); tried.current = false }, [url])
  return { src, onError: () => { if (tried.current || !c?.a.mediaData) return; tried.current = true; c.a.mediaData(url).then((d) => { if (d) setSrc(d) }) } }
}
export function Photo({ thumb, full, onOpen }: { thumb: string; full: string; onOpen: (u: string) => void }) {
  const m = useMediaSrc(thumb)
  return <img className="sx-photo" loading="lazy" decoding="async" src={m.src} onError={m.onError} alt="Fotoğraf" onClick={() => onOpen(full)} />
}

function LbImg({ src }: { src: string }) { const m = useMediaSrc(src); return <img src={m.src} onError={m.onError} alt="" onClick={(e) => e.stopPropagation()} /> }

/** Glass dropdown (same look as the launcher's Select; self-contained so the PWA gets it too). */
export function GlassSelect({ value, options, onChange, width = 280 }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; width?: number }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', h); return () => window.removeEventListener('mousedown', h)
  }, [open])
  const cur = options.find((o) => o.value === value) || options[0]
  return (
    <div className={'dd' + (open ? ' open' : '')} ref={ref} style={{ width }}>
      <button type="button" className="dd-btn" onClick={() => setOpen(!open)}><span className="sx-dd-t">{cur?.label}</span><ChevronDown size={15} strokeWidth={2} /></button>
      {open && <div className="dd-list">{options.map((o) => <button key={o.value} type="button" className={o.value === cur?.value ? 'on' : ''} onClick={() => { onChange(o.value); setOpen(false) }}><span className="sx-dd-t">{o.label}</span>{o.value === cur?.value && <Check size={14} />}</button>)}</div>}
    </div>
  )
}
