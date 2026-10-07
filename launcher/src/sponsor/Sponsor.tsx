// R5-A sponsor card + animated drawer. Shared by the launcher home and the PWA (the in-game title screen mirrors it).
// Data: GET /v1/servers (public). The component never talks to Electron: the host passes `call` and `onJoin`.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, Gamepad2, Users, X } from 'lucide-react'
import { getSocial } from '../social/react'
import './sponsor.css'

export interface SponsorServer {
  id: string; name: string; label: string; image: string; description: string; ip: string; version: string; enabled: boolean; order: number; tag?: string; blurb?: string
  status: { online: number; max: number; pingMs: number } | null
}
export type CallFn = (method: string, path: string, body?: any) => Promise<{ status: number; data: any }>

/** Polls the public server list (30 s, paused while hidden). */
export function useSponsors(call: CallFn, enabled = true): SponsorServer[] {
  const [list, setList] = useState<SponsorServer[]>([])
  useEffect(() => {
    if (!enabled) return
    let live = true
    const load = () => { if (document.visibilityState === 'hidden') return; call('GET', '/v1/servers').then((r) => { if (live && r.data?.ok) setList(r.data.servers as SponsorServer[]) }).catch(() => {}) }
    load()
    const t = setInterval(load, 30000)
    // R6: the admin changed a card -> ws `servers_upd` -> refetch at once (the social client may start after this effect)
    let off: (() => void) | undefined
    const hook = setInterval(() => {
      const c = getSocial()
      if (!c || off) return
      clearInterval(hook)
      off = c.on((e: any) => { if (e.t === 'live' && e.frame?.t === 'servers_upd') load() })
    }, 1500)
    return () => { live = false; clearInterval(t); clearInterval(hook); off?.() }
  }, [call, enabled])
  return list
}

/** Small card: image, "SPONSOR" tag, label. */
export function SponsorCard({ server, onOpen, active }: { server: SponsorServer; onOpen: () => void; active?: boolean }) {
  return (
    <button className={'sp-card' + (active ? ' on' : '')} onClick={onOpen} aria-label={`${server.label || server.name} sponsor sunucusu`}>
      {server.image ? <img className="sp-img" src={server.image} alt="" draggable={false} /> : <div className="sp-img sp-ph" />}
      <span className="sp-shade" />
      <span className="sp-tag">{server.tag || 'SPONSOR'}</span>
      {server.status && <span className="sp-live"><i />{server.status.online}</span>}
      <span className="sp-txt"><b>{server.label || server.name}</b><em>{server.name}{server.blurb ? ' · ' + server.blurb : ''}</em></span>
    </button>
  )
}

/** Left drawer: slides in with an ease-out, big image, description, online/ping, Katıl + Kapat. */
export function SponsorDrawer({ server, open, onClose, onJoin, joinBusy, joinHint }: {
  server: SponsorServer | null; open: boolean; onClose: () => void
  onJoin?: (s: SponsorServer) => void; joinBusy?: boolean; joinHint?: string
}) {
  const last = useRef<SponsorServer | null>(null)
  if (server) last.current = server
  const s = server || last.current
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    if (!s?.ip) return
    navigator.clipboard?.writeText(s.ip).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {})
  }, [s?.ip])
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!s) return null
  const noIp = !s.ip
  return (
    <aside className={'sp-drawer' + (open ? ' open' : '')} aria-hidden={!open} aria-label={s.name}>
      <div className="sp-d-img">
        {s.image ? <img src={s.image} alt={s.name} draggable={false} /> : <div className="sp-ph" />}
        <span className="sp-shade" />
        <span className="sp-tag">{s.tag || 'SPONSOR'}</span>
        <button className="sp-x" onClick={onClose} aria-label="Kapat" tabIndex={open ? 0 : -1}><X size={18} /></button>
      </div>
      <div className="sp-d-body">
        <span className="sp-label">{s.label}</span>
        <h2>{s.name}</h2>
        <p className="sp-desc">{s.description || 'Bu sunucu hakkında bilgi yakında.'}</p>
        <div className="sp-rows">
          <div className="sp-row"><span>Sunucu IP</span>{noIp ? <b className="dim">Yakında açıklanacak</b> : <button className="sp-ip" onClick={copy} tabIndex={open ? 0 : -1}><b>{s.ip}</b>{copied ? <Check size={14} /> : <Copy size={14} />}</button>}</div>
          {s.version && <div className="sp-row"><span>Sürüm</span><b>{s.version}</b></div>}
          <div className="sp-row"><span>Durum</span>{s.status ? <b><i className="sp-dot ok" /><Users size={13} /> {s.status.online}/{s.status.max} · {s.status.pingMs} ms</b> : <b className="dim"><i className="sp-dot" />{noIp ? 'Henüz açık değil' : 'Çevrimdışı'}</b>}</div>
        </div>
        <div className="sp-btns">
          {onJoin ? (
            <button className="btn-primary sp-join" disabled={noIp || joinBusy} onClick={() => onJoin(s)} tabIndex={open ? 0 : -1}><Gamepad2 size={18} /> {joinBusy ? (joinHint || 'Oyun açık') : 'Katıl'}</button>
          ) : (
            <button className="btn-primary sp-join" disabled={noIp} onClick={copy} tabIndex={open ? 0 : -1}>{copied ? <Check size={18} /> : <Copy size={18} />} {copied ? 'Kopyalandı' : 'IP’yi kopyala'}</button>
          )}
          <button className="btn-glass sp-close" onClick={onClose} tabIndex={open ? 0 : -1}>Kapat</button>
        </div>
        {noIp && <p className="sp-note">Sunucu IP adresi henüz belirlenmedi; belirlenince Katıl açılır.</p>}
      </div>
    </aside>
  )
}
