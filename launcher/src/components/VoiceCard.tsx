import React from 'react'
import { Mic, MicOff, Headphones, HeadphoneOff, LogOut, Users, Globe, Lock } from 'lucide-react'
import { Head, useSocial, useSocialMaybe } from '../social'
import type { SocialClient } from '../social'
import { Icon } from './ui'
import { SignInPrompt } from './SignInPrompt'

/** Home card "Ses Odaları": live room count, your room + member heads, Katıl. Click opens the Ses Odaları window. */
export function VoiceRoomsCard() {
  const c = useSocialMaybe()
  if (!c) return <div className="card voice-card skel"><div className="card-head"><span className="micro">Ses Odaları</span></div></div>
  return <Inner c={c} />
}

function Inner({ c }: { c: SocialClient }) {
  const s = useSocial()
  const room = c.myRoom
  const people = s.rooms.reduce((n, r) => n + r.members.length, 0)
  const top = s.rooms.filter((r) => r.id !== s.myRoomId).sort((a, b) => b.members.length - a.members.length).slice(0, 2)
  const speaking = (n: string) => (n.toLowerCase() === s.me.toLowerCase() ? s.voice.selfSpeaking : s.voice.speaking.includes(n))
  const off = !s.me
  return (
    <div className={'card voice-card' + (room ? ' in' : '')} role="button" tabIndex={0} onClick={() => c.openWindow()} onKeyDown={(e) => e.key === 'Enter' && c.openWindow()}>
      <div className="card-head">
        <span className="micro">Ses Odaları</span>
        <span className="vc-live"><i className={s.status === 'online' ? 'on' : ''} />{off ? 'Çevrimdışı' : s.status === 'online' ? `${s.rooms.length} oda · ${people} kişi` : 'Bağlanıyor…'}</span>
      </div>
      {off ? <SignInPrompt msg="Ses odaları ve sohbet için VanillaTurkey hesabı gerekiyor. Çevrimdışı/Microsoft girişinde kapalı." /> : room ? (
        <>
          <div className="vc-room"><span className="vc-ico">{room.icon && !/^[a-z]+$/i.test(room.icon) ? room.icon : <Users size={16} />}</span><div><b>{room.name}</b><span>{s.voice.status === 'connected' ? 'Bağlı' : s.voice.status === 'error' ? 'Ses hatası' : 'Bağlanıyor…'} · {room.members.length} kişi</span></div></div>
          <div className="vc-heads">{room.members.slice(0, 7).map((m) => <Head key={m.name} name={m.name} size={30} glow={speaking(m.name)} />)}{room.members.length > 7 && <span>+{room.members.length - 7}</span>}</div>
          <div className="vc-btns" onClick={(e) => e.stopPropagation()}>
            <button className={'vc-b' + (s.voice.muted ? ' off' : '')} onClick={() => c.toggleMute()} title="Mikrofon">{s.voice.muted ? <MicOff size={16} /> : <Mic size={16} />}</button>
            <button className={'vc-b' + (s.voice.deafened ? ' off' : '')} onClick={() => c.toggleDeafen()} title="Ses">{s.voice.deafened ? <HeadphoneOff size={16} /> : <Headphones size={16} />}</button>
            <button className="vc-b leave" onClick={() => c.leaveRoom()} title="Ayrıl"><LogOut size={16} /></button>
          </div>
        </>
      ) : (
        <>
          <div className="vc-list">
            {top.length === 0 && <p className="friends-empty">Şu an açık oda yok. İlk odayı sen oluştur.</p>}
            {top.map((r) => (
              <div key={r.id} className="gcard vc-item" onClick={(e) => e.stopPropagation()}>
                <span className="vc-ico">{r.icon && !/^[a-z]+$/i.test(r.icon) ? r.icon : <Users size={15} />}</span>
                <div className="vc-t"><b>{r.name}</b><span>{r.access === 'password' ? <Lock size={11} /> : <Globe size={11} />} {r.members.length}/{r.max}</span></div>
                <div className="vc-mini">{r.members.slice(0, 3).map((m) => <Head key={m.name} name={m.name} size={20} />)}</div>
                <button className="vc-join" onClick={() => (r.access === 'password' ? c.openWindow() : c.joinRoom(r.id))}>Katıl</button>
              </div>
            ))}
          </div>
          <button className="btn-primary sm vc-open" onClick={(e) => { e.stopPropagation(); c.openWindow() }}><Icon name="users" size={15} /> Ses Odalarını Aç</button>
        </>
      )}
    </div>
  )
}
