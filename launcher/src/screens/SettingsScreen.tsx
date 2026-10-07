import React, { useState } from 'react'
import { useApp } from '../store'
import { Icon, Toggle, Select } from '../components/ui'
import { VoiceSettings, useSocialMaybe } from '../social'
import { DiscordLink } from '../components/DiscordLink'

const RES = [[1280, 720], [1600, 900], [1920, 1080], [2560, 1440]]
const PERF_NAMES: Record<string, string> = {
  sodium: 'Sodium', lithium: 'Lithium', 'ferrite-core': 'FerriteCore', immediatelyfast: 'ImmediatelyFast', entityculling: 'Entity Culling',
  modernfix: 'ModernFix', moreculling: 'More Culling', 'dynamic-fps': 'Dynamic FPS', badoptimizations: 'BadOptimizations', krypton: 'Krypton', 'c2me-fabric': 'C2ME'
}

const Row = ({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) => (
  <div className="set-row"><div><b>{title}</b>{desc && <span>{desc}</span>}</div><div className="set-ctl">{children}</div></div>
)

export function SettingsScreen({ onLogout }: { onLogout: () => void }) {
  const { settings: s, setSetting, info, toast } = useApp()
  const [tab, setTab] = useState('Genel Ayarlar')
  const voice = useSocialMaybe()
  const maxRam = Math.max(2048, Math.floor((info.totalMemMb * 0.75) / 512) * 512)
  const rec = Math.min(maxRam, info.totalMemMb >= 16000 ? 6144 : info.totalMemMb >= 8000 ? 4096 : 3072)
  const status: [string, string] = s.ramMb > info.totalMemMb * 0.7 ? ['Yüksek', 'danger'] : s.ramMb < 2048 ? ['Düşük', 'warn'] : s.ramMb >= rec - 512 && s.ramMb <= rec + 1024 ? ['Önerilen', 'success'] : ['İyi', 'muted']
  const pct = ((s.ramMb - 1024) / (maxRam - 1024)) * 100
  const recPct = ((rec - 1024) / (maxRam - 1024)) * 100
  const resVal = s.fullscreen ? 'full' : `${s.resW}x${s.resH}`

  return (
    <div className="settings">
      <div><div className="page-title" style={{ marginBottom: 12 }}><div><h1>Ayarlar</h1><p>Launcher, Java ve performans tercihleri</p></div></div><div className="tabs">{['Genel Ayarlar', 'Ses', 'Java ve RAM', 'Performans', 'Hesap'].map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</div></div>
      <div className="set-body" key={tab}>
        {tab === 'Genel Ayarlar' && (
          <>
            <section className="card">
              <h3>Launcher Tercihleri</h3>
              <Row title="Dil" desc="Arayüz dili"><Select value={s.lang} options={[{ value: 'tr', label: 'Türkçe' }]} onChange={(v) => setSetting({ lang: v })} /></Row>
              <Row title="Oyun klasörü" desc={info.gameDir}><button className="btn-outline sm" onClick={() => window.vt.invoke('shell:openGameDir')}><Icon name="folder" size={15} /> Aç</button></Row>
            </section>
            <section className="card">
              <h3>Başlangıç ve Güncellemeler</h3>
              <Row title="Otomatik Güncelleme" desc="Launcher ve istemci güncellemelerini otomatik indir"><Toggle on={s.autoUpdate} onChange={(v) => setSetting({ autoUpdate: v })} /></Row>
              <Row title="Windows Başlangıcında Aç" desc="Bilgisayar açıldığında launcher otomatik başlasın"><Toggle on={s.startWithWindows} onChange={(v) => setSetting({ startWithWindows: v })} /></Row>
              <Row title="Oyun açılınca launcher" desc="Minecraft açıldığında launcher ne yapsın?">
                <Select value={s.afterLaunch} options={[{ value: 'keep', label: 'Açık kalsın' }, { value: 'hide', label: 'Gizle (küçült)' }, { value: 'close', label: 'Kapat' }]} onChange={(v) => setSetting({ afterLaunch: v })} />
              </Row>
              <Row title="Tepsiye küçül" desc="Pencereyi kapatınca oyun veya ses odası açıksa tepside çalışmaya devam et"><Toggle on={s.closeToTray !== false} onChange={(v) => setSetting({ closeToTray: v })} /></Row>
              <Row title="Discord Rich Presence" desc="Oyun durumunu Discord profilinde göster"><Toggle on={s.discordRpc} onChange={(v) => setSetting({ discordRpc: v })} /></Row>
            </section>
          </>
        )}
        {tab === 'Ses' && (voice ? <div className="wide-col"><VoiceSettings /></div> : <section className="card"><p className="muted">Ses ayarları için VanillaTurkey hesabıyla giriş yapmalısın.</p></section>)}
        {tab === 'Java ve RAM' && (
          <>
            <section className="card wide">
              <h3>Varsayılan Bellek (RAM)</h3>
              <p className="muted">Yeni profiller için varsayılan bellek. Her profilin kendi RAM değerini Profiller sayfasından ayarlayabilirsin.</p>
              <div className="ram-val"><b>{(s.ramMb / 1024).toFixed(1)}</b><span>GB</span></div>
              <div className="ram-line big">Tahsis Edilen RAM: {(s.ramMb / 1024).toFixed(1)} GB / {(info.totalMemMb / 1024).toFixed(0)} GB — <em className={status[1]}>{status[0]}</em></div>
              <div className="slider-wrap">
                <input className="slider" type="range" min={1024} max={maxRam} step={512} value={s.ramMb} style={{ '--p': pct + '%' } as React.CSSProperties} onChange={(e) => setSetting({ ramMb: +e.target.value })} />
                <i className="rec-mark" style={{ left: `calc(${recPct}% + ${10 - recPct * 0.2}px)` }} title="Önerilen" />
              </div>
              <div className="slider-meta"><span>1 GB</span><span>Önerilen {(rec / 1024).toFixed(1)} GB</span><span>{(maxRam / 1024).toFixed(0)} GB</span></div>
              <button className="btn-outline sm" onClick={() => setSetting({ ramMb: rec })}>Önerilen değeri kullan</button>
            </section>
            <section className="card">
              <h3>Java Yapılandırması</h3>
              <p className="muted">Özel Java yolu (boşsa Mojang&apos;ın Java 21 çalışma zamanı otomatik indirilir).</p>
              <div className="java-row">
                <div className="input"><input value={s.javaPath} onChange={(e) => setSetting({ javaPath: e.target.value })} placeholder="Otomatik (önerilen)" spellCheck={false} /></div>
                <button className="btn-outline sm" onClick={async () => { const p = await window.vt.invoke('java:pick'); if (p) setSetting({ javaPath: p }) }}>Göz At</button>
                <button className={'btn-ghost sm' + (!s.javaPath ? ' sel' : '')} onClick={() => setSetting({ javaPath: '' })}>Otomatik (önerilen)</button>
              </div>
            </section>
            <section className="card">
              <h3>Oyun Çözünürlüğü</h3>
              <Row title="Pencere boyutu" desc="Minecraft penceresinin başlangıç çözünürlüğü">
                <Select value={resVal} options={[...RES.map(([w, h]) => ({ value: `${w}x${h}`, label: `${w}x${h}` })), { value: 'full', label: 'Tam Ekran Başlat' }]} onChange={(v) => { if (v === 'full') setSetting({ fullscreen: true }); else { const [w, h] = v.split('x').map(Number); setSetting({ resW: w, resH: h, fullscreen: false }) } }} />
              </Row>
            </section>
          </>
        )}
        {tab === 'Performans' && (
          <>
            <section className="card">
              <h3>Performans Paketi</h3>
              <Row title="Performans Paketi" desc="Sodium, Lithium ve diğer FPS modları kurulum sırasında Modrinth'ten indirilir"><Toggle on={s.perfPack} onChange={(v) => { setSetting({ perfPack: v }); toast(v ? 'Paket bir sonraki başlatmada kurulacak.' : 'Paket bir sonraki başlatmada kaldırılacak.') }} /></Row>
              <div className="perf-chips">
                {Object.entries(PERF_NAMES).map(([k, n]) => {
                  const active = s.perfPack && s.perfActive.includes(k)
                  return <span key={k} className={'pchip' + (active ? ' on' : '')}>{active && <Icon name="check" size={12} />} {n}</span>
                })}
              </div>
              {!s.perfActive.length && s.perfPack && <p className="muted pt">Hangi modların aktif olduğu ilk başlatmadan sonra burada görünür.</p>}
            </section>
            <section className="card">
              <h3>JVM ve Grafik</h3>
              <Row title="JVM profili" desc="Çöp toplayıcı ayarları (Performans Paketi açıkken Aikar tabanlı ayarlar kullanılır)">
                <Select value={s.jvmPreset} options={[{ value: 'balanced', label: 'Dengeli (G1 + Aikar)' }, { value: 'lowlatency', label: 'Düşük gecikme (ZGC)' }, { value: 'lowmem', label: 'Düşük bellek' }]} onChange={(v) => setSetting({ jvmPreset: v })} />
              </Row>
              <Row title="Hızlı grafikler" desc="İlk açılışta düşük render mesafesi ve parçacık"><Toggle on={s.fastGraphics} onChange={(v) => setSetting({ fastGraphics: v })} /></Row>
              <Row title="Oyun sesini kapat" desc="Oyun ses seviyesi 0 olarak başlar"><Toggle on={s.muteGame} onChange={(v) => setSetting({ muteGame: v })} /></Row>
            </section>
          </>
        )}
        {tab === 'Hesap' && (
          <>
          <DiscordLink />
          <section className="card wide">
            <h3>Hesap ve Oturum</h3>
            <Row title="Oturumu hatırla" desc="Bir sonraki açılışta otomatik giriş yap"><Toggle on={s.remember} onChange={(v) => setSetting({ remember: v })} /></Row>
            <Row title="Sunucu adresi (API)" desc="Hesap ve kozmetik servisi"><div className="input sm wide"><input value={s.apiBase} onChange={(e) => setSetting({ apiBase: e.target.value })} spellCheck={false} /></div></Row>
            <Row title="Oturumu kapat" desc="Kayıtlı oturum bilgileri silinir"><button className="btn-danger sm" onClick={async () => { await window.vt.invoke('account:logout'); onLogout() }}><Icon name="logout" size={15} /> Çıkış yap</button></Row>
            <Row title="Sıfırla" desc="Tüm launcher ayarlarını varsayılana döndür">
              <button className="btn-danger sm" onClick={() => { setSetting({ ramMb: 4096, javaPath: '', resW: 1280, resH: 720, fullscreen: false, autoConnect: false, discordRpc: true, autoUpdate: true, startWithWindows: false, afterLaunch: 'keep', perfPack: true, jvmPreset: 'balanced', fastGraphics: false, muteGame: false }); toast('Ayarlar sıfırlandı.') }}>Sıfırla</button>
            </Row>
          </section>
          </>
        )}
      </div>
    </div>
  )
}
