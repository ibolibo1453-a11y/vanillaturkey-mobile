import React, { useEffect, useRef, useState } from 'react'
import { Headphones, HeadphoneOff, Lock, LogOut, Mic, MicOff, MessageCircle, Plus, Signal, SignalLow, SignalMedium, Users, UserPlus, UserCheck, Volume2, VolumeX, X, Globe, Settings as Cog, Crown, UserMinus } from 'lucide-react'
import { Head, useSocial, useSocialClient } from './react'
import type { Room } from './types'
import { Slider } from './bits'
import { RoleChip, RoleName, useRole } from './roles'

const ICONS = ['💬', '🎮', '⚔️', '🏹', '💎', '🏰', '🐺', '🔥', '🎵', '🌲', '🚀', '👑']
const accessIcon = (a: string) => (a === 'password' ? <Lock size={13} /> : a === 'friends' ? <Users size={13} /> : <Globe size={13} />)
const accessLabel = (a: string) => (a === 'password' ? 'Şifreli' : a === 'friends' ? 'Sadece arkadaşlar' : 'Herkese açık')

export function useSpeaking(room: Room | null): (name: string) => boolean {
  const s = useSocial()
  return (name: string) => {
    if (!room || room.id !== s.myRoomId) return !!room?.members.find((m) => m.name === name)?.speaking
    return name.toLowerCase() === s.me.toLowerCase() ? s.voice.selfSpeaking : s.voice.speaking.includes(name)
  }
}

export function RoomCard({ room, onProfile, onOpenRoomChat }: { room: Room; onProfile: (n: string, e: React.MouseEvent) => void; onOpenRoomChat: () => void }) {
  const c = useSocialClient()
  const s = useSocial()
  const mine = s.myRoomId === room.id
  const speaking = useSpeaking(room)
  const [pw, setPw] = useState(''); const [askPw, setAskPw] = useState(false); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const join = async () => {
    if (room.access === 'password' && !askPw && !mine) { setAskPw(true); return }
    setBusy(true); setErr('')
    const r = await c.joinRoom(room.id, room.access === 'password' ? pw : undefined)
    setBusy(false)
    if (!r.ok) setErr(r.error || 'Katılınamadı.'); else { setAskPw(false); setPw('') }
  }
  const full = room.members.length >= room.max
  return (
    <div className={'sx-room' + (mine ? ' mine' : '') + (room.members.some((m) => speaking(m.name)) ? ' live' : '')}>
      <div className="sx-room-top" onClick={mine ? onOpenRoomChat : undefined}>
        <span className="sx-room-ico">{room.icon && !/^[a-z]+$/i.test(room.icon) ? room.icon : <Users size={18} />}</span>
        <div className="sx-room-name"><b>{room.name}</b><span>{accessIcon(room.access)} {accessLabel(room.access)} · {room.members.length}/{room.max}</span></div>
        {mine
          ? <button className="sx-leave" onClick={(e) => { e.stopPropagation(); c.leaveRoom() }}><LogOut size={14} /> Ayrıl</button>
          : <button className="sx-join" onClick={join} disabled={busy || full}>{busy ? <i className="spin" /> : full ? 'Dolu' : 'Katıl'}</button>}
      </div>
      {room.members.length > 0 && (
        <div className="sx-heads">
          {room.members.slice(0, 8).map((m) => {
            const rv = mine ? s.voice.remote[m.name] : undefined
            return (
              <span key={m.name} className={'sx-hwrap' + (speaking(m.name) ? ' speaking' : '')} onClick={(e) => onProfile(m.name, e)} title={m.name}>
                <Head name={m.name} size={28} glow={speaking(m.name)} />
                {(rv?.muted || rv?.deafened) && <i className="sx-hbadge"><MicOff size={9} /></i>}
              </span>
            )
          })}
          {room.members.length > 8 && <span className="sx-more">+{room.members.length - 8}</span>}
        </div>
      )}
      {askPw && !mine && (
        <div className="sx-pw"><div className="input sm"><Lock size={14} /><input autoFocus type="password" placeholder="Oda şifresi" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && join()} /></div><button className="btn-primary sm" onClick={join}>Gir</button></div>
      )}
      {err && <div className="sx-err">{err}</div>}
    </div>
  )
}

