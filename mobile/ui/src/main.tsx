import '@fontsource-variable/inter'
import '@fontsource/barlow/500.css'
import '@fontsource/barlow/600.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { hasNative, isIOS } from './native/native'
import { installMock } from './native/mock'
import { installVt } from './native/vt'
import { MobilePanel } from './MobilePanel'

async function boot() {
  if (!hasNative()) installMock() // browser preview (layout work); the app always has a native bridge (VTAndroid / webkit)
  await installVt()
  const { App } = await import('@launcher/App')
  await import('@launcher/glass.css')
  await import('./mobile.css')
  createRoot(document.getElementById('root')!).render(<App />)
  const host = document.createElement('div'); host.id = 'vt-mobile-ui'; document.body.appendChild(host)
  createRoot(host).render(<MobilePanel />)
  // GPL-3.0 §7: modified versions must say so on the start / main interface (Zalith Launcher 2 on Android, Amethyst-iOS on iPhone)
  const tag = document.createElement('div')
  tag.className = 'vt-unofficial'
  tag.textContent = isIOS()
    ? 'VanillaTurkey Mobile · Amethyst-iOS tabanlı, resmî olmayan değiştirilmiş sürüm (GPL-3.0)'
    : 'VanillaTurkey Mobile · Zalith Launcher 2 tabanlı, resmî olmayan değiştirilmiş sürüm (GPL-3.0)'
  document.body.appendChild(tag)
}
boot().catch((e) => { document.body.innerHTML = '<pre style="color:#fff;padding:16px;white-space:pre-wrap">Başlatılamadı: ' + String(e?.stack || e) + '</pre>' })
