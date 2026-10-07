import React, { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Check, Globe, Hash, Mic, MessageCircle, Plus, Search, Settings as Cog, UserPlus, Users, X, Wifi, WifiOff } from 'lucide-react'
import { Head, useSocial, useSocialClient } from './react'
import { MessageList } from './Chat'
import { CreateRoom, MiniProfile, RoomCard, VoiceBar, useSpeaking } from './Rooms'
import { VoiceSettings } from './VoiceSettings'
import { RoleName } from './roles'

type Tab = 'rooms' | 'dms' | 'friends'

function ChatHeader({ channel, onProfile }: { channel: string; onProfile: (n: string, e: React.MouseEvent) => void }) {
  const c = useSocialClient()
  const s = useSocial()
  const room = channel.startsWith('room:') ? s.rooms.find((r) => r.id === channel.slice(5)) : null
  const speaking = useSpeaking(room || null)
  if (channel === 'global') return <div className="sx-chat-head"><span className="sx-ch-ico"><Globe size={18} /></span><div><b>Genel Sohbet</b><span>Herkesin yazabildiği sohbet · yavaş mod 3 sn</span></div></div>
  if (channel.startsWith('dm:')) {
    const n = channel.slice(3); const f = s.friends.find((x) => x.name.toLowerCase() === n.toLowerCase())
    return <div className="sx-chat-head"><Head name={n} size={34} onClick={(e) => onProfile(n, e)} /><div><b>{n}</b><span>{f ? (f.online ? f.status || 'Çevrimiçi' : 'Çevrimdışı') : 'Özel mesaj'}</span></div></div>
  }
  return (
    <div className="sx-chat-head">
      <span className="sx-ch-ico">{room?.icon && !/^[a-z]+$/i.test(room.icon) ? room.icon : <Hash size={18} />}</span>
      <div><b>{room?.name || 'Oda'}</b><span>Oda sohbeti{room ? ` · ${room.members.length} kişi` : ''}</span></div>
      <div className="sx-ch-heads">{room?.members.slice(0, 10).map((m) => <Head key={m.name} name={m.name} size={28} glow={speaking(m.name)} onClick={(e) => onProfile(m.name, e)} />)}</div>
    </div>
  )
}

export function FriendsTab({ onProfile }: { onProfile: (n: string, e: React.MouseEvent) => void }) {
  const c = useSocialClient()
  const s = useSocial()
  const [name, setName] = useState(''); const [msg, setMsg] = useState('')
  const add = async () => { const n = name.trim(); if (!n) return; const r = await c.friendAct('request', n); setMsg(r.ok ? 'İstek gönderildi.' : r.error || ''); if (r.ok) setName('') }
  const sorted = [...s.friends].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))
  return (
    <div className="sx-scroll">
      <div className="sx-addf"><div className="input sm"><Plus size={14} /><input maxLength={16} placeholder="Kullanıcı adıyla ekle" value={name} onChange={(e) => { setName(e.target.value); setMsg('') }} onKeyDown={(e) => e.key === 'Enter' && add()} /><button className="addf-go" onClick={add} disabled={!name.trim()}>Ekle</button></div>{msg && <small>{msg}</small>}</div>
      {s.incoming.length > 0 && <div className="sx-sec">İstekler</div>}
      {s.incoming.map((n) => (
        <div key={n} className="sx-row"><Head name={n} size={32} onClick={(e) => onProfile(n, e)} /><div className="sx-row-t"><b>{n}</b><span>Arkadaşlık isteği</span></div>
          <button className="icon-btn" title="Kabul et" onClick={() => c.friendAct('accept', n)}><Check size={15} /></button><button className="icon-btn" title="Reddet" onClick={() => c.friendAct('decline', n)}><X size={15} /></button></div>
      ))}
      <div className="sx-sec">Arkadaşlar · {s.friends.filter((f) => f.online).length} çevrimiçi</div>
      {!sorted.length && <p className="sx-hint">Henüz arkadaşın yok. Kullanıcı adıyla ekle.</p>}
      {sorted.map((f) => (
        <div key={f.name} className={'sx-row' + (f.online ? '' : ' off')} onClick={(e) => onProfile(f.name, e)}>
          <span className="sx-hwrap"><Head name={f.name} size={32} /><i className={'sx-dot' + (f.online ? ' on' : '')} /></span>
          <div className="sx-row-t"><RoleName name={f.name} /><span>{f.online ? f.status || 'Çevrimiçi' : 'Çevrimdışı'}</span></div>
          <button className="icon-btn" title="Mesaj" onClick={(e) => { e.stopPropagation(); c.openDm(f.name) }}><MessageCircle size={15} /></button>
        </div>
      ))}
    </div>
  )
}

