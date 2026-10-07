import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store'
import { Icon } from '../components/ui'
import { SkinStage, type Loadout } from '../components/SkinStage'
import { CustomCapePanel } from '../components/CustomCapePanel'
import { CoinIcon, CoinPill, HistoryModal, Modal } from '../components/Coins'
import { buyCosmetic, isOwned, priceInfo, refreshCoins, refreshShop, useCoins } from '../coins'
import { SLOTS, Cosmetic, normSlot, GAME_RARITY } from '../data'

/** KOSTÜMLERİM, 1:1 with the in-game screen (cosmetics/.../gui/CosmeticsScreen.java): tabs, search, icon grid with rarity bars,
 *  equipped check, locked reward capes, live 3D preview with the real cosmetic models, footer row. */
const PALETTE = [0xFF5A6E, 0xFF7A6B, 0xFFC24D, 0xFFE066, 0x3DDC84, 0x2EC5F5, 0x1E9BFF, 0x9B6BFF, 0xFF7DB3, 0xFFFFFF]
const hex6 = (n: number) => (n & 0xffffff).toString(16).padStart(6, '0')
const TR = 'tr'
const lc = (s: string) => s.toLocaleLowerCase(TR)

function parseLoadout(data: any, name: string): Loadout | null {
  if (!data || typeof data !== 'object') return null
  const src = data.players && typeof data.players === 'object' ? data.players : data
  const mine = src[name] ?? Object.entries(src).find(([k]) => lc(k) === lc(name))?.[1] ?? (SLOTS.some((s) => s.id in src) ? src : null)
  if (!mine || typeof mine !== 'object') return null
  const out: Loadout = {}
  for (const s of SLOTS) { const v = (mine as any)[s.id]; if (typeof v === 'string' && v) out[s.id] = v }
  return out
}

