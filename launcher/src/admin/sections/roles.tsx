import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Search, Trash2, X } from 'lucide-react'
import { Head } from '../../social/react'
import { roleColor, setRoleDefs } from '../../social/roles'
import { registerAdminSection } from '../registry'
import type { PanelApi } from '../types'

interface RoleDef { name: string; color: string; builtin: boolean; locked?: boolean; perms: string[] }
interface Perm { id: string; label: string }
interface Holder { name: string; role: string; fixed?: boolean }
interface Found { name: string; role: string | null }

const Pill = ({ role }: { role: string }) => <span className="vta-rolepill" style={{ ['--rc' as any]: roleColor(role) || '#fff' }}>{role}</span>

/** R5-B / R5-A+ "Roller": assign roles, create custom roles with a colour, tick the permissions of every role. Needs permission roles.edit. */
function Roles({ api }: { api: PanelApi; role: string }) {
  const [tab, setTab] = useState<'users' | 'roles'>('users')
  const [roles, setRoles] = useState<RoleDef[]>([])
  const [perms, setPerms] = useState<Perm[]>([])
  const [holders, setHolders] = useState<Holder[] | null>(null)
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Found[]>([])
  const [msg, setMsg] = useState<{ t: string; bad: boolean } | null>(null)
  const [nn, setNn] = useState(''), [nc, setNc] = useState('#3DDC84')
  const timer = useRef(0)
  const say = useCallback((t: string, bad = false) => { setMsg({ t, bad }); setTimeout(() => setMsg((m) => (m?.t === t ? null : m)), 3500) }, [])
  const load = useCallback(() => {
    api.call('GET', '/v1/admin/roles').then((r) => {
      if (!r.data?.ok) { say(r.data?.error || 'Liste alınamadı.', true); return }
      setRoles(r.data.roles); setPerms(r.data.permissions); setHolders(r.data.holders); setRoleDefs(r.data.roles)
    })
  }, [api, say])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    clearTimeout(timer.current)
    const s = q.trim().replace(/^@/, '')
    if (s.length < 2) { setFound([]); return }
    timer.current = window.setTimeout(() => { api.call('GET', '/v1/admin/roles/search?q=' + encodeURIComponent(s)).then((r) => setFound(r.data?.ok ? r.data.users : [])) }, 220)
    return () => clearTimeout(timer.current)
  }, [q, api])
  const assign = async (name: string, role: string | null) => {
    const r = await api.call('PUT', '/v1/admin/roles', { name, role })
    if (r.data?.ok) { say(role ? `${name}: ${role}` : `${name} rolü kaldırıldı.`); load(); setFound((f) => f.map((x) => (x.name === name ? { ...x, role } : x))) } else say(r.data?.error || 'Kaydedilemedi.', true)
  }
  const done = (r: any, ok: string) => { if (r.data?.ok) { say(ok); load() } else say(r.data?.error || 'Kaydedilemedi.', true) }
  const create = async () => { const r = await api.call('POST', '/v1/admin/roles/defs', { name: nn.trim(), color: nc, perms: [] }); if (r.data?.ok) setNn(''); done(r, 'Rol oluşturuldu.') }
  const setColor = async (d: RoleDef, color: string) => done(await api.call('PUT', '/v1/admin/roles/defs/' + encodeURIComponent(d.name), { color }), 'Renk kaydedildi.')
  const togglePerm = async (d: RoleDef, p: string) => {
    const next = d.perms.includes(p) ? d.perms.filter((x) => x !== p) : [...d.perms, p]
    setRoles((rs) => rs.map((x) => (x.name === d.name ? { ...x, perms: next } : x)))
    done(d.builtin ? await api.call('PUT', '/v1/admin/roles/perms/' + encodeURIComponent(d.name), { perms: next }) : await api.call('PUT', '/v1/admin/roles/defs/' + encodeURIComponent(d.name), { perms: next }), 'İzinler kaydedildi.')
  }
  const del = async (d: RoleDef) => { if (window.confirm(`"${d.name}" rolü silinsin mi? Sahip olanlardan alınır.`)) done(await api.call('DELETE', '/v1/admin/roles/defs/' + encodeURIComponent(d.name)), 'Rol silindi.') }
  const select = (value: string, onChange: (v: string) => void, label: string) => (
    <select className="vta-sel" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">Rol yok</option>{roles.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
    </select>
  )
  return (
    <div className="vta-sec">
      <div className="vta-sechead"><div><h2>Roller</h2><p>Oyuncu adının yanındaki VT rozeti rolün rengini alır (rolü olmayanlarda beyaz): oyunda, launcher ve mobil uygulamada.</p></div></div>
      {msg && <div className={'vta-msg' + (msg.bad ? ' bad' : '')} role="status">{msg.t}</div>}
      <div className="vta-tabs"><button className={tab === 'users' ? 'on' : ''} onClick={() => setTab('users')}>Oyuncular</button><button className={tab === 'roles' ? 'on' : ''} onClick={() => setTab('roles')}>Roller ve izinler</button></div>
      {tab === 'users' && (
        <>
          <div className="vta-card">
            <label className="vta-find"><Search size={15} /><input value={q} maxLength={16} autoCapitalize="none" autoCorrect="off" placeholder="Oyuncu ara (en az 2 harf)" onChange={(e) => setQ(e.target.value)} /></label>
            <div className="vta-rolelist">
              {found.map((u) => (
                <div key={u.name} className="vta-rolerow"><Head name={u.name} size={30} /><b>{u.name}</b>{u.role && <Pill role={u.role} />}{select(u.role || '', (v) => assign(u.name, v || null), `${u.name} rolü`)}</div>
              ))}
              {q.trim().length >= 2 && !found.length && <p className="vta-empty">Oyuncu bulunamadı.</p>}
            </div>
          </div>
          <h3 className="vta-h3">Rolü olanlar</h3>
          {holders === null && <p className="vta-empty">Yükleniyor…</p>}
          {holders && !holders.length && <p className="vta-empty">Henüz kimsede rol yok.</p>}
          <div className="vta-rolelist">
            {(holders || []).map((h) => (
              <div key={h.name} className="vta-rolerow">
                <Head name={h.name} size={30} /><b style={{ color: roleColor(h.role) }}>{h.name}</b><Pill role={h.role} />
                {h.fixed ? <span className="vta-dim">ADMIN_USERS ile sabit</span> : <button className="vta-btn danger" onClick={() => assign(h.name, null)}><X size={13} /> Kaldır</button>}
              </div>
            ))}
          </div>
        </>
      )}
      {tab === 'roles' && (
        <>
          <div className="vta-card">
            <div className="vta-add">
              <input value={nn} maxLength={20} placeholder="Yeni rol adı (örn. Moderatör)" onChange={(e) => setNn(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && nn.trim() && create()} />
              <input type="color" className="vta-color" value={nc} onChange={(e) => setNc(e.target.value)} aria-label="Rol rengi" />
              <button className="btn-primary vta-addbtn" onClick={create} disabled={!nn.trim()}><Plus size={15} /> Oluştur</button>
            </div>
          </div>
          {roles.map((d) => (
            <div key={d.name} className="vta-card vta-roledef">
              <div className="vta-line">
                <Pill role={d.name} />
                {!d.builtin && <input type="color" className="vta-color" value={d.color} onChange={(e) => setColor(d, e.target.value)} aria-label={`${d.name} rengi`} />}
                <span className="vta-dim">{d.locked ? 'Tüm izinler (sabit)' : d.builtin ? 'Yerleşik rol' : 'Özel rol'}</span>
                {!d.builtin && <button className="vta-btn danger" style={{ marginLeft: 'auto' }} onClick={() => del(d)}><Trash2 size={13} /> Sil</button>}
              </div>
              <div className="vta-perms">
                {perms.map((p) => (
                  <label key={p.id} className="vta-sw"><input type="checkbox" disabled={d.locked} checked={d.locked || d.perms.includes(p.id)} onChange={() => togglePerm(d, p.id)} />{p.label}</label>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

registerAdminSection({ id: 'roles', label: 'Roller', order: 35, Component: Roles })
