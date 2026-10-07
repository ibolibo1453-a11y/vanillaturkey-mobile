import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../store'
import { Icon, Toggle, Select } from './ui'

type Kind = 'mod' | 'pack' | 'shader'
interface Hit { id: string; slug: string; title: string; description: string; icon: string; author: string; downloads: number; follows: number; categories: string[]; updated: string }
interface Inst { file: string; name: string; enabled: boolean; size: number; system: boolean; isDir: boolean; projectId?: string; versionId?: string; title?: string; icon?: string; version?: string; auto?: boolean }

const L: Record<Kind, { one: string; many: string; ext: string; ph: string }> = {
  mod: { one: 'mod', many: 'Modlar', ext: '.jar', ph: 'Mod ara (ör. Sodium, Mod Menu)…' },
  pack: { one: 'kaynak paketi', many: 'Kaynak Paketleri', ext: '.zip', ph: 'Kaynak paketi ara…' },
  shader: { one: 'shader paketi', many: 'Shader Paketleri', ext: '.zip', ph: 'Shader paketi ara…' }
}
const SORTS = [{ value: 'relevance', label: 'En alakalı' }, { value: 'downloads', label: 'En çok indirilen' }, { value: 'follows', label: 'En çok takip edilen' }, { value: 'updated', label: 'Son güncellenen' }, { value: 'newest', label: 'En yeni' }]
const fmtN = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + ' Mn' : n >= 1e3 ? Math.round(n / 1e3) + ' B' : String(n))
const mb = (n: number) => (n > 0 ? (n / 1048576).toFixed(n < 1048576 * 10 ? 1 : 0) + ' MB' : '')
const LOADERS = new Set(['fabric', 'forge', 'neoforge', 'quilt', 'iris', 'optifine', 'canvas', 'vanilla', 'minecraft', 'bukkit', 'spigot', 'paper', 'purpur', 'folia', 'sponge', 'bungeecord', 'velocity', 'waterfall', 'datapack', 'liteloader', 'rift'])
const catLabel = (c: string) => c.charAt(0).toUpperCase() + c.slice(1).replace(/-/g, ' ')

