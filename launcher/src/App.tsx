import React, { useEffect, useState } from 'react'
import { Provider, useApp, Settings } from './store'
import { Icon, Avatar, WinControls } from './components/ui'
import { LoginBg } from './components/LoginBg'
import { Splash } from './screens/Splash'
import { Login } from './screens/Login'
import { Home } from './screens/Home'
import { Profiles } from './screens/Profiles'
import { Cosmetics } from './screens/Cosmetics'
import { SkinEditor } from './screens/SkinEditor'
import { Mods } from './screens/Mods'
import { SettingsScreen } from './screens/SettingsScreen'
import { Lockup, VtSymbol } from './components/Brand'
import { FriendsScreen } from './screens/Friends'
import { AdminScreen, launcherPanelApi } from './screens/Admin'
import { useAdminMe } from './admin/AdminPanel'
import { LiveBanner } from './components/LiveBanner'
import { SocialRoot } from './SocialRoot'
import { CoinPill, useCoinSync } from './components/Coins'
import { useSocialMaybe, useSocial } from './social'

export type Page = 'home' | 'profiles' | 'mods' | 'cosmetics' | 'settings' | 'skin' | 'friends' | 'admin'
const NAV: { id: Page; icon: string; label: string }[] = [
  { id: 'home', icon: 'game', label: 'Oyna' }, { id: 'profiles', icon: 'layers', label: 'Profiller' }, { id: 'mods', icon: 'puzzle', label: 'Modlar' },
  { id: 'cosmetics', icon: 'shirt', label: 'Kozmetik' }, { id: 'settings', icon: 'gear', label: 'Ayarlar' }
]
const BG_LABELS = ['Video', 'Sabit', 'Bulanık']

function LaunchSplash({ onHide }: { onHide: () => void }) {
  const { gstate, progress, current, gameError, clearError, play, clientUpdating } = useApp()
  const busy = gstate === 'installing' || gstate === 'launching'
  if (!busy && !gameError) return null
  return (
    <div className="launch-splash">
      <LoginBg blur={16} useVideo={false} />
      <div className="center-stack">
        <Lockup scale={0.9} />
        {gameError && !busy ? (
          <div className="glass-prog glass err-panel" role="alert">
            <div className="ep-head"><span className="ep-ico"><Icon name="close" size={16} /></span><b>Kurulum tamamlanamadı</b></div>
            <div className="ep-step">{gameError.step}</div>
            <p>{gameError.message}</p>
            <p className="ep-hint">İnternet bağlantını kontrol et. Yarım kalan indirmeler kaldığı yerden devam eder; ayrıntılar launcher.log dosyasında.</p>
            <div className="ep-btns">
              <button className="btn-glass sm" onClick={clearError}>Kapat</button>
              <button className="btn-primary sm" onClick={() => { clearError(); play() }}><Icon name="refresh" size={14} /> Tekrar dene</button>
            </div>
          </div>
        ) : (
          <>
            <div className="ls-status">{clientUpdating ? `Client güncelleniyor${clientUpdating !== '?' ? ` · v${clientUpdating}` : ''}` : gstate === 'installing' ? 'Hazırlanıyor' : 'Oyun başlatılıyor'}{current ? ` · ${current.name}` : ''}</div>
            <div className="glass-prog glass">
              <div className="bar"><i style={{ width: progress.pct + '%' }} /></div>
              <div className="row"><span>{progress.text || 'Başlatılıyor…'}</span><span>{Math.floor(progress.pct)}%</span></div>
            </div>
            <button className="btn-glass sm" onClick={onHide}>Gizle</button>
          </>
        )}
      </div>
    </div>
  )
}

/** Launcher self-update banner (electron-updater): glass pill under the top bar. */
function UpdateBanner() {
  const { updater } = useApp()
  const [dismissed, setDismissed] = useState('')
  if (updater.state === 'idle' || updater.state === 'checking' || updater.state === 'error' || dismissed === (updater.version || '') + updater.state) return null
  return (
    <div className="upd-banner pill">
      {updater.state === 'ready' ? (
        <>
          <span className="ub-dot" /> <b>Yeni sürüm hazır{updater.version ? ` · v${updater.version}` : ''}</b>
          <button className="btn-primary sm" onClick={() => window.vt.invoke('updater:install')}><Icon name="refresh" size={14} /> Güncelle</button>
          <button className="icon-btn ub-x" onClick={() => setDismissed((updater.version || '') + updater.state)} aria-label="Sonra"><Icon name="close" size={14} /></button>
        </>
      ) : (
        <><i className="spin" /> <b>Yeni sürüm indiriliyor{updater.version ? ` · v${updater.version}` : ''} {updater.pct ? `%${updater.pct}` : ''}</b></>
      )}
    </div>
  )
}

function VoiceButton() {
  const c = useSocialMaybe()
  if (!c) return null
  return <VoiceButtonInner />
}
function VoiceButtonInner() {
  const c = useSocialMaybe()!
  const s = useSocial()
  const unread = c.unreadTotal()
  return (
    <button className={'vbtn-top pill' + (s.myRoomId ? ' live' : '')} onClick={() => (s.windowOpen ? c.closeWindow() : c.openWindow())} title="Ses Odaları ve Sohbet">
      <Icon name={s.myRoomId ? 'mic' : 'chat'} size={17} />{s.myRoomId ? 'Odadasın' : 'Sohbet'}{unread > 0 && <b className="sx-badge">{unread > 99 ? '99+' : unread}</b>}
    </button>
  )
}

