import React, { useEffect, useState } from 'react'
import { useApp, Profile } from '../store'
import { Icon, Toggle, Select } from '../components/ui'
import type { Page } from '../App'
import { VtSymbol } from '../components/Brand'

const OWN = '1.21.11'
const vparts = (v: string) => v.split('.').map((x) => parseInt(x) || 0)
const vcmp = (a: string, b: string) => { const x = vparts(a), y = vparts(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d } return 0 }
const sortVer = (l: string[]) => [...l].sort((a, b) => vcmp(b, a))
const newest = (l: string[]) => sortVer(l)[0] || OWN
const fmtGb = (mb: number) => (mb / 1024).toFixed(mb % 1024 ? 1 : 0) + ' GB'

interface Draft { id?: string; name: string; version: string; ramMb: number; perfPack: boolean }

function Editor({ draft, onClose, onSave }: { draft: Draft; onClose: () => void; onSave: (d: Draft) => void }) {
  const { info } = useApp()
  const [d, setD] = useState(draft)
  const [versions, setVersions] = useState<string[]>([OWN])
  const [supported, setSupported] = useState<string[]>([OWN])
  useEffect(() => {
    Promise.all([window.vt.invoke('profiles:versions'), window.vt.invoke('profiles:supported')]).then(([v, s]: [string[], string[]]) => {
      setSupported(s); setVersions(sortVer([...new Set([...v, OWN, ...s])]))
      if (!draft.id && !draftTouched.current) setD((x) => ({ ...x, version: newest(s) }))
    })
  }, [])
  const draftTouched = React.useRef(!!draft.id)
  const maxRam = Math.max(2048, Math.floor((info.totalMemMb * 0.75) / 512) * 512)
  const own = supported.includes(d.version)
  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="modal glass" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{d.id ? 'Profili düzenle' : 'Yeni profil'}</h2>
        <label className="field"><span>Profil adı</span><div className="input lg"><input value={d.name} maxLength={32} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Örn. PvP, Test dünyası" autoFocus spellCheck={false} /></div></label>
        <div className="field"><span>Minecraft sürümü (Fabric)</span>
          <Select value={d.version} width={400} options={versions.map((v) => ({ value: v, label: supported.includes(v) ? `${v} · VanillaTurkey${v === newest(supported) ? ' · önerilen' : ''}` : `${v} · Sadece Fabric` }))} onChange={(v) => { draftTouched.current = true; setD({ ...d, version: v }) }} />
        </div>
        {!own && <div className="warn-note">Bu sürüm için VanillaTurkey Client henüz yok: sade Fabric + Fabric API (ve istersen Performans Paketi) ile açılır.</div>}
        <div className="field"><span>Bellek (RAM)</span>
          <div className="ram-line"><b>{fmtGb(d.ramMb)}</b><span className="muted">Toplam {fmtGb(info.totalMemMb)}</span></div>
          <input className="slider" type="range" min={1024} max={maxRam} step={512} value={d.ramMb} style={{ '--p': ((d.ramMb - 1024) / (maxRam - 1024)) * 100 + '%' } as React.CSSProperties} onChange={(e) => setD({ ...d, ramMb: +e.target.value })} />
        </div>
        <div className="set-row" style={{ padding: '4px 0' }}>
          <div><b>Performans Paketi</b><span>Sodium, Lithium ve diğer FPS modları</span></div>
          <Toggle on={d.perfPack} onChange={(v) => setD({ ...d, perfPack: v })} />
        </div>
        <div className="modal-btns">
          <button className="btn-glass" onClick={onClose}>Vazgeç</button>
          <button className="btn-primary" disabled={!d.name.trim()} onClick={() => onSave(d)}>Kaydet</button>
        </div>
      </div>
    </div>
  )
}