export function CreateRoom({ onClose }: { onClose: () => void }) {
  const c = useSocialClient()
  const [name, setName] = useState('')
  const [access, setAccess] = useState<'public' | 'friends' | 'password'>('public')
  const [pw, setPw] = useState('')
  const [icon, setIcon] = useState('💬')
  const [max, setMax] = useState(10)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const ok = name.trim().length >= 3 && (access !== 'password' || pw.length >= 3)
  const go = async () => {
    if (!ok || busy) return
    setBusy(true); setErr('')
    const r = await c.createRoom({ name: name.trim(), access, password: access === 'password' ? pw : undefined, icon, max })
    setBusy(false)
    if (r.ok) onClose(); else setErr(r.error || 'Oda oluşturulamadı.')
  }
  return (
    <div className="sx-modal-bg" onMouseDown={onClose}>
      <div className="sx-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sx-modal-head"><h2>Oda Oluştur</h2><button className="icon-btn" onClick={onClose} aria-label="Kapat"><X size={16} /></button></div>
        <label className="field"><span>Oda adı</span><div className="input"><input autoFocus maxLength={32} placeholder="Örn. Gece Sohbeti" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} /></div></label>
        <div className="field"><span>Erişim</span>
          <div className="seg sx-seg">
            <button className={access === 'public' ? 'on' : ''} onClick={() => setAccess('public')}><Globe size={14} /> Herkes</button>
            <button className={access === 'friends' ? 'on' : ''} onClick={() => setAccess('friends')}><Users size={14} /> Sadece arkadaşlar</button>
            <button className={access === 'password' ? 'on' : ''} onClick={() => setAccess('password')}><Lock size={14} /> Şifreli</button>
          </div>
        </div>
        {access === 'password' && <label className="field"><span>Şifre</span><div className="input"><Lock size={15} /><input type="password" maxLength={32} placeholder="En az 3 karakter" value={pw} onChange={(e) => setPw(e.target.value)} /></div></label>}
        <div className="field"><span>Simge</span>
          <div className="sx-icons">{ICONS.map((i) => <button key={i} className={icon === i ? 'on' : ''} onClick={() => setIcon(i)}>{i}</button>)}</div>
        </div>
        <div className="field"><span>En fazla kişi</span><Slider value={max} min={2} max={50} onChange={setMax} suffix=" kişi" /></div>
        {err && <div className="form-err">{err}</div>}
        <div className="modal-btns"><button className="btn-glass" onClick={onClose}>Vazgeç</button><button className="btn-primary" onClick={go} disabled={!ok || busy}>{busy ? <i className="spin" /> : <Plus size={16} />} Oluştur ve katıl</button></div>
      </div>
    </div>
  )
}

