import React, { useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { registerAdminSection } from '../registry'
import type { PanelApi } from '../types'

interface Cape { id: string; owner: string; frames: number; fps: number; createdAt: number; status: string; url: string }

/** Animated custom capes (R5-E): staff can remove inappropriate ones. Thumbnail = first sheet frame (CSS background-size). */
function Capes({ api }: { api: PanelApi; role: string }) {
  const [list, setList] = useState<Cape[] | null>(null)
  const [ask, setAsk] = useState('')      // id awaiting a reason
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState<{ t: string; bad: boolean } | null>(null)
  const say = useCallback((t: string, bad = false) => { setMsg({ t, bad }); setTimeout(() => setMsg((m) => (m?.t === t ? null : m)), 3500) }, [])
  const load = useCallback(() => { api.call('GET', '/v1/admin/custom-capes?status=active&limit=100').then((r) => { if (r.data?.ok) setList(r.data.capes); else say(r.data?.error || 'Liste alınamadı.', true) }) }, [api, say])
  useEffect(() => { load() }, [load])
  const remove = async (c: Cape) => {
    const r = await api.call('DELETE', `/v1/admin/custom-capes/${c.id}`, { reason: reason.trim() || 'Yönetici kararı' })
    if (r.data?.ok) { setAsk(''); setReason(''); say(`${c.owner} adlı oyuncunun pelerini kaldırıldı.`); load() } else say(r.data?.error || 'Kaldırılamadı.', true)
  }
  return (
    <div className="vta-sec">
      <div className="vta-sechead"><div><h2>Özel pelerinler</h2><p>Oyuncuların yüklediği animasyonlu pelerinler. Uygunsuz olanı kaldır; oyuncudan da çıkarılır.</p></div></div>
      {msg && <div className={'vta-msg' + (msg.bad ? ' bad' : '')} role="status">{msg.t}</div>}
      {list === null && <p className="vta-empty">Yükleniyor…</p>}
      {list && !list.length && <p className="vta-empty">Yüklenmiş özel pelerin yok.</p>}
      <div className="vta-capes">
        {(list || []).map((c) => (
          <div key={c.id} className="vta-cape">
            <div className="vta-cape-th" style={{ backgroundImage: `url(${c.url})`, backgroundSize: '100% auto' }} aria-hidden />
            <div className="vta-cape-meta">
              <b>{c.owner}</b>
              <span className="vta-dim">{c.frames} kare · {c.fps} fps · {new Date(c.createdAt).toLocaleString('tr-TR')}</span>
              {ask === c.id ? (
                <div className="vta-add">
                  <input autoFocus value={reason} maxLength={120} placeholder="Neden? (isteğe bağlı)" onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && remove(c)} />
                  <button className="btn-primary vta-addbtn" onClick={() => remove(c)}>Onayla</button>
                  <button className="btn-outline vta-addbtn" onClick={() => { setAsk(''); setReason('') }}>Vazgeç</button>
                </div>
              ) : <button className="btn-outline vta-cape-rm" onClick={() => { setAsk(c.id); setReason('') }}><Trash2 size={14} /> Kaldır</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

registerAdminSection({ id: 'capes', label: 'Özel pelerinler', order: 60, Component: Capes })
