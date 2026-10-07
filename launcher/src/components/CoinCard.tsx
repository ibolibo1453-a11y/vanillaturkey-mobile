import React, { useEffect, useRef, useState } from 'react'
import { useApp } from '../store'
import { Avatar, Icon } from './ui'
import { CoinSummary } from './Coins'
import { Stats, computeStats, fromApi, dur, dayLabels } from '../stats'

let FAKE: Stats | null = null // dev screenshots only
export function useStats() {
  const { account, current } = useApp()
  const [stats, setStats] = useState<Stats>(() => FAKE || computeStats(null))
  const [live, setLive] = useState(false)
  useEffect(() => {
    let alive = true
    const load = async () => {
      if (FAKE) return
      const r = await window.vt.invoke('api:call', 'GET', '/v1/stats/me', undefined, true)
      if (!alive) return
      if (r?.data?.ok) { const st = fromApi(r.data); setStats(st); setLive(true); return }
      const local = await window.vt.invoke('stats:local')
      if (alive) { setStats(computeStats(local)); setLive(false) }
    }
    load(); const t = setInterval(load, 60000)
    const off = window.vt.on((ch, a) => { if (ch === 'shot:fakestats') { FAKE = fromApi(a); setStats(FAKE); setLive(true) } })
    return () => { alive = false; clearInterval(t); off() }
  }, [account?.username, current?.id])
  return { stats, live }
}

export function CoinCard({ stats }: { stats: Stats }) {
  const { account, toast } = useApp()
  const ref = useRef<HTMLDivElement>(null)
  const empty = stats.totalSeconds <= 0
  const max = Math.max(1, ...stats.last7Days)
  const labels = dayLabels()
  const since = stats.firstPlayed ? new Date(stats.firstPlayed).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' }) : ''

  async function copy() {
    const el = ref.current; if (!el) return
    const r = el.getBoundingClientRect()
    el.classList.add('capturing')
    await new Promise((res) => setTimeout(res, 80))
    const ok = await window.vt.invoke('card:copy', { x: r.left, y: r.top, width: r.width, height: r.height })
    el.classList.remove('capturing')
    toast(ok ? 'Kart panoya kopyalandı. Discord\'a yapıştırabilirsin.' : 'Kopyalanamadı.', ok ? 'ok' : 'err')
  }

  return (
    <div className="card lvl" ref={ref}>
      <div className="lvl-top">
        <Avatar name={account?.username || ''} size={42} />
        <div className="lvl-who"><b>{account?.username}</b><span>{since ? `Oynamaya başladığı: ${since}` : 'Henüz oynamaya başlamadı'}</span></div>
        <span className="streak"><i />{stats.streakDays > 0 ? `${stats.streakDays} gün seri` : 'Seri yok'}</span>
      </div>
      <CoinSummary />
      <div className="stat-tiles">
        <div className="gcard stat-tile"><b>{dur(stats.totalSeconds)}</b><span>Oynama süresi</span></div>
        <div className="gcard stat-tile"><b>{stats.playerKills}</b><span>Öldürülen oyuncu</span></div>
        <div className="gcard stat-tile"><b>{stats.mobKills}</b><span>Öldürülen yaratık</span></div>
      </div>
      <div className="week" title="Son 7 gün">
        {stats.last7Days.map((s, i) => (
          <div key={i}><i className={s <= 0 ? 'z' : ''} style={{ height: s <= 0 ? 3 : Math.max(5, (s / max) * 100 * 0.75) + '%' }} /><span>{labels[i]}</span></div>
        ))}
      </div>
      {empty && <div className="lvl-empty">Oynamaya başla: saatlerin burada birikir, her gün giriş yap, coin kazan.</div>}
      <div className="watermark">VanillaTurkey Client</div>
      <button className="btn-glass copy-btn" onClick={copy}><Icon name="copy" size={14} /> Kartı kopyala</button>
    </div>
  )
}
