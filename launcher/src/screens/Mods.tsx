import React, { useEffect, useMemo, useState } from 'react'
import { Gauge, MousePointerClick, MapPin, Wifi, Keyboard, Shield, FlaskConical, Clock, Sun, ZoomIn, Flame, Crosshair, Swords, Zap, Sparkles, Eye, MessageCircle, Camera, Footprints, Timer, MemoryStick, LayoutDashboard, Puzzle, Palette, Compass, Layers, Wind, Volume2, Hammer, Cpu } from 'lucide-react'
import { useApp } from '../store'
import { Icon, Toggle } from '../components/ui'
import { SAMPLE_MODS, Mod } from '../data'
import { PackBrowser } from '../components/PackBrowser'

const KEYS: [RegExp, any][] = [
  [/fps|frame/i, Gauge], [/cps|click|tık/i, MousePointerClick], [/coord|konum|pos/i, MapPin], [/ping|latency/i, Wifi], [/key|tuş/i, Keyboard],
  [/armor|zırh/i, Shield], [/potion|iksir/i, FlaskConical], [/clock|saat|time|zaman/i, Clock], [/bright|gamma|light/i, Sun], [/zoom|yakın/i, ZoomIn],
  [/fire|ateş/i, Flame], [/cross|artı/i, Crosshair], [/hit|combo|reach|pvp|vuruş/i, Swords], [/particle|parçacık/i, Sparkles], [/entity|varlık/i, Layers],
  [/chat|gg|sohbet|text/i, MessageCircle], [/screenshot|ekran/i, Camera], [/sprint|sneak|koşu|walk/i, Footprints], [/session|timer|sayaç/i, Timer],
  [/mem|ram|bellek/i, MemoryStick], [/compass|direction|yön/i, Compass], [/color|theme|renk|tema/i, Palette], [/weather|hava|fog|sis/i, Wind], [/sound|ses/i, Volume2],
  [/boost|perf/i, Zap], [/cpu|tps/i, Cpu], [/macro|block|build|blok/i, Hammer]
]
const CAT: Record<string, any> = { HUD: LayoutDashboard, Görsel: Eye, Performans: Zap, Sosyal: MessageCircle, PvP: Swords }
const iconFor = (m: Mod) => { for (const [re, I] of KEYS) if (re.test(m.id) || re.test(m.name)) return I; return CAT[m.category] || Puzzle }

export function Mods() {
  const { settings, setSetting, toast, gstate } = useApp()
  const [tab, setTab] = useState<'client' | 'mod' | 'pack' | 'shader'>('client')
  const [mods, setMods] = useState<Mod[] | null>(null)
  const [sample, setSample] = useState(false)
  const [cat, setCat] = useState('Tümü')
  const [q, setQ] = useState('')
  const [state, setState] = useState<Record<string, boolean>>(settings.modules)

  useEffect(() => window.vt.on((ch, a) => { if (ch === 'shot:modtab') setTab(a) }), [])
  useEffect(() => {
    window.vt.invoke('catalog:modules').then((r) => {
      if (r.items.length) setMods(r.items.map((m: any) => ({ id: m.id, name: m.name || m.nameTr || m.id, desc: m.desc || m.descTr || '', category: m.category || 'Diğer' })))
      else { setMods(SAMPLE_MODS); setSample(true) }
    })
  }, [])
  const all = mods || []
  const cats = useMemo(() => ['Tümü', ...Array.from(new Set(all.map((m) => m.category)))], [all])
  const list = all.filter((m) => (cat === 'Tümü' || m.category === cat) && (!q || m.name.toLowerCase().includes(q.toLowerCase())))
  const enabledCount = all.filter((m) => state[m.id]).length

  function set(id: string, v: boolean) {
    const next = { ...state, [id]: v }
    setState(next); setSetting({ modules: next }); window.vt.invoke('modules:save', next)
  }

  return (
    <>
      <div className="page-title">
        <div><h1>Modlar</h1><p>{tab === 'client' ? 'Client modüllerini aç/kapat; oyunda Right Shift ile de değiştirebilirsin.' : 'Modrinth’ten seçili profile mod, kaynak ve shader paketi kur.'}</p></div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div className="tabs">{([['client', 'Client Modülleri'], ['mod', 'Modlar'], ['pack', 'Kaynak Paketleri'], ['shader', 'Shader Paketleri']] as const).map(([id, l]) => <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{l}</button>)}</div>
        </div>
      </div>
      {tab !== 'client' ? <PackBrowser key={tab} kind={tab} /> : (
        <>
          <div className="card mods-panel">
          <div className="mods-tools">
            <div className="tabs sm">{cats.map((c) => <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}</div>
            <span className="count">{enabledCount}/{all.length} aktif</span>
            <div className="input"><Icon name="search" size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Modül ara…" /></div>
          </div>
          <div className="mod-grid">
            {!mods && Array.from({ length: 8 }, (_, k) => <div key={k} className="gcard mod-card skel"><div className="mod-ico" /><div className="sk-line" /></div>)}
            {list.map((m, n) => {
              const I = iconFor(m)
              return (
                <div key={m.id} className={'gcard mod-card' + (state[m.id] ? ' on' : '')} style={{ animationDelay: Math.min(n, 14) * 18 + 'ms' }} onClick={() => set(m.id, !state[m.id])}>
                  <div className="mod-ico"><I size={20} strokeWidth={1.75} /></div>
                  <div className="mod-txt"><b>{m.name}</b><span>{m.desc || 'Oyun içi modül.'}</span></div>
                  <div onClick={(e) => e.stopPropagation()}><Toggle on={!!state[m.id]} onChange={(v) => set(m.id, v)} /></div>
                </div>
              )
            })}
            {mods && !list.length && <div className="empty">Sonuç yok.</div>}
          </div>
          {sample && <div className="note pad">Örnek liste gösteriliyor</div>}
          </div>
          <div className="card rpc-row">
            <div><b><Icon name="game" size={15} /> Discord Rich Presence</b><span>{settings.discordRpc ? (gstate === 'playing' ? "Minecraft'ta oynuyor" : 'Bağlantı bekleniyor') : 'Kapalı'}</span></div>
            <Toggle on={settings.discordRpc} onChange={(v) => { setSetting({ discordRpc: v }); toast(v ? 'Discord RPC açıldı.' : 'Discord RPC kapatıldı.') }} />
          </div>
        </>
      )}
    </>
  )
}
