import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { claimDaily, dailyText, HistoryRow, KIND_LABEL, loadHistory, refreshCoins, refreshShop, resetCoins, useCoins, when } from '../coins'
import { getSocial } from '../social/react'
import './coins.css'

export function CoinIcon({ size = 18 }: { size?: number }) {
  return (
    <svg className="coin-ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <defs><linearGradient id="vtcoin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFE58A" /><stop offset="1" stopColor="#F2A31B" /></linearGradient></defs>
      <circle cx="12" cy="12" r="10" fill="url(#vtcoin)" stroke="#B26E00" strokeWidth="1.2" />
      <circle cx="12" cy="12" r="6.6" fill="none" stroke="#B26E00" strokeOpacity=".55" strokeWidth="1.1" />
      <path d="M8.6 8.6h6.8M12 8.6v7.2" stroke="#8A4F00" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  )
}

/** balance pill (launcher top bar, PWA header, cosmetics screen); bumps when the balance changes */
export function CoinPill({ onClick, className = '' }: { onClick?: () => void; className?: string }) {
  const { me } = useCoins()
  const prev = useRef<number | null>(null)
  const [bump, setBump] = useState(false)
  const bal = me?.balance ?? null
  useEffect(() => {
    if (bal !== null && prev.current !== null && prev.current !== bal) { setBump(true); const t = setTimeout(() => setBump(false), 650); prev.current = bal; return () => clearTimeout(t) }
    prev.current = bal
  }, [bal])
  return (
    <button className={'coin-pill pill ' + (bump ? 'bump ' : '') + className} onClick={onClick} title="Coin bakiyen" aria-label={`Coin bakiyesi: ${bal ?? 0}`}>
      <CoinIcon size={22} /><b>{bal === null ? '–' : bal.toLocaleString('tr-TR')}</b>
    </button>
  )
}

/** First session of the Istanbul day: claim the daily reward, then keep balance + shop in sync (poll + live coins_upd). */
export function useCoinSync(enabled: boolean, key: string, toast: (m: string, k?: 'ok' | 'err') => void) {
  useEffect(() => {
    resetCoins()
    if (!enabled) return
    let alive = true
    ;(async () => {
      const d = await claimDaily()
      if (!alive) return
      if (d?.claimed) toast(dailyText(d))
      await refreshCoins(); await refreshShop()
    })()
    const t = setInterval(() => { refreshCoins(); refreshShop() }, 60000)
    let off: (() => void) | undefined
    const hook = setInterval(() => {   // the social client may start after this effect
      const c = getSocial()
      if (!c || off) return
      clearInterval(hook)
      off = c.on((e: any) => {
        if (e.t !== 'live' || e.frame?.t !== 'coins_upd') return
        const f = e.frame
        refreshCoins()
        if (f.reason === 'admin') toast(`${f.delta > 0 ? '+' : ''}${f.delta} coin (yönetici)`)
        else if (f.reason === 'play') toast(`+${f.delta} coin · oynama süresi`)
        else if (String(f.reason).startsWith('task:')) toast(`+${f.delta} coin · görev tamamlandı`)
      })
    }, 1500)
    return () => { alive = false; clearInterval(t); clearInterval(hook); off?.() }
  }, [enabled, key])
}

export function Modal({ title, onClose, children }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }; window.addEventListener('keydown', h, true); return () => window.removeEventListener('keydown', h, true) }, [onClose])
  // portal to <body>: an ancestor with backdrop-filter / transform (PWA side pane, launcher cards) would otherwise become the containing block of position:fixed
  return createPortal(
    <div className="coin-modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="coin-modal" role="dialog" aria-modal="true">
        <h3>{title}<button onClick={onClose} aria-label="Kapat">✕</button></h3>
        {children}
      </div>
    </div>,
    document.body
  )
}

export function HistoryModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null)
  const [more, setMore] = useState(true)
  useEffect(() => { loadHistory().then((r) => { setRows(r); setMore(r.length >= 50) }) }, [])
  const next = async () => { const last = rows?.[rows.length - 1]; if (!last) return; const r = await loadHistory(last.id); setRows([...(rows || []), ...r]); setMore(r.length >= 50) }
  return (
    <Modal title={<><CoinIcon size={20} /> Coin geçmişi</>} onClose={onClose}>
      <ul className="coin-hist">
        {rows === null && <li><span>Yükleniyor…</span></li>}
        {rows && !rows.length && <li><span>Henüz hareket yok. Her gün gir, oyna, coin kazan.</span></li>}
        {rows?.map((h) => (
          <li key={h.id}><span>{KIND_LABEL[h.kind] || h.kind}{h.note ? ` · ${h.note}` : ''}</span><b className={h.delta >= 0 ? 'pos' : 'neg'}>{h.delta > 0 ? '+' : ''}{h.delta}</b><small>{when(h.at)} · bakiye {h.balance}</small></li>
        ))}
      </ul>
      {rows && more && rows.length > 0 && <div className="btns"><button className="btn-glass sm" onClick={next}>Daha eski</button></div>}
    </Modal>
  )
}

/** coin balance row + streak + daily / play progress; shared by the launcher home card and the PWA profile */
export function CoinSummary() {
  const { me } = useCoins()
  const [hist, setHist] = useState(false)
  const play = me ? Math.min(1, me.todayPlayCoins / Math.max(1, me.playCapCoins)) : 0
  const mins = me ? Math.ceil(me.playSecondsToNext / 60) : 0
  return (
    <>
      <div className="coin-top">
        <div className="coin-big"><CoinIcon size={34} /><div><h2>{me ? me.balance.toLocaleString('tr-TR') : '–'}</h2><span>coin</span></div></div>
        <span className="streak" style={{ marginLeft: 'auto' }}><i />{me && me.streak > 0 ? `${me.streak} gün seri` : 'Seri yok'}</span>
      </div>
      <div className={'coin-daily' + (me?.claimedToday ? ' done' : '')}>
        <span>{me?.claimedToday ? 'Bugünkü ödül alındı' : 'Günlük ödül'}</span>
        <b>{me?.claimedToday ? `Yarın +${me.nextReward}${me.nextBonus ? ` (+${me.nextBonus} bonus)` : ''}` : me ? `+${me.nextReward} coin` : ''}</b>
      </div>
      <div className="coin-play">
        <div className="row"><span>Bugün oynayarak</span><span>{me?.todayPlayCoins ?? 0} / {me?.playCapCoins ?? 20} coin</span></div>
        <div className="bar"><i style={{ width: Math.max(2, play * 100) + '%' }} /></div>
        <div className="row"><span>{me && me.todayPlayCoins < me.playCapCoins ? `Sonraki +2 coin: ~${mins} dk aktif oyun` : 'Günlük sınıra ulaştın'}</span><button className="coin-link" onClick={() => setHist(true)}>Geçmiş</button></div>
      </div>
      {hist && <HistoryModal onClose={() => setHist(false)} />}
    </>
  )
}
