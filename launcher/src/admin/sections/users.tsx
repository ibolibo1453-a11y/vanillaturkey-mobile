import React, { useCallback, useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { registerAdminSection } from '../registry'
import type { PanelApi } from '../types'

interface U { name: string; role: string | null; online: boolean; banned: boolean; muted: boolean }
interface Prof { name: string; uuid: string; registeredAt: number; role: string | null; online: boolean; accountsOnSameIp: number; activeSessions: number; room: string | null
  ban: { until: number; reason: string } | null; mute: { until: number; reason: string } | null; stats: { totalSeconds: number; playerKills: number; mobKills: number } | null }

const fmtDate = (t: number) => (t ? new Date(t).toLocaleString('tr-TR') : '-')
const until = (t: number) => (t ? new Date(t).toLocaleString('tr-TR') : 'kalıcı')

function Users({ api }: { api: PanelApi; role: string }) {
  const [q, setQ] = useState('')
  const [list, setList] = useState<U[] | null>(null)
  const [sel, setSel] = useState('')
  const [p, setP] = useState<Prof | null>(null)
  const [mins, setMins] = useState('60')
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState<{ t: string; bad: boolean } | null>(null)
  const say = useCallback((t: string, bad = false) => { setMsg({ t, bad }); setTimeout(() => setMsg((m) => (m?.t === t ? null : m)), 3500) }, [])
  const search = useCallback(() => { api.call('GET', '/v1/admin/users?q=' + encodeURIComponent(q.trim())).then((r) => { if (r.data?.ok) setList(r.data.users); else say(r.data?.error || 'Arama başarısız.', true) }) }, [api, q, say])
  useEffect(() => { const t = setTimeout(search, 250); return () => clearTimeout(t) }, [search])
  const load = useCallback((n: string) => { api.call('GET', '/v1/admin/users/' + encodeURIComponent(n)).then((r) => { if (r.data?.ok) setP(r.data); else say(r.data?.error || 'Profil alınamadı.', true) }) }, [api, say])
  useEffect(() => { if (sel) load(sel); else setP(null) }, [sel, load])
  const act = async (a: string, body?: any) => {
    const r = await api.call('POST', `/v1/admin/users/${encodeURIComponent(sel)}/${a}`, body)
    if (r.data?.ok) { say('Tamam.'); load(sel); search() } else say(r.data?.error || 'İşlem başarısız.', true)
  }
  const m = Math.max(0, Math.floor(Number(mins) || 0))
  return (
    <div className="vta-sec">
      <div className="vta-sechead"><div><h2>Kullanıcılar</h2><p>Ara, profile bak, yasakla, sustur, sesten at, skini sıfırla. Her işlem denetim kaydına yazılır.</p></div></div>
      {msg && <div className={'vta-msg' + (msg.bad ? ' bad' : '')} role="status">{msg.t}</div>}
      <div className="vta-add"><input value={q} maxLength={16} placeholder="Kullanıcı adı ara" onChange={(e) => setQ(e.target.value)} /><span className="vta-btn" aria-hidden><Search size={14} /></span></div>
      <div className="vta-users">
        <div className="vta-ulist">
          {list === null && <p className="vta-empty">Yükleniyor…</p>}
          {list?.length === 0 && <p className="vta-empty">Sonuç yok.</p>}
          {list?.map((u) => (
            <button key={u.name} className={'vta-urow' + (sel === u.name ? ' on' : '')} onClick={() => setSel(u.name)}>
              <i className={u.online ? 'on' : ''} /><b>{u.name}</b>{u.role && <em>{u.role}</em>}{u.banned && <span className="bad">yasaklı</span>}{u.muted && <span className="warn">susturulmuş</span>}
            </button>
          ))}
        </div>
        <div className="vta-card vta-prof">
          {!p ? <p className="vta-empty">Soldan bir kullanıcı seç.</p> : (
            <>
              <h3>{p.name} {p.role && <em className="vta-tagrole">{p.role}</em>}</h3>
              <dl>
                <dt>Durum</dt><dd>{p.online ? 'Çevrimiçi' : 'Çevrimdışı'}{p.room ? ' · ses odasında' : ''}</dd>
                <dt>Kayıt</dt><dd>{fmtDate(p.registeredAt)}</dd>
                <dt>Aynı IP&apos;deki hesap</dt><dd>{p.accountsOnSameIp}</dd>
                <dt>Açık oturum</dt><dd>{p.activeSessions}</dd>
                {p.stats && <><dt>Oynama</dt><dd>{Math.round(p.stats.totalSeconds / 3600 * 10) / 10} saat · {p.stats.playerKills} oyuncu · {p.stats.mobKills} yaratık</dd></>}
                {p.ban && <><dt>Yasak</dt><dd className="bad">{until(p.ban.until)} · {p.ban.reason || 'sebep yok'}</dd></>}
                {p.mute && <><dt>Susturma</dt><dd className="warn">{until(p.mute.until)} · {p.mute.reason || 'sebep yok'}</dd></>}
              </dl>
              <div className="vta-line"><input className="vta-num" value={mins} inputMode="numeric" onChange={(e) => setMins(e.target.value.replace(/\D/g, ''))} /><span className="vta-dim">dakika (0 = kalıcı yasak)</span><input value={reason} maxLength={200} placeholder="Sebep" onChange={(e) => setReason(e.target.value)} /></div>
              <div className="vta-line">
                {p.ban ? <button className="vta-btn" onClick={() => act('unban')}>Yasağı kaldır</button> : <button className="vta-btn danger" onClick={() => act('ban', { minutes: m || undefined, reason })}>Yasakla</button>}
                {p.mute ? <button className="vta-btn" onClick={() => act('unmute')}>Susturmayı kaldır</button> : <button className="vta-btn" disabled={!m} onClick={() => act('mute', { minutes: m, reason })}>Sustur</button>}
                <button className="vta-btn" disabled={!p.room} onClick={() => act('voice-kick')}>Sesten at</button>
                <button className="vta-btn" onClick={() => { if (confirm('Skin sıfırlansın mı?')) act('reset-skin') }}>Skini sıfırla</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

registerAdminSection({ id: 'users', label: 'Kullanıcılar', order: 30, Component: Users })

interface Entry { id: number; at: number; actor: string; action: string; target: string; detail: string }
function Audit({ api }: { api: PanelApi; role: string }) {
  const [rows, setRows] = useState<Entry[] | null>(null)
  const load = useCallback(() => { api.call('GET', '/v1/admin/audit?limit=100').then((r) => { if (r.data?.ok) setRows(r.data.entries) }) }, [api])
  useEffect(load, [load])
  return (
    <div className="vta-sec">
      <div className="vta-sechead"><div><h2>Denetim kaydı</h2><p>Yönetim panelinden yapılan her işlem.</p></div><button className="vta-btn" onClick={load}>Yenile</button></div>
      <div className="vta-card vta-audit">
        {rows === null && <p className="vta-empty">Yükleniyor…</p>}
        {rows?.length === 0 && <p className="vta-empty">Kayıt yok.</p>}
        {rows?.map((e) => <div key={e.id} className="vta-arow"><span className="t">{new Date(e.at).toLocaleString('tr-TR')}</span><b>{e.actor}</b><code>{e.action}</code><span>{e.target}</span><em>{e.detail}</em></div>)}
      </div>
    </div>
  )
}
registerAdminSection({ id: 'audit', label: 'Denetim kaydı', order: 70, Component: Audit })