export function MiniProfile({ name, x, y, onClose, onDm }: { name: string; x: number; y: number; onClose: () => void; onDm: (n: string) => void }) {
  const c = useSocialClient()
  const s = useSocial()
  const ref = useRef<HTMLDivElement>(null)
  const [msg, setMsg] = useState('')
  const [pos, setPos] = useState({ left: x, top: y })
  useEffect(() => {
    const r = ref.current; if (r) setPos({ left: Math.max(8, Math.min(x, window.innerWidth - r.offsetWidth - 8)), top: Math.max(8, Math.min(y, window.innerHeight - r.offsetHeight - 8)) })
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    const t = setTimeout(() => { window.addEventListener('mousedown', h); window.addEventListener('keydown', k, true) }, 0)
    return () => { clearTimeout(t); window.removeEventListener('mousedown', h); window.removeEventListener('keydown', k, true) }
  }, [x, y, onClose])
  const self = name.toLowerCase() === s.me.toLowerCase()
  const friend = s.friends.find((f) => f.name.toLowerCase() === name.toLowerCase())
  const pending = s.outgoing.some((n) => n.toLowerCase() === name.toLowerCase())
  const incoming = s.incoming.some((n) => n.toLowerCase() === name.toLowerCase())
  const room = c.myRoom
  const inMyRoom = !!room?.members.some((m) => m.name.toLowerCase() === name.toLowerCase())
  const localMuted = s.prefs.mutedUsers.some((u) => u.toLowerCase() === name.toLowerCase())
  const prRole = useRole(name)
  const vol = s.prefs.userVolumes[name] ?? 100
  const rv = s.voice.remote[name]
  const act = async (a: 'request' | 'accept') => { const r = await c.friendAct(a, name); setMsg(r.ok ? (a === 'request' ? 'İstek gönderildi.' : 'Arkadaş oldunuz.') : r.error || '') }
  return (
    <div className="sx-profile" ref={ref} style={pos}>
      <div className="sx-pf-top"><Head name={name} size={64} /><div><RoleName name={name} /><span className={'sx-pf-st' + (friend?.online ? ' on' : '')}>{self ? 'Sen' : friend ? (friend.online ? friend.status || 'Çevrimiçi' : 'Çevrimdışı') : inMyRoom ? 'Odanda' : 'Oyuncu'}</span><RoleChip role={prRole} /></div></div>
      {!self && (
        <div className="sx-pf-btns">
          <button className="btn-primary sm" onClick={() => { onDm(name); onClose() }}><MessageCircle size={15} /> Mesaj gönder</button>
          {friend ? <button className="btn-glass sm" disabled><UserCheck size={15} /> Arkadaş</button>
            : incoming ? <button className="btn-glass sm" onClick={() => act('accept')}><UserPlus size={15} /> İsteği kabul et</button>
            : <button className="btn-glass sm" onClick={() => act('request')} disabled={pending}><UserPlus size={15} /> {pending ? 'İstek gönderildi' : 'Arkadaş ekle'}</button>}
          <button className={'btn-glass sm' + (localMuted ? ' warn' : '')} onClick={() => c.toggleLocalMute(name)}>{localMuted ? <><Volume2 size={15} /> Susturmayı kaldır</> : <><VolumeX size={15} /> Sustur</>}</button>
        </div>
      )}
      {!self && inMyRoom && (
        <div className="sx-pf-vol"><span>Ses seviyesi</span><Slider value={vol} min={0} max={100} onChange={(v) => c.setUserVolume(name, v)} />{rv && <small>{rv.muted ? 'Mikrofonu kapalı' : rv.deafened ? 'Sesi kapalı' : 'Bağlı'}</small>}</div>
      )}
      {!self && room && room.owner.toLowerCase() === s.me.toLowerCase() && inMyRoom && <button className="btn-danger sm sx-kick" onClick={() => { c.kick(room.id, name); onClose() }}><UserMinus size={14} /> Odadan at</button>}
      {msg && <div className="sx-pf-msg">{msg}</div>}
    </div>
  )
}

const QIcon = ({ q }: { q: string }) => (q === 'excellent' || q === 'good' ? <Signal size={14} /> : q === 'poor' ? <SignalMedium size={14} /> : q === 'lost' ? <SignalLow size={14} /> : <Signal size={14} />)
export function VoiceBar({ compact, onSettings }: { compact?: boolean; onSettings?: () => void }) {
  const c = useSocialClient()
  const s = useSocial()
  const room = c.myRoom
  if (!s.myRoomId) return null
  const v = s.voice
  const status = v.status === 'connected' ? 'Ses bağlı' : v.status === 'connecting' ? 'Bağlanıyor…' : v.status === 'reconnecting' ? 'Yeniden bağlanıyor…' : v.status === 'error' ? 'Ses hatası' : ''
  return (
    <div className={'sx-voicebar' + (compact ? ' compact' : '') + (v.selfSpeaking ? ' speaking' : '') + ' ' + v.status}>
      <div className="sx-vb-info"><span className={'sx-q ' + v.selfQuality}><QIcon q={v.selfQuality} /></span><div><b>{room?.name || 'Oda'}</b><span>{status}{v.error && v.status !== 'connected' ? ' · ' + v.error : ''}</span></div></div>
      <div className="sx-vb-btns">
        <button className={'sx-vbtn' + (v.muted ? ' off' : '')} onClick={() => c.toggleMute()} title={v.muted ? 'Mikrofonu aç' : 'Mikrofonu kapat'}>{v.muted ? <MicOff size={17} /> : <Mic size={17} />}</button>
        <button className={'sx-vbtn' + (v.deafened ? ' off' : '')} onClick={() => c.toggleDeafen()} title={v.deafened ? 'Sesi aç' : 'Sesi kapat (sağır)'}>{v.deafened ? <HeadphoneOff size={17} /> : <Headphones size={17} />}</button>
        {onSettings && <button className="sx-vbtn" onClick={onSettings} title="Ses ayarları"><Cog size={17} /></button>}
        <button className="sx-vbtn leave" onClick={() => c.leaveRoom()} title="Odadan ayrıl"><LogOut size={17} /></button>
      </div>
      {!v.micOk && v.status === 'connected' && <div className="sx-vb-warn">{v.error}</div>}
    </div>
  )
}