export function Profiles({ go }: { go: (p: Page) => void }) {
  const { profiles, setProfiles, gstate, play, settings, toast } = useApp()
  const [draft, setDraft] = useState<Draft | null>(null)
  const busy = gstate !== 'idle'
  const blank = (): Draft => ({ name: '', version: OWN, ramMb: settings.ramMb, perfPack: true })

  useEffect(() => window.vt.on((ch) => { if (ch === 'shot:newprofile') setDraft({ ...blank(), name: 'PvP' }) }), [])

  async function save(d: Draft) {
    setProfiles(await window.vt.invoke('profiles:save', d)); setDraft(null)
    toast(d.id ? 'Profil güncellendi.' : 'Profil oluşturuldu.')
  }
  async function select(id: string) { setProfiles(await window.vt.invoke('profiles:select', id)) }
  async function remove(p: Profile) {
    if (!window.confirm(`"${p.name}" profili silinsin mi?\nOyun klasörü diskte kalır, silinmez.`)) return
    setProfiles(await window.vt.invoke('profiles:remove', p.id))
  }
  async function playProfile(id: string) { await select(id); play() }

  return (
    <>
      <div className="page-title">
        <div><h1>Profiller</h1><p>Her profilin kendi sürümü, belleği, modları ve oyun klasörü var. Aralarında hiçbir şey karışmaz.</p></div>
        <button className="btn-primary" onClick={() => setDraft(blank())}><Icon name="plus" size={16} /> Yeni profil</button>
      </div>
      <div className="prof-grid">
        {profiles.profiles.map((p) => {
          const sel = p.id === profiles.selected
          return (
            <div key={p.id} className={'card prof' + (sel ? ' sel' : '')}>
              <div className="prof-top">
                <div className="prof-ico">{p.id === 'vanillaturkey' ? <VtSymbol size={26} /> : <Icon name="layers" size={22} />}</div>
                <div><b>{p.name}</b><span>{p.version} · Fabric</span></div>
                {sel && <span className="prof-badge">SEÇİLİ</span>}
              </div>
              <div className="prof-meta">
                <div className="gcard"><span>Bellek</span><b>{fmtGb(p.ramMb)}</b></div>
                <div className="gcard"><span>Özellik</span><b>{Object.keys(settings.modules || {}).length || '—'}</b></div>
                <div className="gcard"><span>Ek mod</span><b>{p.modCount}</b></div>
                <div className="gcard"><span>Performans</span><b>{p.perfPack ? <><Icon name="bolt" size={13} /> Açık</> : 'Kapalı'}</b></div>
                <div className="gcard"><span>Son oynama</span><b>{p.lastPlayed ? new Date(p.lastPlayed).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }) : '—'}</b></div>
              </div>
              <div className="prof-dir" title={p.dir}>{p.dir}</div>
              <div className="prof-btns">
                <button className="btn-primary" disabled={busy} onClick={() => playProfile(p.id)}><Icon name="play" size={14} /> Oyna</button>
                {!sel && <button className="btn-outline" onClick={() => select(p.id)}>Seç</button>}
                <button className="icon-btn" title="Modlar" onClick={async () => { await select(p.id); go('mods') }}><Icon name="puzzle" size={16} /></button>
                <button className="icon-btn" title="Düzenle" onClick={() => setDraft({ id: p.id, name: p.name, version: p.version, ramMb: p.ramMb, perfPack: p.perfPack })}><Icon name="edit" size={16} /></button>
                <button className="icon-btn" title="Klasörü aç" onClick={() => window.vt.invoke('profiles:openDir', p.id)}><Icon name="folder" size={16} /></button>
                {profiles.profiles.length > 1 && <button className="icon-btn" title="Sil" onClick={() => remove(p)}><Icon name="trash" size={16} /></button>}
              </div>
            </div>
          )
        })}
        <button className="card prof prof-new" onClick={() => setDraft(blank())}><span className="plus"><Icon name="plus" size={22} /></span>Yeni profil</button>
      </div>
      {draft && <Editor draft={draft} onClose={() => setDraft(null)} onSave={save} />}
    </>
  )
}
