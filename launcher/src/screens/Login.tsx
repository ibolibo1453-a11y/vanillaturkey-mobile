import React, { useEffect, useState } from 'react'
import { TitleBar, Icon, Toggle } from '../components/ui'
import { LoginBg } from '../components/LoginBg'
import { useApp, Acc } from '../store'
import { Lockup } from '../components/Brand'

export function Login({ onDone }: { onDone: (a: Acc) => void }) {
  const { settings, toast } = useApp()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [user, setUser] = useState(settings.lastUser || '')
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [remember, setRemember] = useState(settings.remember)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [offlineOffer, setOfflineOffer] = useState(false)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => window.vt.on((ch) => {
    if (ch === 'shot:register') setMode('register')
    if (ch === 'shot:login') setMode('login')
  }), [])

  const finish = (a: Acc) => { setLeaving(true); setTimeout(() => onDone(a), 450) }
  const validName = /^[A-Za-z0-9_]{3,16}$/.test(user)
  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    setErr(''); setOfflineOffer(false)
    if (!validName) return setErr('Kullanıcı adı 3-16 karakter olmalı (harf, rakam, _).')
    if (pass.length < 6) return setErr('Şifre en az 6 karakter olmalı.')
    if (mode === 'register' && pass !== pass2) return setErr('Şifreler eşleşmiyor.')
    setBusy('Bağlanılıyor…')
    const r = await window.vt.invoke('auth:login', user, pass, remember, mode === 'register' ? pass2 : undefined)
    setBusy('')
    if (r.ok) return finish(r.account)
    if (r.networkError) {
      setOfflineOffer(true)
      setErr(mode === 'register' ? 'Sunucuya ulaşılamadı. Çevrimdışıyken kayıt olunamaz.' : 'Sunucuya ulaşılamadı. Çevrimdışı giriş yapabilirsin.')
    } else setErr(r.error)
  }
  async function offline() {
    const r = await window.vt.invoke('auth:offline', user, pass)
    if (r.ok) finish(r.account); else setErr(r.error)
  }
  async function microsoft() {
    setErr(''); setBusy('Microsoft…')
    const r = await window.vt.invoke('auth:microsoft')
    setBusy('')
    if (r.ok) finish(r.account); else setErr(r.error)
  }
  const flip = (m: 'login' | 'register') => { setMode(m); setErr(''); setOfflineOffer(false) }

  return (
    <div className={'login' + (leaving ? ' leaving' : '')}>
      <LoginBg />
      <TitleBar />
      <div className="center-stack" style={{ gap: 10 }}>
        <Lockup scale={0.85} />
        <form className="glass login-card" onSubmit={submit} key={mode}>
          <h2>{mode === 'login' ? 'Giriş Yap' : 'Kayıt Ol'}</h2>
          <p className="sub">{mode === 'login' ? 'Hesabınla devam et' : 'Yeni bir hesap oluştur'}</p>
          <label className="field"><span>Kullanıcı adı</span>
            <div className="input lg"><Icon name="user" size={18} /><input value={user} onChange={(e) => setUser(e.target.value)} placeholder="Kullanıcı adın" autoFocus maxLength={16} spellCheck={false} /></div>
          </label>
          <label className="field"><span>Şifre</span>
            <div className="input lg"><Icon name="lock" size={18} /><input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="••••••••" /></div>
          </label>
          {mode === 'register' && (
            <label className="field"><span>Şifre tekrar</span>
              <div className="input lg"><Icon name="lock" size={18} /><input type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} placeholder="••••••••" /></div>
            </label>
          )}
          {mode === 'login' && <div className="remember"><Toggle on={remember} onChange={setRemember} /><span>Beni hatırla</span></div>}
          {err && <div className="form-err">{err}</div>}
          <button className={'btn-primary lg' + (busy ? ' dim' : '')} type="submit" disabled={!!busy}>
            {busy ? <><i className="spin" /> {busy}</> : <>{mode === 'login' ? 'Giriş Yap ve Oyna' : 'Kayıt Ol ve Oyna'}</>}
          </button>
          {offlineOffer && mode === 'login' && <button type="button" className="btn-glass" onClick={offline}>Çevrimdışı giriş</button>}
          <div className="or"><i />veya<i /></div>
          <button type="button" className="btn-ms" onClick={microsoft} disabled={!!busy}><Icon name="ms" size={18} /> Microsoft ile giriş</button>
          <div className="lc-foot">
            {mode === 'login'
              ? <button type="button" onClick={() => flip('register')}>Kayıt Ol</button>
              : <button type="button" onClick={() => flip('login')}>Giriş Yap</button>}
            <i />
            <button type="button" onClick={() => toast('Şifre sıfırlamak için Discord sunucumuzdan destek talebi aç.')}>Şifremi Unuttum</button>
          </div>
        </form>
        <div className="login-ver">VanillaTurkey Client</div>
      </div>
    </div>
  )
}
