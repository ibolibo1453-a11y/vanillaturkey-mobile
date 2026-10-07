import React, { useRef, useState } from 'react'
import { useApp } from '../store'
import { Icon } from '../components/ui'
import { SkinStage } from '../components/SkinStage'
import { invalidateHead } from '../social'

export function SkinEditor() {
  const { settings, setSetting, skin: current, account, toast } = useApp()
  const [skin, setSkin] = useState('')
  const [slim, setSlim] = useState(!!(settings as any).skinSlim)
  const [name, setName] = useState(settings.skinName)
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const shown = skin || current

  const readFile = (f: File) => {
    if (!/\.png$/i.test(f.name) && f.type !== 'image/png') return toast('Yalnızca PNG skin yüklenebilir.', 'err')
    const r = new FileReader()
    r.onload = () => {
      const url = String(r.result); const img = new Image()
      img.onload = () => { if (img.width !== 64 || (img.height !== 64 && img.height !== 32)) toast('Skin 64x64 veya 64x32 olmalı.', 'err'); else { setSkin(url); toast('Skin yüklendi. Uygulamak için kaydet.') } }
      img.src = url
    }
    r.readAsDataURL(f)
  }
  async function byName() {
    if (!name.trim()) return
    const d = await window.vt.invoke('skin:get', name.trim())
    if (d) { setSkin(d); toast(name.trim() + ' kullanıcısının skini getirildi.') } else toast('Bu isimde skin bulunamadı.', 'err')
  }
  const [busy, setBusy] = useState(false)
  async function save() {
    const data = skin || settings.customSkin
    setSetting({ customSkin: data, skinName: name, skinSlim: slim })
    if (account?.offline || !data) { toast('Skin kaydedildi (yalnızca bu bilgisayarda; çevrimdışı hesap).'); return }
    setBusy(true)
    const r = await window.vt.invoke('skin:upload', data, slim)
    setBusy(false)
    if (r.ok) {
      if (account) { invalidateHead(null, account.username); window.vt.invoke('bridge:send', null, { t: 'skin_upd', name: account.username, hash: String(Date.now()) }) }
      setSkin(''); toast('Skin sunucuya yüklendi: herkes yeni skinini görecek.')
    } else toast(r.error || 'Skin yüklenemedi.', 'err')
  }
  async function reset() {
    const r = await window.vt.invoke('skin:reset'); setSetting({ customSkin: '' }); setSkin('')
    if (account) { invalidateHead(null, account.username); window.vt.invoke('bridge:send', null, { t: 'skin_upd', name: account.username, hash: String(Date.now()) }) }
    toast(r.ok ? 'Skin varsayılana döndü.' : 'Yerel skin temizlendi.')
  }

  return (
    <div className="skinpage">
      <section className="card skin-view">
        <div className="skin-view-top">
          <span className="micro">Mevcut skin · {account?.username}</span>
          <div className="seg"><button className={!slim ? 'on' : ''} onClick={() => setSlim(false)}>Steve</button><button className={slim ? 'on' : ''} onClick={() => setSlim(true)}>Slim (Alex)</button></div>
        </div>
        <SkinStage skin={shown} slim={slim} className="panel" />
        <div className="stage-hint">Sürükleyerek döndür</div>
      </section>
      <section className="skin-right">
        <div className={'dropzone' + (drag ? ' over' : '')} onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) readFile(f) }} onClick={() => fileRef.current?.click()}>
          <div className="dz-ico"><Icon name="upload" size={34} /></div>
          <b>PNG Skin Yükle</b>
          <span>64×64 veya 64×32 PNG sürükle bırak</span>
          <em>ya da tıkla seç</em>
          <input ref={fileRef} type="file" accept="image/png" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = '' }} />
        </div>
        <div className="card byname">
          <span className="micro">Kullanıcı adından skin al</span>
          <div className="byname-row">
            <div className="input lg"><Icon name="user" size={18} /><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Oyuncu adı" onKeyDown={(e) => e.key === 'Enter' && byName()} spellCheck={false} /></div>
            <button className="btn-outline lg" onClick={byName}>Getir</button>
          </div>
        </div>
        <button className="btn-primary lg" onClick={save} disabled={busy}>{busy ? <i className="spin" /> : null} Skini kaydet ve uygula</button>
        <button className="btn-ghost sm" onClick={reset}>Skini varsayılana döndür</button>
        <p className="muted">Skinin VanillaTurkey sunucusuna yüklenir: launcher, oyun ve sohbette herkes aynı skini görür. Hiç skin yüklemezsen Mojang skinin (varsa) kullanılır.</p>
      </section>
    </div>
  )
}
