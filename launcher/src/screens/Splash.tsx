import React, { useEffect, useState } from 'react'
import { TitleBar } from '../components/ui'
import { LoginBg } from '../components/LoginBg'
import type { Acc } from '../store'
import { Lockup } from '../components/Brand'

const STEPS = ['Kaynaklar hazırlanıyor…', 'Ayarlar yükleniyor…', 'Hesap servisine bağlanılıyor…', 'Oturum kontrol ediliyor…', 'Neredeyse hazır…']

export function Splash({ onDone }: { onDone: (acc: Acc | null) => void }) {
  const [pct, setPct] = useState(0)
  const [step, setStep] = useState(0)
  useEffect(() => {
    let alive = true
    const restore = window.vt.invoke('account:restore')
    const start = Date.now()
    const tick = setInterval(() => {
      const el = Date.now() - start
      const p = Math.min(100, el / 28)
      setPct(p); setStep(Math.min(STEPS.length - 1, Math.floor(p / 21)))
      if (p >= 100) {
        clearInterval(tick)
        restore.then((a) => { if (alive) onDone(a) })
      }
    }, 30)
    return () => { alive = false; clearInterval(tick) }
  }, [])
  return (
    <div className="splash">
      <LoginBg blur={14} useVideo={false} />
      <TitleBar />
      <div className="center-stack">
        <Lockup scale={1.1} />
        <div className="glass-prog glass" style={{ marginTop: 18 }}>
          <div className="bar"><i style={{ width: pct + '%' }} /></div>
          <div className="row"><span>{STEPS[step]}</span><span>{Math.floor(pct)}%</span></div>
        </div>
      </div>
    </div>
  )
}
