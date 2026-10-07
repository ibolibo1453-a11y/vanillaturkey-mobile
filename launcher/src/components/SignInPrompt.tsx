import React from 'react'

/** Shown where a feature needs a VanillaTurkey account (offline / Microsoft sessions): one click back to Giriş / Kayıt Ol. */
export function SignInPrompt({ msg }: { msg: string }) {
  const go = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await window.vt.invoke('account:logout')
    location.reload()
  }
  return (
    <div className="signin-prompt">
      <p className="friends-empty">{msg}</p>
      <button type="button" className="btn-primary sm" onClick={go}>Giriş yap / Kayıt ol</button>
    </div>
  )
}
