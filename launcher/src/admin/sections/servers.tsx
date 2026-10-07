import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Copy, ImagePlus, KeyRound, Plus, Trash2 } from 'lucide-react'
import { registerAdminSection } from '../registry'
import type { PanelApi } from '../types'
import { SponsorCard } from '../../sponsor/Sponsor'

interface Srv { id: string; name: string; label: string; image: string; description: string; ip: string; version: string; enabled: boolean; order: number; tag: string; blurb: string; token: string; whitelistCount: number }

function ServerEditor({ s, api, reload, say, move, first, last }: { s: Srv; api: PanelApi; reload: () => void; say: (m: string, bad?: boolean) => void; move: (d: -1 | 1) => void; first: boolean; last: boolean }) {
  const [f, setF] = useState({ name: s.name, label: s.label, tag: s.tag, blurb: s.blurb, ip: s.ip, version: s.version, description: s.description, enabled: s.enabled })
  const [img, setImg] = useState(s.image)
  const [tok, setTok] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const dirty = f.tag !== s.tag || f.blurb !== s.blurb || f.name !== s.name || f.label !== s.label || f.ip !== s.ip || f.version !== s.version || f.description !== s.description || f.enabled !== s.enabled
  const set = (k: keyof typeof f, v: any) => setF((x) => ({ ...x, [k]: v }))
  const save = async () => {
    const r = await api.call('PUT', '/v1/admin/servers/' + s.id, f)
    if (r.data?.ok) { say('Kaydedildi.'); reload() } else say(r.data?.error || 'Kaydedilemedi.', true)
  }
  const upload = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 5 * 1048576) return say('Görsel en fazla 5 MB olabilir.', true)
    const r = await api.upload(`/v1/admin/servers/${s.id}/image`, file)
    if (r.data?.ok) { setImg(r.data.image); say('Görsel yüklendi.') } else say(r.data?.error || 'Görsel yüklenemedi.', true)
  }
  const rotate = async () => {
    if (!confirm('Sunucu anahtarı yenilensin mi? Plugin config’indeki eski anahtar çalışmaz olur.')) return
    const r = await api.call('POST', `/v1/admin/servers/${s.id}/token`)
    if (r.data?.ok) { say('Yeni anahtar oluşturuldu.'); reload() } else say(r.data?.error || 'Başarısız.', true)
  }
  const del = async () => {
    if (!confirm(`${s.name} silinsin mi? Beyaz listesi de silinir.`)) return
    const r = await api.call('DELETE', '/v1/admin/servers/' + s.id)
    if (r.data?.ok) { say('Silindi.'); reload() } else say(r.data?.error || 'Silinemedi.', true)
  }
  return (
    <div className="vta-card">
      <div className="vta-srv">
        <button className="vta-img" onClick={() => file.current?.click()} title="Görseli değiştir">
          {img ? <img src={img} alt="" /> : <span><ImagePlus size={22} /></span>}
          <em><ImagePlus size={14} /> Görsel yükle</em>
        </button>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} />
        <div className="vta-form">
          <div className="vta-preview"><span className="vta-dim">Canlı önizleme (ana ekrandaki kart)</span>
            <div className="vta-pv"><SponsorCard server={{ id: s.id, name: f.name, label: f.label, tag: f.tag, blurb: f.blurb, image: img, description: f.description, ip: f.ip, version: f.version, enabled: f.enabled, order: s.order, status: null }} onOpen={() => {}} /></div>
          </div>
          <div className="vta-2">
            <label>Sunucu adı<input value={f.name} maxLength={40} onChange={(e) => set('name', e.target.value)} /></label>
            <label>Kart etiketi<input value={f.label} maxLength={40} placeholder="Youtuber SMP" onChange={(e) => set('label', e.target.value)} /></label>
          </div>
          <div className="vta-2">
            <label>IP adresi<input value={f.ip} maxLength={100} placeholder="oyna.ornek.com:25565 (boş = kapalı)" onChange={(e) => set('ip', e.target.value)} /></label>
            <label>Sürüm<input value={f.version} maxLength={24} placeholder="1.21.x" onChange={(e) => set('version', e.target.value)} /></label>
          </div>
          <div className="vta-2">
            <label>Etiket (SPONSOR)<input value={f.tag} maxLength={20} placeholder="SPONSOR" onChange={(e) => set('tag', e.target.value)} /></label>
            <label>Adın altındaki yazı<input value={f.blurb} maxLength={80} placeholder="Yeni sezon başladı" onChange={(e) => set('blurb', e.target.value)} /></label>
          </div>
          <label>Açıklama (kart açılınca)<textarea value={f.description} rows={3} maxLength={600} onChange={(e) => set('description', e.target.value)} /></label>
          <div className="vta-line">
            <label className="vta-sw"><input type="checkbox" checked={f.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Kartta göster (aktif)</label>
            <span className="vta-dim">Beyaz liste: {s.whitelistCount} oyuncu</span>
          </div>
          <div className="vta-line tok">
            <span className="vta-dim">Plugin anahtarı</span>
            <code>{tok ? s.token : '••••••••••••••••••••••••'}</code>
            <button className="vta-btn" onClick={() => setTok(!tok)}>{tok ? 'Gizle' : 'Göster'}</button>
            <button className="vta-btn" onClick={() => navigator.clipboard?.writeText(s.token).then(() => say('Anahtar kopyalandı.'))}><Copy size={13} /> Kopyala</button>
            <button className="vta-btn" onClick={rotate}><KeyRound size={13} /> Yenile</button>
          </div>
          <div className="vta-line end">
            <span className="vta-dim">Sunucu kimliği: <b>{s.id}</b></span>
            <button className="vta-btn" disabled={first} onClick={() => move(-1)} title="Yukarı"><ArrowUp size={14} /></button>
            <button className="vta-btn" disabled={last} onClick={() => move(1)} title="Aşağı"><ArrowDown size={14} /></button>
            <button className="vta-btn danger" onClick={del}><Trash2 size={14} /> Sil</button>
            <button className="btn-primary vta-save" disabled={!dirty} onClick={save}>Kaydet</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Servers({ api }: { api: PanelApi; role: string }) {
  const [list, setList] = useState<Srv[] | null>(null)
  const [msg, setMsg] = useState<{ t: string; bad: boolean } | null>(null)
  const [nn, setNn] = useState('')
  const say = useCallback((t: string, bad = false) => { setMsg({ t, bad }); setTimeout(() => setMsg((m) => (m?.t === t ? null : m)), 4000) }, [])
  const load = useCallback(() => { api.call('GET', '/v1/admin/servers').then((r) => { if (r.data?.ok) setList(r.data.servers); else say(r.data?.error || 'Liste alınamadı.', true) }) }, [api, say])
  useEffect(load, [load])
  const add = async () => {
    const name = nn.trim(); if (!name) return
    const r = await api.call('POST', '/v1/admin/servers', { name })
    if (r.data?.ok) { setNn(''); say('Sunucu eklendi.'); load() } else say(r.data?.error || 'Eklenemedi.', true)
  }
  const move = async (i: number, d: -1 | 1) => {
    if (!list) return
    const a = [...list]; const j = i + d
    if (j < 0 || j >= a.length) return
    ;[a[i], a[j]] = [a[j], a[i]]
    setList(a)
    const r = await api.call('PUT', '/v1/admin/servers-order', { ids: a.map((x) => x.id) })
    if (r.data?.ok) say('Sıra kaydedildi.'); else say(r.data?.error || 'Sıra kaydedilemedi.', true)
  }
  return (
    <div className="vta-sec">
      <div className="vta-sechead"><div><h2>Sunucular</h2><p>Ana ekrandaki sponsor kartı ve Minecraft sunucusundaki vtgate eklentisi bu bilgileri kullanır.</p></div></div>
      {msg && <div className={'vta-msg' + (msg.bad ? ' bad' : '')} role="status">{msg.t}</div>}
      {!list && <p className="vta-empty">Yükleniyor…</p>}
      {list?.map((s, i) => <ServerEditor key={s.id + ':' + s.token + ':' + i} s={s} api={api} reload={load} say={say} move={(d) => move(i, d)} first={i === 0} last={i === list.length - 1} />)}
      <div className="vta-add">
        <input value={nn} maxLength={40} placeholder="Yeni sunucu adı" onChange={(e) => setNn(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn-glass vta-addbtn" onClick={add} disabled={!nn.trim()}><Plus size={15} /> Sunucu ekle</button>
      </div>
    </div>
  )
}

registerAdminSection({ id: 'servers', label: 'Sunucular', order: 10, Component: Servers })
