import React, { useEffect, useState } from 'react'
import { useApp } from './store'
import { SocialClient, SocialCtx, SocialWindow, ToastStack, VoiceDock, createElectronAdapter, setCurrentSocial, invalidateHead, setSkinLoader, onSkinChange, setQuiet } from './social'
import { attachBridge } from './bridgeHost'

setSkinLoader((n) => window.vt.invoke('skin:get', n))

/** Creates the SocialClient for the signed-in account and mounts the window / toasts / voice dock + the game bridge. */
export function SocialRoot({ children }: { children: React.ReactNode }) {
  const { account, settings, applyRemote } = useApp()
  const [client, setClient] = useState<SocialClient | null>(null)
  const settingsRef = React.useRef(settings); settingsRef.current = settings

  useEffect(() => {
    if (!account) { setClient(null); return }
    let dead = false; let c: SocialClient | null = null; let detach = () => {}
    ;(async () => {
      const sess = await window.vt.invoke('social:session')
      if (dead) return
      if (sess.quiet) setQuiet(true)
      const adapter = createElectronAdapter(sess)
      c = new SocialClient(adapter)
      // live events that change what we display
      c.on((e) => { if (e.t === 'live' && e.frame.t === 'skin_upd') invalidateHead(adapter, e.frame.name) })
      setCurrentSocial(c); (window as any).__social = c
      await c.start()
      if (dead) { c.stop(); return }
      detach = attachBridge(c, { applyRemote, getSettings: () => settingsRef.current as any })
      setClient(c)
    })()
    return () => { dead = true; detach(); setCurrentSocial(null); c?.stop(); setClient(null) }
  }, [account?.username, account?.offline])

  // dev/shot helpers
  useEffect(() => window.vt.on((ch, a) => {
    if (ch === 'shot:social' && client) client.openWindow(a || undefined)
    if (ch === 'shot:socialclose' && client) client.closeWindow()
  }), [client])
  useEffect(() => onSkinChange(() => {}), [])

  return (
    <SocialCtx.Provider value={client}>
      {children}
      {client && account && <><SocialWindow /><ToastStack /><VoiceDock /></>}
    </SocialCtx.Provider>
  )
}
