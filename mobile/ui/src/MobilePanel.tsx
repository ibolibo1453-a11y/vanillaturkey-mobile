import React, { useEffect, useState } from 'react'


interface R { id: string; name: string; summary: string }
const vt = (n: string, ...a: any[]) => window.vt.invoke(n, ...a)

/** Phone-only settings (renderer, perf pack, voice permissions, native ZL2 / Amethyst screens). Floating gear so launcher/src stays untouched. */
export function MobilePanel() {
  const [open, setOpen] = useState(false)
  const [s, setS] = useState<any>(null)
  const [renderers, setRenderers] = useState<R[]>([])
  const [info, setInfo] = useState<any>(null)
  const [mic, setMic] = useState<boolean | null>(null)
  const [overlay, setOverlay] = useState<boolean | null>(null)
  const [upd, setUpd] = useState<any>({ state: 'idle' })
  const ios = info?.platform === 'ios'

  useEffect(() => {
    if (!open) return
    vt('settings:get').then(setS)
    vt('mobile:renderers').then((r) => setRenderers(r || []))
    vt('mobile:info').then(setInfo)
    vt('mobile:perm').then((p) => { setMic(!!p?.mic); setOverlay(!!p?.overlay) })
    vt('updater:state').then(setUpd)
    return window.vt.on((ch, a) => { if (ch === 'updater') setUpd(a) })
  }, [open])

  const save = async (p: Record<string, any>) => setS(await vt('settings:set', p))
  if (!open) return <button className="vt-gear" aria-label="Mobil ayarlar" onClick={() => setOpen(true)}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg></button>

  return (
    <div className="vt-sheet-wrap" onClick={() => setOpen(false)}>
      <div className="vt-sheet glass" onClick={(e) => e.stopPropagation()}>
        <div className="vt-sheet-head"><b>Telefon ayarları</b><button className="btn-glass sm" onClick={() => setOpen(false)}>Kapat</button></div>
        <div className="vt-sheet-body">
          <section>
            <h4>Grafik ve performans</h4>
            <label className="vt-row"><span>Render motoru<small>NG-GL4ES çoğu telefonda en uyumlu; Zink (Vulkan) güçlü cihazlarda daha hızlı olabilir.</small></span>
              <select className="vt-select" value={s?.renderer || ''} onChange={(e) => save({ renderer: e.target.value })}>
                <option value="">Otomatik (varsayılan)</option>
                {renderers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select></label>
            <label className="vt-row"><span>Performans paketi<small>Lithium, FerriteCore, ModernFix, Entity Culling, Krypton (telefonda güvenli olanlar).</small></span>
              <input type="checkbox" checked={!!s?.perfPack} onChange={(e) => save({ perfPack: e.target.checked })} /></label>
            <label className="vt-row"><span>Sodium (deneysel)<small>Yalnızca Zink / MobileGlues / LTW ile yüklenir. Oyun açılmazsa kapat.</small></span>
              <input type="checkbox" checked={!!s?.experimentalSodium} onChange={(e) => save({ experimentalSodium: e.target.checked })} /></label>
            <label className="vt-row"><span>Oyun sesi kapalı</span><input type="checkbox" checked={!!s?.muteGame} onChange={(e) => save({ muteGame: e.target.checked })} /></label>
          </section>
          <section>
            <h4>Ses odaları</h4>
            <div className="vt-row"><span>Mikrofon izni<small>{mic ? 'Verildi' : 'Ses odalarında konuşmak için gerekli.'}</small></span>
              <button className="btn-glass sm" disabled={!!mic} onClick={async () => setMic(!!(await vt('mobile:requestMic')))}>{mic ? 'Tamam' : 'İzin ver'}</button></div>
            {!ios && <div className="vt-row"><span>Diğer uygulamaların üzerinde göster<small>{overlay ? 'Verildi: oyun sırasında ses kesintisiz çalışır.' : 'Oyun açıkken ses odası takılmasın diye önerilir.'}</small></span>
              <button className="btn-glass sm" disabled={!!overlay} onClick={() => vt('mobile:overlayPermission')}>{overlay ? 'Tamam' : 'Aç'}</button></div>}
          </section>
          <section>
            <h4>Kontroller ve gelişmiş</h4>
            <div className="vt-row"><span>Dokunmatik kontrol düzeni<small>Hazır VanillaTurkey düzeni kullanılır. Düğmeleri taşımak için: Gelişmiş ayarlar → Kontrol.</small></span>
              <button className="btn-glass sm" onClick={() => vt('mobile:openNativeSettings')}>Gelişmiş ayarlar</button></div>
            <div className="vt-row"><span>Hesaplar, sürümler, Java<small>{ios ? 'Microsoft hesabı eklemek, Java ve JIT ayarları (Amethyst).' : 'Microsoft hesabı eklemek ve Zalith ayarları.'}</small></span>
              <button className="btn-glass sm" onClick={() => vt('mobile:openNativeAccounts')}>Hesaplar</button></div>
          </section>
          <section>
            <h4>Uygulama</h4>
            <div className="vt-row"><span>VanillaTurkey Mobile v{info?.version || '1.0.0'}<small>{info ? `${info.model} · ${ios ? 'iOS' : 'Android'} ${info.sdk} · ${info.abi} · ${Math.round((info.totalMemMb || 0) / 102.4) / 10} GB RAM · ${info.refreshHz ? Math.round(info.refreshHz) : 60} Hz` : ''}</small></span>
              <button className="btn-glass sm" onClick={() => vt('updater:check')}>{upd.state === 'checking' ? 'Bakılıyor…' : upd.state === 'downloading' ? `İniyor %${upd.pct || 0}` : upd.state === 'ready' ? 'Hazır' : 'Güncelleme ara'}</button></div>
            {upd.state === 'ready' && <div className="vt-row"><span>Yeni sürüm hazır<small>v{upd.version}</small></span><button className="btn-primary sm" onClick={() => vt('updater:install')}>Kur</button></div>}
            <div className="vt-legal">{ios ? 'Amethyst-iOS (GPL-3.0) tabanlı, resmî olmayan değiştirilmiş sürüm. Kaynak kod ve lisans: sitedeki iPhone bölümü.' : 'Zalith Launcher 2 (GPL-3.0) tabanlı, resmî olmayan değiştirilmiş sürüm. Kaynak kod ve lisans: sitedeki Android bölümü.'} Minecraft Mojang AB'nin markasıdır; oyun dosyaları Mojang sunucularından indirilir.</div>
          </section>
        </div>
      </div>
    </div>
  )
}
