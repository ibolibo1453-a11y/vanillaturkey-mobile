import React, { useState } from 'react'
import { Send, X, MessageCircle, UserPlus, Users, Info, ChevronUp } from 'lucide-react'
import { Head, useSocial, useSocialClient } from './react'
import type { ToastItem } from './types'
import { VoiceBar } from './Rooms'

function Toast({ t }: { t: ToastItem }) {
  const c = useSocialClient()
  const [text, setText] = useState(''); const [sent, setSent] = useState(false)
  const canReply = t.kind === 'dm' || t.kind === 'room'
  const open = () => { c.dismissToast(t.id); c.openWindow(t.channel === 'friends' ? undefined : t.channel) }
  const reply = async () => { const v = text.trim(); if (!v) return; const ok = await c.send(t.channel, { text: v }); if (ok) { setSent(true); setText(''); setTimeout(() => c.dismissToast(t.id), 900) } }
  return (
    <div className={'sx-toast ' + t.kind}>
      <div className="sx-toast-main" onClick={open}>
        {t.from ? <Head name={t.from} size={40} /> : <span className="sx-toast-ico">{t.kind === 'info' ? <Info size={20} /> : <Users size={20} />}</span>}
        <div className="sx-toast-t"><b>{t.title}</b><span>{t.body}</span></div>
        <button className="sx-toast-x" onClick={(e) => { e.stopPropagation(); c.dismissToast(t.id) }} aria-label="Kapat"><X size={14} /></button>
      </div>
      {t.kind === 'friend' && <div className="sx-toast-reply"><button className="btn-primary sm" onClick={(e) => { e.stopPropagation(); c.friendAct('accept', t.from || t.title); c.dismissToast(t.id) }}><UserPlus size={14} /> Kabul et</button><button className="btn-glass sm" onClick={open}>Görüntüle</button></div>}
      {canReply && (
        <div className="sx-toast-reply">
          <input value={text} placeholder={sent ? 'Gönderildi' : 'Hızlı yanıt…'} disabled={sent} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') reply() }} />
          <button onClick={reply} disabled={!text.trim() || sent} aria-label="Gönder"><Send size={15} /></button>
        </div>
      )}
    </div>
  )
}

export function ToastStack() {
  const s = useSocial()
  if (!s.toasts.length) return null
  return <div className="sx-toasts">{s.toasts.map((t) => <Toast key={t.id} t={t} />)}</div>
}

/** Floating voice controls shown over the launcher while you are in a room and the Ses Odaları window is closed. */
export function VoiceDock() {
  const c = useSocialClient()
  const s = useSocial()
  if (!s.myRoomId || s.windowOpen) return null
  return (
    <div className="sx-dock">
      <VoiceBar compact />
      <button className="sx-dock-open" onClick={() => c.openWindow('room:' + s.myRoomId)} title="Sohbeti aç"><ChevronUp size={16} /> <MessageCircle size={15} /></button>
    </div>
  )
}
