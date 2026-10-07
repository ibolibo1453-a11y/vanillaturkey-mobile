import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from './ui'
import './customcape.css'

const MAX_BYTES = 8 * 1024 * 1024
const MAX_SECONDS = 8
export interface MyCape { id: string; frames: number; fps: number; url: string; createdAt: number }

const videoDuration = (file: File) => new Promise<number | null>((res) => {
  const v = document.createElement('video')
  const u = URL.createObjectURL(file)
  const done = (d: number | null) => { URL.revokeObjectURL(u); v.removeAttribute('src'); v.load(); res(d) }
  const t = window.setTimeout(() => done(null), 6000)
  v.preload = 'metadata'; v.muted = true
  v.onloadedmetadata = () => { window.clearTimeout(t); done(Number.isFinite(v.duration) ? v.duration : null) }
  v.onerror = () => { window.clearTimeout(t); done(null) }
  v.src = u
})

/** "Özel pelerin": upload an MP4/GIF/WebM, the server turns it into an animated cape sprite sheet (R5-E). */
export function CustomCapePanel({ signedIn, worn, onPreview, onWear, toast }: {
  signedIn: boolean; worn?: string
  onPreview: (id: string | null) => void       // show in the 3D preview without wearing it
  onWear: (id: string | null) => void          // set / clear loadout.cape through the normal equip path
  toast: (m: string, kind?: 'err' | 'ok') => void
}) {
  const [cape, setCape] = useState<MyCape | null | undefined>(undefined)   // undefined = loading
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const file = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (!signedIn) { setCape(null); return }
    const r = await window.vt.invoke('api:call', 'GET', '/v1/cosmetics/custom-cape/me', undefined, true)
    setCape(r?.data?.ok ? r.data.cape : null)
  }, [signedIn])
  useEffect(() => { load() }, [load])
  useEffect(() => () => onPreview(null), [])

  async function pick(f: File | undefined) {
    if (file.current) file.current.value = ''
    if (!f || busy) return
    setErr('')
    if (!/^(video\/|image\/gif)/.test(f.type) && !/\.(mp4|webm|gif|mov|m4v)$/i.test(f.name)) return setErr('Yalnızca MP4, GIF veya WebM yükleyebilirsin.')
    if (f.size > MAX_BYTES) return setErr('Dosya çok büyük (en fazla 8 MB).')
    if (!/gif$/i.test(f.type + f.name)) {
      const d = await videoDuration(f)
      if (d != null && d > MAX_SECONDS) return setErr(`Video en fazla ${MAX_SECONDS} saniye olabilir (seçtiğin: ${d.toFixed(1)} sn).`)
    }
    setBusy(true)
    try {
      const r = await window.vt.invoke('api:upload', '/v1/cosmetics/custom-cape', { data: await f.arrayBuffer(), name: f.name, type: f.type || 'application/octet-stream' })
      if (r?.status === 200 && r.data?.ok) {
        setCape({ id: r.data.id, frames: r.data.frames, fps: r.data.fps, url: r.data.url, createdAt: Date.now() })
        onPreview(r.data.id)
        toast('Özel pelerin hazır. Giy düğmesiyle üzerine al.', 'ok')
      } else if (r?.networkError || !r?.status) setErr('Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.')
      else setErr(r.data?.error || `Yüklenemedi (hata ${r.status}).`)
    } catch { setErr('Dosya okunamadı.') } finally { setBusy(false) }
  }

  async function remove() {
    if (!cape || busy) return
    setBusy(true)
    const r = await window.vt.invoke('api:call', 'DELETE', '/v1/cosmetics/custom-cape', undefined, true)
    setBusy(false)
    if (r?.data?.ok) { if (worn === cape.id) onWear(null); onPreview(null); setCape(null); toast('Özel pelerin silindi.', 'ok') }
    else setErr(r?.data?.error || 'Silinemedi.')
  }

  const on = !!cape && worn === cape.id
  return (
    <div className="ccp">
      <div className="ccp-txt">
        <b><Icon name="sparkles" size={13} /> Özel pelerin</b>
        <span>MP4, GIF veya WebM · en fazla 8 sn · en fazla 8 MB</span>
        {err && <em className="ccp-err" role="alert">{err}</em>}
        {busy && <em className="ccp-busy"><i className="ccp-spin" /> Yükleniyor ve dönüştürülüyor…</em>}
      </div>
      <div className="ccp-btns">
        <input ref={file} type="file" hidden accept="video/mp4,video/webm,image/gif,.mp4,.webm,.gif" onChange={(e) => pick(e.target.files?.[0])} />
        {cape && <>
          <button className={on ? 'btn-outline' : 'btn-primary'} disabled={busy} onClick={() => { onPreview(null); onWear(on ? null : cape.id) }}>{on ? 'Çıkar' : 'Giy'}</button>
          <button className="btn-outline" disabled={busy} onClick={remove}>Sil</button>
        </>}
        <button className={cape ? 'btn-outline' : 'btn-primary'} disabled={busy || !signedIn} title={signedIn ? '' : 'Giriş yapmalısın'} onClick={() => file.current?.click()}>{cape ? 'Değiştir' : 'Dosya seç'}</button>
      </div>
    </div>
  )
}
