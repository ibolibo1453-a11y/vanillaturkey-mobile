// R5-A+: server-driven announcement / MOTD / maintenance / minimum-version strip. Shared by the launcher and the PWA.
import React, { useEffect, useState } from 'react'
import { Megaphone, X } from 'lucide-react'
import { useSocialMaybe } from '../social/react'
import type { CallFn } from '../sponsor/Sponsor'

interface Ann { id: number; text: string; kind: string }
const cmp = (a: string, b: string) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 4; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d } return 0 }

export function LiveBanner({ call, version }: { call: CallFn; version: string }) {
  const [anns, setAnns] = useState<Ann[]>([])
  const [cfg, setCfg] = useState<any>(null)
  const [hidden, setHidden] = useState<number[]>([])
  const c = useSocialMaybe()
  useEffect(() => {
    let live = true
    const load = () => {
      call('GET', '/v1/announcements').then((r) => { if (live && r.data?.ok) setAnns(r.data.announcements) }).catch(() => {})
      call('GET', '/v1/config').then((r) => { if (live && r.data?.ok) setCfg(r.data) }).catch(() => {})
    }
    load(); const t = setInterval(load, 60000)
    return () => { live = false; clearInterval(t) }
  }, [call])
  useEffect(() => c?.on((e: any) => {
    if (e.t !== 'live') return
    const f = e.frame
    if (f.t === 'announce') setAnns((l) => [f.announcement, ...l.filter((x) => x.id !== f.announcement.id)].slice(0, 3))
    else if (f.t === 'announce_del') setAnns((l) => l.filter((x) => x.id !== f.id))
    else if (f.t === 'config') setCfg(f.config)
  }), [c])
  const lines: { key: string; text: string; kind: string; id?: number }[] = []
  if (cfg?.maintenance?.on) lines.push({ key: 'm', text: cfg.maintenance.message || 'Bakım modu açık.', kind: 'warn' })
  if (cfg?.minVersion && version && cmp(version, cfg.minVersion) < 0) lines.push({ key: 'v', text: `Güncelleme gerekli: en düşük sürüm ${cfg.minVersion} (sende ${version}).`, kind: 'warn' })
  for (const a of anns) if (!hidden.includes(a.id)) lines.push({ key: 'a' + a.id, text: a.text, kind: a.kind, id: a.id })
  if (cfg?.motd) lines.push({ key: 'motd', text: cfg.motd, kind: 'info' })
  if (!lines.length) return null
  const l = lines[0]
  return (
    <div className={'live-banner ' + l.kind} role="status"><Megaphone size={15} /><span>{l.text}</span>{l.id != null && <button onClick={() => setHidden([...hidden, l.id!])} aria-label="Kapat"><X size={14} /></button>}</div>
  )
}
