import { VtSymbol } from '../components/Brand'
import React, { useEffect, useRef, useState } from 'react'
import { useApp } from '../store'
import { Icon } from '../components/ui'
import { SkinStage } from '../components/SkinStage'
import { CoinCard, useStats } from '../components/CoinCard'
import { FriendsCard } from '../components/Friends'
import { CoinIcon } from '../components/Coins'
import { isOwned, priceInfo, useCoins } from '../coins'
import { VoiceRoomsCard } from '../components/VoiceCard'
import { SponsorCard, SponsorDrawer, useSponsors, type CallFn } from '../sponsor/Sponsor'
import type { Page } from '../App'

const apiCall: CallFn = (m, p, b) => window.vt.invoke('api:call', m, p, b, true)

export function Home({ go }: { go: (p: Page) => void }) {
  const { gstate, progress, play, playServer, stop, fakeProgress, skin, account, settings, profiles, setProfiles, current } = useApp()
  const { stats, live } = useStats()
  const [pick, setPick] = useState(false)
  const [tick, setTick] = useState(0)
  const pickRef = useRef<HTMLDivElement>(null)
  const servers = useSponsors(apiCall, !account?.offline)
  const [openSp, setOpenSp] = useState('')
  const sp = servers.find((x) => x.id === openSp) || null
  const [icons, setIcons] = useState<Record<string, string>>({})
  const [cprice, setCprice] = useState<Record<string, number>>({ imza: 100, renklerin: 800 })
  const coins = useCoins()
  useEffect(() => { window.vt.invoke('catalog:cosmetics').then((r) => { const it = (r.items as any[]).filter((i) => i.id === 'imza' || i.id === 'renklerin'); setIcons(Object.fromEntries(it.map((i) => [i.id, i.iconData]))); setCprice(Object.fromEntries(it.map((i) => [i.id, i.price ?? 0]))) }) }, [])

  useEffect(() => {
    const off = window.vt.on((ch) => { if (ch === 'shot:fakeprogress') fakeProgress(); if (ch === 'shot:profilemenu') setPick(true) })
    return () => { off() }
  }, [])
  useEffect(() => {
    if (!pick) return
    const h = (e: MouseEvent) => { if (!pickRef.current?.contains(e.target as Node)) setPick(false) }
    window.addEventListener('mousedown', h); return () => window.removeEventListener('mousedown', h)
  }, [pick])
  useEffect(() => { if (gstate === 'playing') setTick((x) => x + 1) }, [gstate])

  const busy = gstate === 'installing' || gstate === 'launching'
  const label = gstate === 'idle' ? 'Oyna' : gstate === 'installing' ? progress.text || 'Hazırlanıyor…' : gstate === 'launching' ? 'Oyun başlatılıyor…' : 'Oyun açık · Kapat'

  const sigOpen = isOwned('imza', cprice.imza ?? 100, coins), youOpen = isOwned('renklerin', cprice.renklerin ?? 800, coins)
  const sigP = priceInfo('imza', cprice.imza ?? 100, coins), youP = priceInfo('renklerin', cprice.renklerin ?? 800, coins)
  void tick; void live

  return (
    <div className={'home' + (sp ? ' sp-open' : '')}>
      <div className="col">
        <div className="card">
          <div className="card-head"><span className="micro">Kozmetik</span><a onClick={() => go('cosmetics')}>Tümü</a></div>
          <div className="cape-tiles">
            <button className={'gcard cape-tile' + (sigOpen ? '' : ' locked')} onClick={() => go('cosmetics')}>
              {!sigOpen && <span className="lk"><Icon name="lock" size={13} /></span>}
              {icons.imza ? <img className="cape-img" src={icons.imza} alt="" /> : <div className="cape-art sig"><VtSymbol size={22} /></div>}<b>İmza</b><span className={sigOpen ? 'ok' : ''}>{sigOpen ? 'Sahipsin' : <><CoinIcon size={13} /> {sigP.price}</>}</span>
            </button>
            <button className={'gcard cape-tile' + (youOpen ? '' : ' locked')} onClick={() => go('cosmetics')}>
              {!youOpen && <span className="lk"><Icon name="lock" size={13} /></span>}
              {icons.renklerin ? <img className="cape-img" src={icons.renklerin} alt="" /> : <div className="cape-art you"><VtSymbol size={22} /></div>}<b>Senin Renklerin</b><span className={youOpen ? 'ok' : ''}>{youOpen ? 'Sahipsin' : <><CoinIcon size={13} /> {youP.price}</>}</span>
            </button>
          </div>
        </div>
        {servers.length ? (
          <>{servers.slice(0, 2).map((x) => <div className="sp-slot" key={x.id}><SponsorCard server={x} active={openSp === x.id} onOpen={() => setOpenSp(openSp === x.id ? '' : x.id)} /></div>)}</>
        ) : <div className="news-spacer" aria-hidden />}
        <VoiceRoomsCard />
      </div>

      <div className="center">
        <div className="stage-wrap">
          <div className="stage-chips-top">
            <button className="pill" onClick={() => go('mods')}><Icon name="layers" size={14} /> Düzen</button>
            <div className="pill">{account?.username}</div>
            <button className="pill" onClick={() => go('skin')}><Icon name="user" size={14} /> Skinler</button>
          </div>
          <SkinStage skin={skin} slim={!!(settings as any).skinSlim} className="home-stage" zoom={0.84} fitTop={38} />
        </div>
        <div className="play-wrap">
          <button className={'play-btn' + (busy ? ' busy' : '') + (gstate === 'playing' ? ' playing' : '')} onClick={() => (gstate === 'idle' ? play() : gstate === 'playing' ? stop() : undefined)} disabled={busy}>
            {busy && <i className="play-fill" style={{ width: progress.pct + '%' }} />}
            <span className="play-label">{gstate === 'idle' && <Icon name="play" size={22} />} {label}</span>
          </button>
          <div className="pp-wrap" ref={pickRef}>
            {pick && (
              <div className="pp-list">
                {profiles.profiles.map((p) => (
                  <button key={p.id} className={p.id === profiles.selected ? 'on' : ''} onClick={() => { window.vt.invoke('profiles:select', p.id).then(setProfiles); setPick(false) }} data-id={p.id}>
                    <Icon name={p.id === profiles.selected ? 'check' : 'layers'} size={14} /> {p.name}<em>{p.version}</em>
                  </button>
                ))}
                <hr />
                <button onClick={() => { setPick(false); go('profiles') }}><Icon name="gear" size={14} /> Profilleri yönet</button>
              </div>
            )}
            <button className="profile-pill pill" onClick={() => setPick(!pick)} disabled={busy}>
              <span className="pp-main"><Icon name="check" size={15} /> {current?.name || 'VanillaTurkey'} <span className="pp-ver">{current?.version || '1.21.11'} Fabric</span></span>
              <span className="pp-arrow"><Icon name="chevron" size={16} /></span>
            </button>
          </div>
        </div>
      </div>

      <SponsorDrawer server={sp} open={!!sp} onClose={() => setOpenSp('')} joinBusy={gstate !== 'idle'} joinHint={gstate === 'playing' ? 'Oyun zaten açık' : 'Hazırlanıyor…'}
        onJoin={(x) => { setOpenSp(''); playServer(x.ip) }} />

      <div className="col">
        <CoinCard stats={stats} />
        <FriendsCard go={() => go('friends')} />
      </div>
    </div>
  )
}