export function SocialWindow() {
  const c = useSocialClient()
  const s = useSocial()
  const [tab, setTab] = useState<Tab>('rooms')
  const [create, setCreate] = useState(false)
  const [view, setView] = useState<'chat' | 'settings'>('chat')
  const [prof, setProf] = useState<{ name: string; x: number; y: number } | null>(null)
  const [drag, setDrag] = useState(false)
  const [q, setQ] = useState('')
  const [mounted, setMounted] = useState(false)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (s.windowOpen) { setMounted(true); setClosing(false) }
    else if (mounted) { setClosing(true); const t = setTimeout(() => { setMounted(false); setClosing(false) }, 220); return () => clearTimeout(t) }
  }, [s.windowOpen, mounted])
  useEffect(() => { if (s.windowOpen) { if (s.channel.startsWith('dm:')) setTab('dms'); setView('chat') } }, [s.windowOpen, s.channel])
  useEffect(() => {
    if (!s.windowOpen) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !create) { if (view === 'settings') setView('chat'); else c.closeWindow() } }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [s.windowOpen, create, view, c])

  const openProfile = useCallback((name: string, e: React.MouseEvent) => { e.stopPropagation(); setProf({ name, x: e.clientX + 6, y: e.clientY + 6 }) }, [])
  if (!mounted) return null
  const room = c.myRoom
  const rooms = s.rooms.filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => Number(b.id === s.myRoomId) - Number(a.id === s.myRoomId) || b.members.length - a.members.length)
  const dmUnread = s.dms.reduce((n, d) => n + (s.unread['dm:' + d.name] ?? d.unread ?? 0), 0)
  const online = s.status === 'online'
  const sel = (ch: string) => s.channel === ch

  return (
    <div className={'sx-overlay' + (closing ? ' closing' : '')} onMouseDown={() => c.closeWindow()}>
      <div className="sx-win" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Ses Odaları">
        <header className="sx-top">
          <div className="sx-title"><Mic size={18} /> <b>Ses Odaları</b><span className={'sx-conn' + (online ? ' on' : '')} title={online ? 'Bağlı' : 'Bağlantı yok'}>{online ? <Wifi size={13} /> : <WifiOff size={13} />}</span></div>
          <button className="btn-primary sx-create" onClick={() => setCreate(true)} disabled={!s.me}><Plus size={16} /> Oda Oluştur</button>
          <div className="sx-top-r">
            <button className={'icon-btn' + (view === 'settings' ? ' act' : '')} onClick={() => setView(view === 'settings' ? 'chat' : 'settings')} title="Ses ayarları" aria-label="Ses ayarları"><Cog size={16} /></button>
            <button className="icon-btn" onClick={() => c.closeWindow()} aria-label="Kapat"><X size={16} /></button>
          </div>
        </header>
        <div className="sx-body">
          <aside className="sx-left">
            <div className="tabs sm sx-tabs">
              <button className={tab === 'rooms' ? 'on' : ''} onClick={() => setTab('rooms')}><Mic size={13} /> Odalar</button>
              <button className={tab === 'dms' ? 'on' : ''} onClick={() => setTab('dms')}><MessageCircle size={13} /> Mesajlar{dmUnread > 0 && <b className="sx-badge">{dmUnread}</b>}</button>
              <button className={tab === 'friends' ? 'on' : ''} onClick={() => setTab('friends')}><Users size={13} /> Arkadaşlar{s.incoming.length > 0 && <b className="sx-badge">{s.incoming.length}</b>}</button>
            </div>
            {tab === 'rooms' && (
              <>
                <div className="sx-pins">
                  <button className={'sx-pin' + (sel('global') && view === 'chat' ? ' on' : '')} onClick={() => { c.setChannel('global'); setView('chat') }}><Globe size={16} /><b>Genel Sohbet</b>{s.unread.global ? <i className="sx-udot" /> : null}</button>
                  {room && <button className={'sx-pin' + (sel('room:' + room.id) && view === 'chat' ? ' on' : '')} onClick={() => { c.setChannel('room:' + room.id); setView('chat') }}><Hash size={16} /><b>{room.name}</b>{s.unread['room:' + room.id] ? <em className="sx-badge">{s.unread['room:' + room.id]}</em> : null}</button>}
                </div>
                <div className="sx-search input sm"><Search size={14} /><input placeholder="Oda ara" value={q} onChange={(e) => setQ(e.target.value)} /></div>
                <div className="sx-scroll sx-rooms">
                  {!rooms.length && <p className="sx-hint">{s.rooms.length ? 'Eşleşen oda yok.' : 'Henüz oda yok. İlk odayı sen oluştur!'}</p>}
                  {rooms.map((r) => <RoomCard key={r.id} room={r} onProfile={openProfile} onOpenRoomChat={() => { c.setChannel('room:' + r.id); setView('chat') }} />)}
                </div>
              </>
            )}
            {tab === 'dms' && (
              <div className="sx-scroll">
                {!s.dms.length && <p className="sx-hint">Henüz özel mesaj yok. Bir arkadaşına veya bir oyuncunun profiline tıklayıp mesaj gönder.</p>}
                {s.dms.map((d) => {
                  const n = s.unread['dm:' + d.name] ?? d.unread
                  return <div key={d.name} className={'sx-row' + (sel('dm:' + d.name) ? ' on' : '')} onClick={() => { c.setChannel('dm:' + d.name); setView('chat') }}><Head name={d.name} size={34} /><div className="sx-row-t"><b>{d.name}</b><span>{d.lastMessage || ' '}</span></div>{n ? <em className="sx-badge">{n}</em> : null}</div>
                })}
              </div>
            )}
            {tab === 'friends' && <FriendsTab onProfile={openProfile} />}
            {room && <VoiceBar compact onSettings={() => setView('settings')} />}
          </aside>
          <main className={'sx-chat' + (drag ? ' drag' : '')}
            onDragOver={(e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setDrag(true) } }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false) }}
            onDrop={(e) => { e.preventDefault(); setDrag(false); window.dispatchEvent(new CustomEvent('sx-drop', { detail: { files: e.dataTransfer.files } })) }}>
            {view === 'settings' ? (
              <>
                <div className="sx-chat-head"><button className="icon-btn" onClick={() => setView('chat')} aria-label="Geri"><ArrowLeft size={16} /></button><div><b>Ses Ayarları</b><span>Cihazlar, bas-konuş ve kısayollar</span></div></div>
                <div className="sx-scroll sx-settings"><VoiceSettings /></div>
              </>
            ) : (
              <>
                <ChatHeader channel={s.channel} onProfile={openProfile} />
                {s.me ? <MessageList key={s.channel} channel={s.channel} onProfile={openProfile} /> : <div className="sx-empty-chat">Sohbet için VanillaTurkey hesabıyla giriş yapmalısın.</div>}
                {drag && <div className="sx-dropzone"><UserPlus size={0} />Fotoğrafı bırak</div>}
              </>
            )}
          </main>
        </div>
        {create && <CreateRoom onClose={() => setCreate(false)} />}
        {prof && <MiniProfile name={prof.name} x={prof.x} y={prof.y} onClose={() => setProf(null)} onDm={(n) => { c.openDm(n); setTab('dms') }} />}
      </div>
    </div>
  )
}
