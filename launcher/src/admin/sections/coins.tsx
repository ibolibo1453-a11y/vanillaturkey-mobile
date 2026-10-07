import React, { useCallback, useEffect, useState } from 'react'
import { registerAdminSection } from '../registry'
import type { PanelApi } from '../types'
import { KIND_LABEL, when } from '../../coins'
import '../../components/coins.css'

// "Ekonomi" (R5-C): coins of a player, cosmetics give / take, price + visibility overrides, timed sales.
const SLOTS = ['hat', 'mask', 'body', 'cape', 'wings', 'pet', 'aura']
interface Info { name: string; balance: number; streak: number; owned: string[]; history: { id: number; delta: number; kind: string; note: string; balance: number; at: number }[] }
interface Ov { id: string; price: number | null; hidden: boolean }
interface Sale { id: number; name: string; percent: number; scope: string; startsAt: number; endsAt: number; running: boolean }

function Economy({ api }: { api: PanelApi; role: string }) {
  const [msg, setMsg] = useState<{ t: string; bad: boolean } | null>(null)
  const say = useCallback((t: string, bad = false) => { setMsg({ t, bad }); setTimeout(() => setMsg((m) => (m?.t === t ? null : m)), 4000) }, [])
  const [ids, setIds] = useState<string[]>([])
  useEffect(() => { api.call('GET', '/v1/coins/prices').then((r) => { if (r.data?.ok) setIds(Object.keys(r.data.prices).sort()) }) }, [api])

  // --- player ---
  const [name, setName] = useState('')
  const [info, setInfo] = useState<Info | null>(null)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [cid, setCid] = useState('')
  const lookup = useCallback(async (n = name) => {
    const t = n.trim().replace(/^@/, ''); if (!t) return
    const r = await api.call('GET', '/v1/admin/coins?name=' + encodeURIComponent(t))
    if (r.data?.ok) setInfo(r.data as Info); else { setInfo(null); say(r.data?.error || 'Bulunamadı.', true) }
  }, [api, name, say])
  const grant = async (sign: 1 | -1) => {
    const n = Number(amount)
    if (!info || !Number.isInteger(n) || n <= 0) return say('Pozitif bir miktar yaz.', true)
    const r = await api.call('POST', '/v1/admin/coins/grant', { name: info.name, amount: sign * n, reason })
    if (r.data?.ok) { say(`${info.name}: ${r.data.applied > 0 ? '+' : ''}${r.data.applied} coin (bakiye ${r.data.balance}).`); setAmount(''); setReason(''); lookup(info.name) } else say(r.data?.error || 'Başarısız.', true)
  }
  const cos = async (action: 'give' | 'take') => {
    if (!info) return
    const r = await api.call('POST', '/v1/admin/economy/cosmetic', { name: info.name, id: cid.trim(), action, reason })
    if (r.data?.ok) { say(action === 'give' ? (r.data.changed ? 'Kozmetik verildi.' : 'Zaten sahip.') : (r.data.changed ? 'Kozmetik alındı' + (r.data.unequipped ? ' (giyiliyse çıkarıldı).' : '.') : 'Oyuncuda yoktu.')); lookup(info.name) } else say(r.data?.error || 'Başarısız.', true)
  }

  // --- shop economy ---
  const [ovs, setOvs] = useState<Ov[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const load = useCallback(async () => { const r = await api.call('GET', '/v1/admin/economy'); if (r.data?.ok) { setOvs(r.data.overrides); setSales(r.data.sales) } }, [api])
  useEffect(() => { load() }, [load])
  const [pid, setPid] = useState(''); const [price, setPrice] = useState(''); const [hidden, setHidden] = useState(false)
  const savePrice = async (id = pid, p = price, h = hidden) => {
    const r = await api.call('PUT', '/v1/admin/economy/price', { id: id.trim(), price: p === '' ? null : Number(p), hidden: h })
    if (r.data?.ok) { say(`${id}: ${r.data.price} coin${r.data.hidden ? ' · mağazada gizli' : ''}`); load() } else say(r.data?.error || 'Kaydedilemedi.', true)
  }
  const [sname, setSname] = useState(''); const [pct, setPct] = useState('20'); const [scope, setScope] = useState('all'); const [item, setItem] = useState(''); const [hours, setHours] = useState('48')
  const addSale = async () => {
    const sc = scope === 'item' ? 'item:' + item.trim() : scope
    const r = await api.call('POST', '/v1/admin/economy/sale', { name: sname, percent: Number(pct), scope: sc, endsAt: Date.now() + Number(hours) * 3600_000 })
    if (r.data?.ok) { say('İndirim başladı.'); setSname(''); load() } else say(r.data?.error || 'Eklenemedi.', true)
  }
  const delSale = async (id: number) => { const r = await api.call('DELETE', '/v1/admin/economy/sale/' + id); if (r.data?.ok) load(); else say(r.data?.error || 'Silinemedi.', true) }

  return (
    <div className="vta-sec">
      <div className="vta-sechead"><div><h2>Ekonomi</h2><p>Coin ver / al, kozmetik ver / al, fiyat ve görünürlük, zamanlı indirimler. Her işlem kayda geçer.</p></div></div>
      {msg && <div className={'vta-msg' + (msg.bad ? ' bad' : '')} role="status">{msg.t}</div>}
      <datalist id="vta-cosmetic-ids">{ids.map((i) => <option key={i} value={i} />)}</datalist>

      <div className="vta-card vta-form">
        <b>Oyuncu</b>
        <div className="vta-add"><input value={name} maxLength={16} autoCapitalize="none" autoCorrect="off" placeholder="Kullanıcı adı" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && lookup()} /><button className="btn-primary vta-addbtn" onClick={() => lookup()} disabled={!name.trim()}>Ara</button></div>
        {info && (
          <>
            <p className="vta-dim"><b style={{ color: '#fff' }}>{info.name}</b> · {info.balance} coin · {info.streak} gün seri · {info.owned.length} kozmetik</p>
            <div className="vta-2">
              <label>Miktar<input type="number" min={1} max={100000} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="örn. 100" /></label>
              <label>Sebep (zorunlu)<input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="örn. etkinlik ödülü" /></label>
            </div>
            <div className="vta-line"><button className="vta-btn" onClick={() => grant(1)}>Coin ver</button><button className="vta-btn danger" onClick={() => grant(-1)}>Coin al</button></div>
            <label>Kozmetik kimliği<input list="vta-cosmetic-ids" value={cid} onChange={(e) => setCid(e.target.value)} placeholder="örn. cape_galaxy" /></label>
            <div className="vta-line"><button className="vta-btn" onClick={() => cos('give')} disabled={!cid.trim()}>Kozmetik ver</button><button className="vta-btn danger" onClick={() => cos('take')} disabled={!cid.trim()}>Kozmetik al</button><span className="vta-dim">Aynı sebep kutusu kullanılır.</span></div>
            <ul className="coin-hist">{info.history.map((h) => <li key={h.id}><span>{KIND_LABEL[h.kind] || h.kind}{h.note ? ` · ${h.note}` : ''}</span><b className={h.delta >= 0 ? 'pos' : 'neg'}>{h.delta > 0 ? '+' : ''}{h.delta}</b><small>{when(h.at)} · bakiye {h.balance}</small></li>)}</ul>
          </>
        )}
      </div>

      <div className="vta-card vta-form">
        <b>Fiyat ve görünürlük</b>
        <div className="vta-2">
          <label>Kozmetik<input list="vta-cosmetic-ids" value={pid} onChange={(e) => setPid(e.target.value)} placeholder="örn. cape_galaxy" /></label>
          <label>Yeni fiyat (boş = katalog)<input type="number" min={0} max={100000} value={price} onChange={(e) => setPrice(e.target.value)} /></label>
        </div>
        <label className="vta-sw"><input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> Mağazada gizle (satın alınamaz; sahipleri kullanmaya devam eder)</label>
        <div className="vta-line"><button className="vta-btn" onClick={() => savePrice()} disabled={!pid.trim()}>Kaydet</button></div>
        <div className="vta-chips">
          {ovs.map((o) => (
            <span key={o.id} className="vta-chip" title="Sıfırla">{o.id}: {o.price ?? 'katalog'}{o.hidden ? ' · gizli' : ''}<button onClick={() => savePrice(o.id, '', false)} aria-label={o.id + ' sıfırla'}>✕</button></span>
          ))}
          {!ovs.length && <span className="vta-dim">Fiyat değişikliği yok.</span>}
        </div>
      </div>

      <div className="vta-card vta-form">
        <b>İndirimler</b>
        <div className="vta-2">
          <label>Ad<input value={sname} maxLength={60} onChange={(e) => setSname(e.target.value)} placeholder="örn. Hafta sonu indirimi" /></label>
          <label>Yüzde (1-90)<input type="number" min={1} max={90} value={pct} onChange={(e) => setPct(e.target.value)} /></label>
        </div>
        <div className="vta-2">
          <label>Kapsam<select className="vta-sel" value={scope} onChange={(e) => setScope(e.target.value)}><option value="all">Tüm mağaza</option>{SLOTS.map((s) => <option key={s} value={'slot:' + s}>{s}</option>)}<option value="item">Tek kozmetik</option></select></label>
          <label>Süre (saat)<input type="number" min={1} max={720} value={hours} onChange={(e) => setHours(e.target.value)} /></label>
        </div>
        {scope === 'item' && <label>Kozmetik<input list="vta-cosmetic-ids" value={item} onChange={(e) => setItem(e.target.value)} /></label>}
        <div className="vta-line"><button className="vta-btn" onClick={addSale} disabled={!sname.trim()}>İndirimi başlat</button></div>
        {sales.map((s) => (
          <div key={s.id} className="vta-line"><span>{s.name} · %{s.percent} · {s.scope} · {s.running ? 'sürüyor' : s.startsAt > Date.now() ? 'bekliyor' : 'bitti'} · bitiş {when(s.endsAt)}</span><button className="vta-btn danger" onClick={() => delSale(s.id)}>Sil</button></div>
        ))}
        {!sales.length && <span className="vta-dim">İndirim yok.</span>}
      </div>
    </div>
  )
}

registerAdminSection({ id: 'coins', label: 'Ekonomi', order: 45, Component: Economy })
