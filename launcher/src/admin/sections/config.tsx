import React, { useCallback, useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { registerAdminSection } from '../registry'
import type { PanelApi } from '../types'

interface Cfg { flags: Record<string, boolean>; defaults: Record<string, string | number | boolean>; motd: string; titleText: string; maintenance: { on: boolean; message: string }; minVersion: string }
const EMPTY: Cfg = { flags: {}, defaults: {}, motd: '', titleText: '', maintenance: { on: false, message: '' }, minVersion: '' }
/** Feature ids the clients understand (a flag set to false disables it for everyone; unknown ids are stored but ignored). */
const KNOWN_FLAGS = ['minimap', 'voice', 'chat', 'cosmetics', 'friends', 'sponsor', 'capes.custom']

function Config({ api }: { api: PanelApi; role: string }) {
  const [c, setC] = useState<Cfg | null>(null)
  const [orig, setOrig] = useState('')
  const [flag, setFlag] = useState('')
  const [dk, setDk] = useState('')
  const [dv, setDv] = useState('')
  const [msg, setMsg] = useState<{ t: string; bad: boolean } | null>(null)
  const say = useCallback((t: string, bad = false) => { setMsg({ t, bad }); setTimeout(() => setMsg((m) => (m?.t === t ? null : m)), 4000) }, [])
  const load = useCallback(() => { api.call('GET', '/v1/admin/config').then((r) => { if (r.data?.ok) { const { ok, serverTime, ...cfg } = r.data; const v = { ...EMPTY, ...cfg } as Cfg; setC(v); setOrig(JSON.stringify(v)) } else say(r.data?.error || 'Ayarlar alınamadı.', true) }) }, [api, say])
  useEffect(load, [load])
  if (!c) return <div className="vta-sec"><p className="vta-empty">Yükleniyor…</p></div>
  const set = (p: Partial<Cfg>) => setC({ ...c, ...p })
  const dirty = JSON.stringify(c) !== orig
  const save = async () => {
    const r = await api.call('PUT', '/v1/admin/config', c)
    if (r.data?.ok) { say('Kaydedildi ve çevrimiçi istemcilere gönderildi.'); load() } else say(r.data?.error || 'Kaydedilemedi.', true)
  }
  const flagIds = [...new Set([...KNOWN_FLAGS, ...Object.keys(c.flags)])]
  const parse = (v: string): string | number | boolean => (v === 'true' ? true : v === 'false' ? false : v !== '' && !isNaN(Number(v)) ? Number(v) : v)
  return (
    <div className="vta-sec">
      <div className="vta-sechead"><div><h2>İstemci ayarları</h2><p>Sunucudan yönetilir; launcher, oyun ve PWA canlı uygular.</p></div><button className="btn-primary vta-save" disabled={!dirty} onClick={save}>Kaydet &amp; yayınla</button></div>
      {msg && <div className={'vta-msg' + (msg.bad ? ' bad' : '')} role="status">{msg.t}</div>}

      <div className="vta-card">
        <h3 className="vta-h3">Bakım modu</h3>
        <div className="vta-line"><label className="vta-sw"><input type="checkbox" checked={c.maintenance.on} onChange={(e) => set({ maintenance: { ...c.maintenance, on: e.target.checked } })} /> Bakım modu açık (yetkililer hariç kimse giriş yapamaz)</label></div>
        <label className="vta-form"><label>Bakım mesajı<input value={c.maintenance.message} maxLength={200} onChange={(e) => set({ maintenance: { ...c.maintenance, message: e.target.value } })} /></label></label>
      </div>

      <div className="vta-card">
        <h3 className="vta-h3">Metinler ve sürüm</h3>
        <div className="vta-form">
          <div className="vta-2">
            <label>Ana ekran başlığı<input value={c.titleText} maxLength={80} onChange={(e) => set({ titleText: e.target.value })} /></label>
            <label>En düşük client sürümü<input value={c.minVersion} placeholder="1.5.0 (boş = sınır yok)" maxLength={16} onChange={(e) => set({ minVersion: e.target.value })} /></label>
          </div>
          <label>MOTD (ana ekran mesajı)<input value={c.motd} maxLength={160} onChange={(e) => set({ motd: e.target.value })} /></label>
        </div>
      </div>

      <div className="vta-card">
        <h3 className="vta-h3">Özellik bayrakları</h3>
        <p className="vta-dim">Kapalı bayrak = herkes için devre dışı. Açık / hiç yok = serbest.</p>
        <div className="vta-chips">
          {flagIds.map((f) => (
            <label key={f} className="vta-chip" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={c.flags[f] !== false} onChange={(e) => { const fl = { ...c.flags }; if (e.target.checked) delete fl[f]; else fl[f] = false; set({ flags: fl }) }} /> {f}
            </label>
          ))}
        </div>
        <div className="vta-add"><input value={flag} maxLength={48} placeholder="Yeni bayrak adı (modül kimliği)" onChange={(e) => setFlag(e.target.value.toLowerCase().replace(/[^a-z0-9_.\-]/g, ''))} />
          <button className="btn-glass vta-addbtn" disabled={!flag} onClick={() => { set({ flags: { ...c.flags, [flag]: false } }); setFlag('') }}><Plus size={15} /> Ekle (kapalı)</button></div>
      </div>

      <div className="vta-card">
        <h3 className="vta-h3">Yeni kullanıcı varsayılanları</h3>
        <p className="vta-dim">İlk kez açılan hesaplara uygulanan ayarlar (örn. hud.fps = true).</p>
        <div className="vta-chips">
          {Object.entries(c.defaults).map(([k, v]) => <span key={k} className="vta-chip">{k} = {String(v)}<button onClick={() => { const d = { ...c.defaults }; delete d[k]; set({ defaults: d }) }} aria-label="Kaldır"><X size={13} /></button></span>)}
        </div>
        <div className="vta-add"><input value={dk} maxLength={48} placeholder="ayar adı" onChange={(e) => setDk(e.target.value.toLowerCase().replace(/[^a-z0-9_.\-]/g, ''))} /><input value={dv} maxLength={80} placeholder="değer" onChange={(e) => setDv(e.target.value)} />
          <button className="btn-glass vta-addbtn" disabled={!dk || dv === ''} onClick={() => { set({ defaults: { ...c.defaults, [dk]: parse(dv) } }); setDk(''); setDv('') }}><Plus size={15} /> Ekle</button></div>
      </div>
    </div>
  )
}

registerAdminSection({ id: 'config', label: 'İstemci ayarları', order: 50, Component: Config })