export function Cosmetics({ onClose }: { onClose?: () => void }) {
  const { settings, setSetting, skin, toast, account } = useApp()
  const coins = useCoins()
  const [hist, setHist] = useState(false)
  const [confirm, setConfirm] = useState<Cosmetic | null>(null)
  const [buying, setBuying] = useState(false)
  const [items, setItems] = useState<Cosmetic[] | null>(null)
  // rarities + slot names/colors come from cosmetics/catalog.json (single source with the game)
  const [rar, setRar] = useState<Record<string, { label: string; color: string }>>(GAME_RARITY)
  const [slots, setSlots] = useState(SLOTS.map((x) => ({ id: x.id, name: x.slotTr, color: x.color })))
  const [tab, setTab] = useState('all')
  const [q, setQ] = useState('')
  const [lockF, setLockF] = useState<'all' | 'owned' | 'shop'>('all')
  const [prev, setPrev] = useState<Cosmetic | null>(null) // not-yet-owned item being previewed (not equipped)
  const [loadout, setLoadout] = useState<Loadout>(() => (Object.keys(settings.equipped || {}).length ? settings.equipped : { cape: 'cape_vt' }))
  const [renk, setRenk] = useState<[number, number]>(() => { try { const r = JSON.parse(localStorage.getItem('vt.renk') || ''); return [r[0], r[1]] } catch { return [0xFF7A6B, 0x9B6BFF] } })
  const [tip, setTip] = useState<{ c: Cosmetic; x: number; y: number } | null>(null)
  const [flash, setFlash] = useState('')
  const [capePrev, setCapePrev] = useState<string | null>(null) // freshly uploaded custom cape, shown in the 3D preview before wearing
  const pushT = useRef<number>(0)
  const gridRef = useRef<HTMLDivElement>(null)
  const [discord, setDiscord] = useState(false)   // R5-B: the Discord cape belongs to linked guild members only (never sold)
  useEffect(() => { window.vt.invoke('api:call', 'GET', '/v1/discord/status', undefined, true).then((r: any) => setDiscord(!!r?.data?.inGuild)).catch(() => {}) }, [account?.username])
  const own = (c: Cosmetic) => (c.special ? discord : isOwned(c.id, c.price, coins))

  // cosmetics changed in the running game arrive through the bridge
  useEffect(() => { const h = (e: Event) => setLoadout({ ...(e as CustomEvent).detail }); window.addEventListener('vt-cosmetics-remote', h); return () => window.removeEventListener('vt-cosmetics-remote', h) }, [])
  useEffect(() => window.vt.on((ch, a) => { if (ch === 'shot:loadout') setLoadout(a); if (ch === 'shot:cosmtab') setTab(a); if (ch === 'shot:cosmq') setQ(a) }), [])
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose?.() }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [onClose])
  useEffect(() => {
    window.vt.invoke('catalog:cosmetics').then((r) => {
      if (r.rarities?.length) setRar(Object.fromEntries((r.rarities as any[]).map((x) => [x.id, { label: x.nameTr, color: x.color }])))
      if (r.slots?.length) setSlots((r.slots as any[]).map((x) => ({ id: x.id, name: x.nameTr, color: x.color })))
      setItems((r.items as any[]).map((i) => ({ ...i, slot: normSlot(i.slot), nameTr: i.nameTr || i.name || i.id, price: i.price ?? 0, special: i.special || undefined })))
    })
  }, [])
  // what the game / server has equipped is the source of truth
  useEffect(() => {
    if (!account || account.offline) return
    window.vt.invoke('api:call', 'GET', '/v1/cosmetics?names=' + encodeURIComponent(account.username)).then((r) => {
      const lo = parseLoadout(r?.data, account.username)
      if (lo && Object.keys(lo).length) { setLoadout(lo); setSetting({ equipped: lo as any }) }
    })
  }, [account?.username])

  const all = items || []
  // worn items the player does not own (e.g. taken away by an admin): the slot just becomes empty
  useEffect(() => {
    if (!items || !coins.me) return
    const bad = Object.entries(loadout).filter(([, id]) => { const c = items.find((i) => i.id === baseOf(id)); return c && !own(c) })
    if (!bad.length) return
    const n = { ...loadout }; for (const [sl] of bad) delete (n as any)[sl]
    setLoadout(n); persist(n, renk)
  }, [items, coins.me, loadout])
  const byId = useMemo(() => Object.fromEntries(all.map((i) => [i.id, i])), [all])
  const baseOf = (id?: string) => (id && id.startsWith('renklerin_') ? 'renklerin' : id)
  const isOn = (c: Cosmetic) => baseOf(loadout[c.slot]) === c.id
  const list = useMemo(() => {
    const k = lc(q.trim())
    const src = all.filter((c) => (tab === 'all' || c.slot === tab) && (lockF === 'all' || (lockF === 'owned') === own(c)) && (own(c) || c.special || !priceInfo(c.id, c.price, coins).hidden) && (!k || lc(c.nameTr).includes(k) || lc(slots.find((s) => s.id === c.slot)?.name || '').includes(k) || lc(rar[c.rarity]?.label || '').includes(k)))
    const eq = src.filter((c) => baseOf(loadout[c.slot]) === c.id)
    return [...eq, ...src.filter((c) => baseOf(loadout[c.slot]) !== c.id)]
  }, [all, tab, q, loadout, lockF, coins])
  const wornCount = Object.values(loadout).filter(Boolean).length

  const persist = useCallback((next: Loadout, rk: [number, number]) => {
    setSetting({ equipped: next as any })
    try { localStorage.setItem('vt.renk', JSON.stringify(rk)) } catch {}
    const body: Record<string, string | null> = {}
    for (const s of SLOTS) body[s.id] = next[s.id] || null
    window.vt.invoke('cosmetics:writeLocal', body, rk)
    if (account) window.vt.invoke('bridge:send', null, { t: 'cosmetics_upd', name: account.username, equipped: body }) // live sync: the running game applies it immediately
    window.clearTimeout(pushT.current) // debounce quick toggling, same as the game (600 ms)
    pushT.current = window.setTimeout(async () => {
      if (!account || account.offline) return
      const r = await window.vt.invoke('api:call', 'PUT', '/v1/cosmetics', body, true)
      if (r.status === 403 && r.data?.error === 'not_owned') { toast('Bu kozmetiğe sahip değilsin; önce satın al.', 'err'); refreshCoins() }
      else if (r.status === 403 && r.data?.error === 'locked') toast(r.data?.special === 'discord' ? 'Discord pelerini için hesabını bağla ve sunucumuza katıl (Ayarlar > Hesap).' : 'Bu kozmetik özel bir koşul gerektiriyor.', 'err')
      else if (r.networkError || (r.status && r.status >= 400)) toast('Kaydedilemedi, yalnızca bu bilgisayarda giyildi.', 'err')
    }, 600)
  }, [account, setSetting, toast])

  const say = (m: string) => { setFlash(m); window.setTimeout(() => setFlash((f) => (f === m ? '' : f)), 1600) }
  function toggle(c: Cosmetic) {
    if (!own(c)) { setPrev(c); say(c.nameTr + (c.special ? ' önizleniyor · Discord üyelerine özel' : ' önizleniyor · satın alabilirsin')); return }
    setPrev(null)
    if (isOn(c)) { const n = { ...loadout }; delete n[c.slot]; setLoadout(n); persist(n, renk); say(c.nameTr + ' çıkarıldı'); return }
    const n = { ...loadout, [c.slot]: c.id === 'renklerin' ? `renklerin_${hex6(renk[0])}_${hex6(renk[1])}` : c.id }
    setLoadout(n); persist(n, renk); say(c.nameTr + ' giyildi')
  }
  function pickColor(row: 0 | 1, col: number) {
    const rk: [number, number] = [...renk] as [number, number]; rk[row] = col; setRenk(rk)
    const n = { ...loadout, cape: `renklerin_${hex6(rk[0])}_${hex6(rk[1])}` }
    setLoadout(n); persist(n, rk)
  }
  const clearAll = () => { setPrev(null); setLoadout({}); persist({}, renk); say('Tümü çıkarıldı') }
  function wearCustom(id: string | null) { const n = { ...loadout }; if (id) n.cape = id; else delete n.cape; setLoadout(n); persist(n, renk); say(id ? 'Özel pelerin giyildi' : 'Özel pelerin çıkarıldı') }
  async function doBuy(c: Cosmetic) {
    setBuying(true)
    const r = await buyCosmetic(c.id)
    setBuying(false); setConfirm(null)
    if (!r.ok) { toast(r.error === 'insufficient' ? `Yeterli coinin yok (${r.balance ?? 0} / ${r.price}).` : r.message || 'Satın alınamadı.', 'err'); refreshShop(); return }
    toast(`${c.nameTr} satın alındı · -${r.price} coin`)
    setPrev(null)
    const n = { ...loadout, [c.slot]: c.id === 'renklerin' ? `renklerin_${hex6(renk[0])}_${hex6(renk[1])}` : c.id }
    setLoadout(n); persist(n, renk); say(c.nameTr + ' giyildi')
  }
  const picker = (loadout.cape || '').startsWith('renklerin_')
  const slotTr = (id: string) => slots.find((s) => s.id === id)?.name || ''
  const TABS = [{ id: 'all', label: 'Tümü', color: '' }, ...slots.map((x) => ({ id: x.id, label: x.name, color: x.color }))]
  const worn = slots.filter((x) => loadout[x.id]).map((x) => ({ x, c: byId[baseOf(loadout[x.id])!] })).filter((w) => w.c)

  return (
    <div className="kos">
      <div className="kos-head">
        <div><h2>Kostümlerim</h2><p>3D önizleme ile karakterini özelleştir{tab !== 'all' ? ' · ' + slotTr(tab) : ''}</p></div>
        <div className="kos-right">
          {(coins.shop?.sales.length ?? 0) > 0 && <span className="kos-sale" title={coins.shop!.sales.map((x) => x.name).join(', ')}><Icon name="sparkles" size={13} /> %{Math.max(...coins.shop!.sales.map((x) => x.percent))} indirim</span>}
          <CoinPill onClick={() => setHist(true)} />
          {onClose && <button className="icon-btn" onClick={onClose} aria-label="Kapat"><Icon name="close" size={15} /></button>}
        </div>
      </div>
      <div className="kos-body">
        <div className="kos-left">
          <div className="kos-tabs">{TABS.map((t) => <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => { setTab(t.id); gridRef.current?.scrollTo(0, 0) }}>{t.color && <i className="dot" style={{ background: t.color }} />}{t.label}</button>)}</div>
          <div className="kos-bar">
            <b>Ürünler</b><span>{list.length} sonuç</span>
            <div className="kos-lockf">{([['all', 'Tümü'], ['owned', 'Sahip olduklarım'], ['shop', 'Mağaza']] as const).map(([id, l]) => <button key={id} className={lockF === id ? 'on' : ''} onClick={() => setLockF(id)}>{id === 'shop' && <CoinIcon size={12} />}{l}</button>)}</div>
            <div className="input"><Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kozmetik ara…" /></div>
          </div>
          {tab === 'cape' && <CustomCapePanel signedIn={!!account && !account.offline} worn={loadout.cape} onPreview={setCapePrev} onWear={wearCustom} toast={toast} />}
          <div className="kos-grid" ref={gridRef} onMouseLeave={() => setTip(null)}>
            {!items && Array.from({ length: 12 }, (_, k) => <div key={k} className="kt skel" />)}
            {list.map((c) => {
              const on = isOn(c), locked = !own(c), pi = priceInfo(c.id, c.price, coins), rc = (rar[c.rarity] || rar.common || GAME_RARITY.common)
              return (
                <button key={c.id} className={'kt' + (on ? ' on' : '') + (locked ? ' locked' : '')} style={{ '--rc': rc.color } as React.CSSProperties}
                  onClick={() => toggle(c)} onMouseMove={(e) => setTip({ c, x: e.clientX, y: e.clientY })} onMouseLeave={() => setTip(null)}>
                  <div className="kt-well">
                    {c.iconData ? <img src={c.iconData} alt="" draggable={false} /> : null}
                    {on && <span className="kt-badge">GİYİLİ</span>}
                    {locked && (c.special ? <span className="kt-price"><Icon name="lock" size={11} />Discord</span> : <span className={'kt-price' + (pi.onSale ? ' sale' : '')}><CoinIcon size={13} />{pi.onSale && <s>{pi.list}</s>}{pi.price}</span>)}
                  </div>
                  <span className="kt-name">{c.nameTr}</span>
                  <span className="kt-rar"><i />{rc.label}</span>
                </button>
              )
            })}
            {items && !list.length && <div className="empty">Sonuç bulunamadı</div>}
          </div>
        </div>
        <div className="kos-prev">
          <div className="kos-chips">{worn.map(({ x, c }) => <span key={x.id}><i style={{ background: x.color }} />{c.nameTr}</span>)}</div>
          <div className="kos-stage">
            <SkinStage skin={skin} slim={!!(settings as any).skinSlim} className="panel" loadout={prev ? { ...loadout, [prev.slot]: prev.id === 'renklerin' ? `renklerin_${hex6(renk[0])}_${hex6(renk[1])}` : prev.id } : capePrev ? { ...loadout, cape: capePrev } : loadout} renk={renk} zoom={0.7} />
            {prev && (() => { const pi = priceInfo(prev.id, prev.price, coins); return prev.special
              ? <div className="kos-prevbar buy"><Icon name="lock" size={13} /> {prev.nameTr} · Discord üyelerine özel<button onClick={() => setPrev(null)}>Kapat</button></div>
              : <div className="kos-prevbar buy"><CoinIcon size={14} /> {prev.nameTr} · {pi.onSale && <s>{pi.list}</s>} {pi.price} coin<button className="buy-btn" onClick={() => setConfirm(prev)}>Satın al</button><button onClick={() => setPrev(null)}>Kapat</button></div> })()}
            {picker && (
              <div className="kos-picker">
                {[0, 1].map((row) => (
                  <div key={row}><span>Renk {row + 1}</span>{PALETTE.map((p) => <button key={p} className={renk[row] === p ? 'on' : ''} style={{ background: '#' + hex6(p) }} onClick={() => pickColor(row as 0 | 1, p)} aria-label={'#' + hex6(p)} />)}</div>
                ))}
              </div>
            )}
            <div className="kos-hint">Sürükleyerek döndür</div>
          </div>
        </div>
      </div>
      <div className="kos-foot">
        <span className="kos-pill">{wornCount} giyili</span>
        <span className="kos-tip">{coins.me ? `${coins.me.balance} coin · ` : ''}Tıkla: giy / çıkar · Tekerlek: kaydır · Esc: kapat</span>
        {flash && <span className="kos-flash">{flash}</span>}
        <button className="kos-clear" onClick={clearAll} disabled={!wornCount}>Tümünü Çıkar</button>
      </div>
      {hist && <HistoryModal onClose={() => setHist(false)} />}
      {confirm && (() => { const pi = priceInfo(confirm.id, confirm.price, coins), bal = coins.me?.balance ?? 0, short = bal < pi.price; return (
        <Modal title={<><CoinIcon size={20} /> Satın alma onayı</>} onClose={() => !buying && setConfirm(null)}>
          <p><b>{confirm.nameTr}</b> kozmetiğini <b>{pi.price} coin</b> karşılığında satın almak istiyor musun? Satın alınan kozmetik kalıcı olarak senindir.</p>
          <p>Bakiyen: <b>{bal}</b> coin{short ? <> · <b style={{ color: '#ff9aa8' }}>{pi.price - bal} coin eksik</b></> : <> · Sonra: <b>{bal - pi.price}</b> coin</>}</p>
          <div className="btns"><button className="btn-glass sm" onClick={() => setConfirm(null)} disabled={buying}>Vazgeç</button><button className="btn-primary sm" onClick={() => doBuy(confirm)} disabled={buying || short}>{buying ? 'Alınıyor…' : 'Satın al'}</button></div>
        </Modal>
      ) })()}
      {tip && (() => {
        const c = tip.c, on = isOn(c), locked = !own(c), pi = priceInfo(c.id, c.price, coins)
        const rr = rar[c.rarity] || GAME_RARITY.common
        const left = Math.min(tip.x + 14, window.innerWidth - 230), top = Math.min(tip.y + 16, window.innerHeight - 90)
        return (
          <div className="kos-tooltip" style={{ left, top, borderColor: rr.color }}>
            <b>{c.nameTr}</b>
            <span style={{ color: rr.color }}>{slotTr(c.slot)} · {rr.label}</span>
            <em className={locked ? 'warn' : on ? 'ok' : ''}>{locked ? (c.special ? 'Discord üyelerine özel · önizlemek için tıkla' : `${pi.price} coin · önizlemek ve satın almak için tıkla`) : on ? 'Giyili · çıkarmak için tıkla' : 'Giymek için tıkla'}</em>
          </div>
        )
      })()}
    </div>
  )
}
