import React, { useCallback, useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Head } from '../../social/react'
import { registerAdminSection } from '../registry'
import type { PanelApi } from '../types'

interface Entry { name: string; addedBy: string; addedAt: number }

function Whitelist({ api }: { api: PanelApi; role: string }) {
  const [servers, setServers] = useState<{ id: string; name: string }[]>([])
  const [sid, setSid] = useState('')
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [name, setName] = useState('')
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState<{ t: string; bad: boolean } | null>(null)
  const say = useCallback((t: string, bad = false) => { setMsg({ t, bad }); setTimeout(() => setMsg((m) => (m?.t === t ? null : m)), 3500) }, [])
  useEffect(() => { api.call('GET', '/v1/admin/whitelist/servers').then((r) => { if (r.data?.ok) { setServers(r.data.servers); setSid((x) => x || r.data.servers[0]?.id || '') } }) }, [api])
  const load = useCallback(() => { if (!sid) return; api.call('GET', `/v1/admin/servers/${sid}/whitelist`).then((r) => { if (r.data?.ok) setEntries(r.data.entries); else say(r.data?.error || 'Liste alınamadı.', true) }) }, [api, sid, say])
  useEffect(() => { setEntries(null); load() }, [load])
  const add = async () => {
    const n = name.trim().replace(/^@/, ''); if (!n) return
    const r = await api.call('POST', `/v1/admin/servers/${sid}/whitelist`, { name: n })
    if (r.data?.ok) { setName(''); load() } else say(r.data?.error || 'Eklenemedi.', true)
  }
  const del = async (n: string) => {
    const r = await api.call('DELETE', `/v1/admin/servers/${sid}/whitelist/${encodeURIComponent(n)}`)
    if (r.data?.ok) load(); else say(r.data?.error || 'Silinemedi.', true)
  }
  const shown = (entries || []).filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="vta-sec">
      <div className="vta-sechead">
        <div><h2>Beyaz Liste</h2><p>Listedeki oyuncular normal oynar; diğerleri sunucuda izleyici modunda kalır.</p></div>
        {servers.length > 1 && <select className="vta-sel" value={sid} onChange={(e) => setSid(e.target.value)}>{servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
      </div>
      {msg && <div className={'vta-msg' + (msg.bad ? ' bad' : '')} role="status">{msg.t}</div>}
      {!servers.length ? <p className="vta-empty">Önce bir sunucu ekle.</p> : (
        <>
          <div className="vta-add">
            <input value={name} maxLength={20} autoCapitalize="none" autoCorrect="off" placeholder="Minecraft kullanıcı adı" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
            <button className="btn-primary vta-addbtn" onClick={add} disabled={!name.trim()}><Plus size={15} /> Ekle</button>
          </div>
          {(entries?.length || 0) > 8 && <input className="vta-search" value={q} placeholder="Listede ara" onChange={(e) => setQ(e.target.value)} />}
          <div className="vta-chips">
            {entries === null && <p className="vta-empty">Yükleniyor…</p>}
            {entries && !entries.length && <p className="vta-empty">Liste boş. Eklenmeyen herkes izleyici olur.</p>}
            {shown.map((e) => (
              <span key={e.name} className="vta-chip" title={e.addedBy ? `Ekleyen: ${e.addedBy}` : ''}>
                <Head name={e.name} size={22} />
                {e.name}<button onClick={() => del(e.name)} aria-label={`${e.name} kaldır`}><X size={13} /></button>
              </span>
            ))}
          </div>
          <p className="vta-dim">{entries?.length ?? 0} oyuncu</p>
        </>
      )}
    </div>
  )
}

registerAdminSection({ id: 'whitelist', label: 'Beyaz Liste', order: 20, Component: Whitelist })