function Shell() {
  const { account, setAccount, gstate, info, gameError, toast } = useApp()
  const [phase, setPhase] = useState<'splash' | 'login' | 'app'>('splash')
  const [page, setPage] = useState<Page>('home')
  useCoinSync(phase === 'app' && !!account && !account.offline && !account.ms, account?.username || '', toast)   // R5-C: daily reward + balance
  const [menu, setMenu] = useState(false)
  const [hideSplash, setHideSplash] = useState(false)
  // R5-A: "Yönetim" appears only for KURUCU / YETKİLİ (decided by the API)
  const adminMe = useAdminMe(launcherPanelApi, account && !account.offline && !account.ms ? account.username : '')
  const canAdmin = !!adminMe?.canAdmin
  const [bg, setBg] = useState(() => { try { return Number(localStorage.getItem('vt.bg') || 0) % 3 } catch { return 0 } })
  const cycleBg = () => setBg((b) => { const n = (b + 1) % 3; try { localStorage.setItem('vt.bg', String(n)) } catch {} ; return n })

  useEffect(() => window.vt.on((ch, a) => {
    if (ch === 'shot:nav') { if (!account) setAccount({ username: 'Kerem_TR', uuid: '', offline: false, ms: false }); setPhase('app'); setPage(a); setMenu(false) }
    if (ch === 'shot:account') { setAccount(a); setPhase('app'); setPage('home') }
    if (ch === 'shot:usermenu') setMenu(true)
    if (ch === 'shot:bg') setBg(a)
  }), [account, setAccount])
  useEffect(() => { if (gstate === 'idle') setHideSplash(false) }, [gstate])
  useEffect(() => { if (gameError) setHideSplash(false) }, [gameError])
  useEffect(() => {
    if (!menu) return
    const h = () => setMenu(false)
    const t = setTimeout(() => window.addEventListener('mousedown', h), 0)
    return () => { clearTimeout(t); window.removeEventListener('mousedown', h) }
  }, [menu])

  if (phase === 'splash') return <Splash onDone={(acc) => { if (acc) { setAccount(acc); setPhase('app') } else setPhase('login') }} />
  if (phase === 'login' || !account) return <Login onDone={(a) => { setAccount(a); setPhase('app') }} />

  const logout = async (switchOnly: boolean) => { if (!switchOnly) await window.vt.invoke('account:logout'); setAccount(null); setMenu(false); setPhase('login') }
  const scroll = page === 'profiles' || page === 'settings' || page === 'mods'
  return (
    <div className="app">
      <LoginBg mode={bg} />
      <header className="topbar drag">
        <div className="tb-left"><div className="brand-chip pill"><VtSymbol size={22} className="chip-sym" /> VanillaTurkey</div></div>
        <nav className="nav-pill pill">
          {[...NAV, ...(canAdmin ? [{ id: 'admin' as Page, icon: 'shield', label: 'Yönetim' }] : [])].map((n) => (
            <button key={n.id} title={n.label} className={'nav-btn' + (page === n.id ? ' on' : '')} onClick={() => setPage(n.id)}><Icon name={n.icon} size={17} /><span className="nl">{n.label}</span></button>
          ))}
        </nav>
        <div className="tb-right">
          <CoinPill onClick={() => setPage('cosmetics')} />
          <VoiceButton />
          <div className="user-wrap" onMouseDown={(e) => e.stopPropagation()}>
            <button className="user-chip pill" onClick={() => setMenu((m) => !m)}><Avatar name={account.username} size={30} />{account.username}<Icon name="chevron" size={14} /></button>
            {menu && (
              <div className="user-menu">
                <div className="um-name">{account.username}</div>
                <div className="um-sub">{account.ms ? 'Microsoft hesabı' : account.offline ? 'Çevrimdışı' : 'VanillaTurkey hesabı'}</div>
                <button onClick={() => { setMenu(false); setPage('friends') }}><Icon name="users" size={16} /> Arkadaşlar</button>
                <button onClick={() => { setMenu(false); setPage('skin') }}><Icon name="user" size={16} /> Skin Düzenleyici</button>
                <button onClick={() => logout(true)}><Icon name="refresh" size={16} /> Hesap Değiştir</button>
                <button onClick={() => logout(false)}><Icon name="logout" size={16} /> Çıkış Yap</button>
              </div>
            )}
          </div>
          <WinControls />
        </div>
      </header>
      <div className={'page' + (scroll ? ' scroll' : '')} key={page}>
        {page === 'home' && <Home go={setPage} />}
        {page === 'profiles' && <div className="page-inner"><Profiles go={setPage} /></div>}
        {page === 'cosmetics' && <Cosmetics onClose={() => setPage('home')} />}
        {page === 'skin' && <SkinEditor />}
        {page === 'mods' && <div className="page-inner"><Mods /></div>}
        {page === 'friends' && <FriendsScreen />}
        {page === 'admin' && adminMe?.canAdmin && <AdminScreen me={adminMe} />}
        {page === 'settings' && <div className="page-inner"><SettingsScreen onLogout={() => { setAccount(null); setPhase('login') }} /></div>}
      </div>
      <UpdateBanner />
      <LiveBanner call={launcherPanelApi.call} version={info.version} />
      <div className="footer-ver">VanillaTurkey Client v{info.version}</div>
      <button className="bg-chip pill" onClick={cycleBg}><Icon name="image" size={14} /> Arka plan · {BG_LABELS[bg]}</button>
      {!hideSplash && <LaunchSplash onHide={() => setHideSplash(true)} />}
    </div>
  )
}

export function App() {
  const [boot, setBoot] = useState<{ s: Settings; info: any } | null>(null)
  useEffect(() => {
    Promise.all([window.vt.invoke('settings:get'), window.vt.invoke('app:info')]).then(([s, info]) => setBoot({ s, info }))
  }, [])
  if (!boot) return <div className="boot" />
  return <Provider initial={boot.s} info={boot.info}><SocialRoot><Shell /></SocialRoot></Provider>
}
