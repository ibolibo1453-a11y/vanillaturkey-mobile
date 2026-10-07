import React, { useCallback, useEffect, useRef, useState } from 'react'
import { getSocial } from '../social'

interface St { ok: boolean; enabled: boolean; linked: boolean; inGuild: boolean; discordName?: string; invite?: string }
const call = (m: string, p: string, b?: any) => window.vt.invoke('api:call', m, p, b, true) as Promise<{ status: number; data: any }>

/** R5-B: link a Discord account (OAuth2 identify). Hidden completely while the server has no Discord credentials. */
export function DiscordLink() {
  const [st, setSt] = useState<St | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const waiting = useRef(0)
  const load = useCallback(async () => { const r = await call('GET', '/v1/discord/status'); if (r.data?.ok) setSt(r.data as St); return r.data as St | undefined }, [])
  useEffect(() => { load(); return () => clearInterval(waiting.current) }, [load])
  useEffect(() => getSocial()?.on((e) => { if (e.t === 'live' && e.frame?.t === 'discord_upd') load() }), [load])
  if (!st?.enabled) return null
  const link = async () => {
    setBusy(true); setErr('')
    const r = await call('POST', '/v1/discord/link')
    setBusy(false)
    if (!r.data?.ok) { setErr(r.data?.error || 'Bağlantı başlatılamadı.'); return }
    window.vt.invoke('shell:open', r.data.url)
    clearInterval(waiting.current)
    let n = 0
    waiting.current = window.setInterval(async () => { const s = await load(); if (s?.linked || ++n > 60) clearInterval(waiting.current) }, 3000)
  }
  const unlink = async () => { setBusy(true); await call('POST', '/v1/discord/unlink'); setBusy(false); load() }
  return (
    <section className="card wide dc-card">
      <h3>Discord</h3>
      <p className="muted">Discord hesabını bağla ve VanillaTurkey Discord sunucusuna katıl: özel <b>Discord pelerini</b> açılır. Sunucudan ayrılırsan pelerin otomatik kalkar.</p>
      <div className="set-row">
        <div><b>{st.linked ? (st.discordName || 'Bağlı hesap') : 'Bağlı değil'}</b><span>{st.linked ? (st.inGuild ? 'Sunucu üyeliği doğrulandı. Pelerin açık.' : 'Hesap bağlı ama sunucuya katılmadın. Pelerin kilitli.') : 'Tarayıcıda Discord ile giriş yapacaksın.'}</span></div>
        <div className="set-ctl" style={{ gap: 8 }}>
          {st.linked && !st.inGuild && st.invite && <button className="btn-primary sm" onClick={() => window.vt.invoke('shell:open', st.invite)}>Sunucuya katıl</button>}
          {st.linked ? <button className="btn-danger sm" disabled={busy} onClick={unlink}>Bağlantıyı kaldır</button> : <button className="btn-primary sm" disabled={busy} onClick={link}>Discord&apos;u bağla</button>}
        </div>
      </div>
      {err && <p className="muted" style={{ color: '#ffb3bd' }}>{err}</p>}
    </section>
  )
}