export function PackBrowser({ kind }: { kind: Kind }) {
  const { current, toast, setProfiles } = useApp()
  const pid = current?.id || ''
  const [view, setView] = useState<'browse' | 'installed'>('browse')
  const [q, setQ] = useState(''), [dq, setDq] = useState('')
  const [sort, setSort] = useState('downloads')
  const [cat, setCat] = useState('')
  const [cats, setCats] = useState<{ id: string; label: string }[]>([])
  const [hits, setHits] = useState<Hit[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [inst, setInst] = useState<Inst[]>([])
  const [updates, setUpdates] = useState<Record<string, { versionId: string; version: string }>>({})
  const [busy, setBusy] = useState<Record<string, string>>({})
  const [drag, setDrag] = useState(false)
  const [iris, setIris] = useState<boolean | null>(null)
  const reqId = useRef(0)

  useEffect(() => window.vt.on((ch, a) => { if (ch === 'shot:modview') setView(a === 'installed' ? 'installed' : 'browse') }), [])
  useEffect(() => { const t = setTimeout(() => setDq(q), 350); return () => clearTimeout(t) }, [q])
  useEffect(() => { window.vt.invoke('mr:categories', kind).then(setCats) }, [kind])
  const loadInst = useCallback(async () => {
    if (!pid) return
    const r = await window.vt.invoke('mr:installed', { kind, profileId: pid })
    setInst(r.items || [])
    if (kind === 'shader') window.vt.invoke('mr:iris', pid).then((x) => setIris(x.installed))
  }, [kind, pid])
  useEffect(() => { loadInst() }, [loadInst])

  const run = useCallback(async (offset: number) => {
    if (!pid) return
    const my = ++reqId.current
    setLoading(true); if (!offset) setError('')
    const r = await window.vt.invoke('mr:search', { kind, profileId: pid, query: dq, category: cat || undefined, sort: dq && sort === 'downloads' ? 'relevance' : sort, offset })
    if (my !== reqId.current) return
    setLoading(false)
    if (!r.ok) { setError(r.error || 'Arama başarısız.'); if (!offset) setHits([]); return }
    setTotal(r.total); setHits((h) => (offset ? [...h, ...r.hits] : r.hits))
  }, [kind, pid, dq, cat, sort])
  useEffect(() => { run(0) }, [run])

  useEffect(() => window.vt.on((ch, a) => { if (ch === 'mr:progress') setBusy((b) => (a.projectId in b ? { ...b, [a.projectId]: a.text } : b)) }), [])

  const installedIds = new Set(inst.map((i) => i.projectId).filter(Boolean))
  const withBusy = async (key: string, fn: () => Promise<{ ok: boolean; error?: string; installed?: string[] }>, okMsg: (r: any) => string) => {
    setBusy((b) => ({ ...b, [key]: 'Hazırlanıyor…' }))
    const r = await fn()
    setBusy((b) => { const n = { ...b }; delete n[key]; return n })
    if (r.ok) { toast(okMsg(r)); await loadInst(); setProfiles(await window.vt.invoke('profiles:list')); setUpdates({}) }
    else toast(r.error || 'İşlem başarısız.', 'err')
    return r
  }
  const install = (h: { id: string; title: string }) => withBusy(h.id, () => window.vt.invoke('mr:install', { kind, profileId: pid, projectId: h.id }), (r) => (r.installed.length > 1 ? `${h.title} ve ${r.installed.length - 1} bağımlılık kuruldu.` : `${h.title} kuruldu.`))
  const update = (i: Inst) => withBusy(i.file, () => window.vt.invoke('mr:update', { kind, profileId: pid, file: i.file }), () => `${i.title || i.name} güncellendi.`)
  const remove = async (i: Inst) => { const r = await window.vt.invoke('mr:remove', { kind, profileId: pid, file: i.file }); if (!r.ok) toast(r.error, 'err'); loadInst(); setProfiles(await window.vt.invoke('profiles:list')) }
  const toggle = async (i: Inst) => { const r = await window.vt.invoke('mr:toggle', { kind, profileId: pid, file: i.file }); if (!r.ok) toast(r.error, 'err'); loadInst() }
  const checkUpdates = async () => {
    setBusy((b) => ({ ...b, __chk: 'Denetleniyor…' }))
    const r = await window.vt.invoke('mr:updates', { kind, profileId: pid })
    setBusy((b) => { const n = { ...b }; delete n.__chk; return n })
    if (!r.ok) { toast(r.error || 'Güncellemeler denetlenemedi.', 'err'); return }
    setUpdates(r.updates); const n = Object.keys(r.updates).length
    toast(n ? `${n} güncelleme var.` : 'Her şey güncel.')
  }
  const updateAll = async () => { for (const f of Object.keys(updates)) { const it = inst.find((x) => x.file === f); if (it) await update(it) } }
  const addFiles = async (paths: string[]) => { const n = await window.vt.invoke('mr:addFiles', { kind, profileId: pid, paths }); toast(n ? `${n} dosya eklendi.` : `Yalnızca ${L[kind].ext} dosyaları eklenebilir.`, n ? 'ok' : 'err'); if (n) { loadInst(); setView('installed'); setProfiles(await window.vt.invoke('profiles:list')) } }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDrag(false)
    const paths = Array.from(e.dataTransfer.files).map((f) => window.vt.pathFor(f)).filter(Boolean)
    if (paths.length) addFiles(paths)
  }
  if (!current) return null
  const updN = Object.keys(updates).length

  return (
    <div className="pb" onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false) }} onDrop={onDrop}>
      {drag && <div className="pb-drop"><Icon name="upload" size={34} /><b>Bırak: {L[kind].ext} dosyalarını {current.name} profiline ekle</b></div>}
      <div className="pb-head">
      <div className="pb-top">
        <div className="pb-target"><Icon name="layers" size={15} /> <b>{current.name}</b><span>{current.version}{kind === 'mod' ? ' · Fabric' : ''}</span></div>
        <div className="seg">
          <button className={view === 'browse' ? 'on' : ''} onClick={() => setView('browse')}>Keşfet</button>
          <button className={view === 'installed' ? 'on' : ''} onClick={() => setView('installed')}>Kurulu ({inst.length})</button>
        </div>
        <div className="pb-actions">
          <button className="btn-glass sm" onClick={() => window.vt.invoke('mr:openDir', { kind, profileId: pid })}><Icon name="folder" size={14} /> Klasörü aç</button>
          <button className="btn-glass sm" onClick={async () => { const n = await window.vt.invoke('mr:pickFiles', { kind, profileId: pid }); if (n) { toast(n + ' dosya eklendi.'); loadInst(); setView('installed') } }}><Icon name="plus" size={14} /> Dosya ekle</button>
        </div>
      </div>

      {kind === 'shader' && iris === false && (
        <div className="pb-iris gcard">
          <Icon name="sparkles" size={18} />
          <div><b>Shader paketleri için Iris gerekir</b><span>İsteğe bağlı: Iris (ve Sodium) bu profile kurulur. İstemezsen shader paketleri çalışmaz ama oyun normal açılır.</span></div>
          <button className="btn-primary sm" disabled={'YL57xq9U' in busy} onClick={() => withBusy('YL57xq9U', () => window.vt.invoke('mr:install', { kind: 'mod', profileId: pid, projectId: 'YL57xq9U' }), () => 'Iris kuruldu.').then(() => setIris(true))}>
            {'YL57xq9U' in busy ? <><i className="spin" /> {busy['YL57xq9U']}</> : <><Icon name="download" size={14} /> Iris’i kur</>}
          </button>
        </div>
      )}
      {kind === 'shader' && iris && <div className="pb-note"><Icon name="check" size={14} /> Iris kurulu. Oyunda Seçenekler → Video Ayarları → Shader Paketleri’nden seç.</div>}

      {view === 'browse' ? (
        <>
          <div className="pb-tools">
            <div className="input"><Icon name="search" size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L[kind].ph} /></div>
            <Select value={sort} width={190} onChange={setSort} options={SORTS} />
          </div>
          <div className="pb-cats">
            <button className={!cat ? 'on' : ''} onClick={() => setCat('')}>Tümü</button>
            {cats.map((c) => <button key={c.id} className={cat === c.id ? 'on' : ''} onClick={() => setCat(cat === c.id ? '' : c.id)}>{c.label}</button>)}
          </div>
        </>
      ) : (
        <>
          <div className="pb-tools">
            <span className="count">{inst.filter((i) => i.enabled).length} / {inst.length} etkin</span>
            <div className="pb-actions">
              {updN > 0 && <button className="btn-primary sm" onClick={updateAll}><Icon name="refresh" size={14} /> Hepsini güncelle ({updN})</button>}
              <button className="btn-glass sm" onClick={checkUpdates} disabled={'__chk' in busy || !inst.length}>{'__chk' in busy ? <><i className="spin" /> Denetleniyor…</> : <><Icon name="refresh" size={14} /> Güncellemeleri denetle</>}</button>
            </div>
          </div>
        </>
      )}
      </div>
      {view === 'browse' ? (
        <>
          <div className="pb-list">
            {error && <div className="warn-note">{error} <button className="link" onClick={() => run(0)}>Tekrar dene</button></div>}
            {!error && !hits.length && !loading && <div className="empty">Sonuç bulunamadı. {current.version} sürümü için uyumlu {L[kind].one} yok.</div>}
            {hits.map((h) => {
              const have = installedIds.has(h.id), b = busy[h.id]
              return (
                <div key={h.id} className="gcard pb-item">
                  <div className="pb-ico">{h.icon ? <img src={h.icon} alt="" loading="lazy" /> : <Icon name="pkg" size={22} />}</div>
                  <div className="pb-txt">
                    <div className="pb-title"><b>{h.title}</b><span>{h.author}</span></div>
                    <p>{h.description}</p>
                    <div className="pb-meta"><span><Icon name="download" size={12} /> {fmtN(h.downloads)}</span>{h.categories.filter((c) => !LOADERS.has(c)).slice(0, 3).map((c) => <em key={c}>{catLabel(c)}</em>)}</div>
                  </div>
                  <button className={have ? 'btn-glass sm' : 'btn-primary sm'} disabled={!!b || have} onClick={() => install(h)}>
                    {b ? <><i className="spin" /> <span className="pb-bt">{b}</span></> : have ? <><Icon name="check" size={14} /> Kurulu</> : <><Icon name="download" size={14} /> Kur</>}
                  </button>
                </div>
              )
            })}
            {loading && Array.from({ length: hits.length ? 1 : 6 }, (_, k) => <div key={'s' + k} className="gcard pb-item skel" />)}
            {!loading && hits.length < total && !error && <button className="btn-glass sm pb-more" onClick={() => run(hits.length)}>Daha fazla yükle ({hits.length} / {total})</button>}
          </div>
        </>
      ) : (
        <>
          <div className="pb-list">
            {!inst.length && <div className="empty">Bu profilde {L[kind].one} yok.<br /><span className="note">Keşfet sekmesinden kur ya da {L[kind].ext} dosyalarını bu pencereye sürükle.</span></div>}
            {inst.map((i) => {
              const u = updates[i.file], b = busy[i.file]
              return (
                <div key={i.file} className={'gcard pb-item inst' + (i.enabled ? '' : ' off')}>
                  <div className="pb-ico">{i.icon ? <img src={i.icon} alt="" loading="lazy" /> : <Icon name="pkg" size={20} />}</div>
                  <div className="pb-txt">
                    <div className="pb-title"><b>{i.title || i.name}</b>{i.version && <span>{i.version}</span>}{i.system && <em className="sys">Sistem</em>}{i.auto && <em>Bağımlılık</em>}</div>
                    <p>{i.title ? i.file.replace(/\.disabled$/, '') : ''} {mb(i.size)}</p>
                  </div>
                  {u && <button className="btn-primary sm" disabled={!!b} onClick={() => update(i)}>{b ? <><i className="spin" /> {b}</> : <><Icon name="refresh" size={14} /> {u.version}</>}</button>}
                  {!i.system && <Toggle on={i.enabled} onChange={() => toggle(i)} />}
                  {!i.system && <button className="icon-btn" title="Kaldır" onClick={() => remove(i)}><Icon name="trash" size={15} /></button>}
                </div>
              )
            })}
            {kind === 'mod' && current.perfPack && inst.length > 0 && <div className="note pad">Performans Paketi açıkken Sodium, Lithium gibi modlar her başlatmada yeniden kurulur; kalıcı kaldırmak için profilde Performans Paketi’ni kapat.</div>}
          </div>
        </>
      )}
    </div>
  )
}
