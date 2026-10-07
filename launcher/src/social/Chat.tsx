import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Image as ImageIcon, Reply, Send, Smile, SmilePlus, Trash2, X, Loader2 } from 'lucide-react'
import { Head, useSocial, useSocialClient } from './react'
import { RoleName } from './roles'
import type { Message } from './types'
import { AudioMessage } from './AudioMessage'
import { RecordButton } from './Recorder'
import { EmojiPicker, Lightbox, Photo, QUICK_REACTIONS, fmtDay, fmtTime } from './bits'

const replyId = (m: Message) => (m.replyTo ? (typeof m.replyTo === 'string' ? m.replyTo : m.replyTo.id) : '')
const URL_RE = /(https?:\/\/[^\s<]+)/g

function Text({ text }: { text: string }) {
  const c = useSocialClient()
  const parts = text.split(URL_RE)
  return <>{parts.map((p, i) => (i % 2 ? <a key={i} className="sx-link" onClick={(e) => { e.preventDefault(); c.a.openExternal?.(p) }} href={p}>{p}</a> : <React.Fragment key={i}>{p}</React.Fragment>))}</>
}

export interface RowProps { m: Message; compact: boolean; byId: Map<string, Message>; canDelete: boolean; me: string; onProfile: (n: string, e: React.MouseEvent) => void; onReply: (m: Message) => void; onImage: (u: string) => void; ch: string }
export const Row = React.memo(function Row({ m, compact, byId, canDelete, me, onProfile, onReply, onImage, ch }: RowProps) {
  const c = useSocialClient()
  const [picker, setPicker] = useState(false)
  const rid = replyId(m)
  const ref = rid ? byId.get(rid) : undefined
  const refObj = typeof m.replyTo === 'object' && m.replyTo ? m.replyTo : undefined
  const rAuthor = ref?.author || refObj?.author, rText = ref ? (ref.text || (ref.attachment?.kind === 'audio' ? 'Sesli mesaj' : 'Fotoğraf')) : refObj?.text
  const mine = m.author.toLowerCase() === me.toLowerCase()
  return (
    <div className={'sx-msg' + (compact ? ' compact' : '') + (mine ? ' mine' : '') + (m.pending ? ' pending' : '')} data-id={m.id}>
      <div className="sx-msg-side">{compact ? <span className="sx-hover-time">{fmtTime(m.createdAt)}</span> : <Head name={m.author} size={38} onClick={(e) => onProfile(m.author, e)} />}</div>
      <div className="sx-msg-main">
        {!compact && <div className="sx-msg-head"><RoleName name={m.author} className="sx-author" onClick={(e) => onProfile(m.author, e)} /><span>{fmtTime(m.createdAt)}</span></div>}
        {rid && (rAuthor || rText) && <div className="sx-quote"><Reply size={12} /><b>{rAuthor}</b><span>{(rText || '').slice(0, 90)}</span></div>}
        {m.text && <div className="sx-text"><Text text={m.text} /></div>}
        {m.attachment?.kind === 'image' && <Photo thumb={m.attachment.thumbUrl || m.attachment.url} full={m.attachment.url} onOpen={onImage} />}
        {m.attachment?.kind === 'audio' && <AudioMessage url={m.attachment.url} durationMs={m.attachment.durationMs} id={m.id} />}
        {Object.keys(m.reactions).length > 0 && (
          <div className="sx-reacts">{Object.entries(m.reactions).map(([e, names]) => (
            <button key={e} className={names.some((n) => n.toLowerCase() === me.toLowerCase()) ? 'me' : ''} title={names.join(', ')} onClick={() => c.react(ch, m.id, e)}>{e} <i>{names.length}</i></button>
          ))}</div>
        )}
      </div>
      {!m.pending && (
        <div className="sx-tools">
          {QUICK_REACTIONS.slice(0, 3).map((e) => <button key={e} onClick={() => c.react(ch, m.id, e)}>{e}</button>)}
          <button onClick={() => setPicker(!picker)} title="Tepki"><SmilePlus size={15} /></button>
          <button onClick={() => onReply(m)} title="Yanıtla"><Reply size={15} /></button>
          {(mine || canDelete) && <button onClick={() => c.deleteMessage(ch, m.id)} title="Sil"><Trash2 size={15} /></button>}
          {picker && <div className="sx-pick-pop"><EmojiPicker onPick={(e) => { c.react(ch, m.id, e); setPicker(false) }} onClose={() => setPicker(false)} /></div>}
        </div>
      )}
    </div>
  )
})

export function MessageList({ channel, onProfile }: { channel: string; onProfile: (n: string, e: React.MouseEvent) => void }) {
  const c = useSocialClient()
  const s = useSocial()
  const d = c.chan(channel)
  void s.ver
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const prevH = useRef(0)
  const prevLen = useRef(0)
  const [lb, setLb] = useState('')
  const [replying, setReplying] = useState<Message | null>(null)
  const byId = useMemo(() => new Map(d.list.map((m) => [m.id, m])), [d.list])
  const canDelete = c.isAdmin()

  useLayoutEffect(() => {
    const el = box.current; if (!el) return
    if (prevLen.current && d.list.length && d.list[0] && el.scrollTop < 120 && el.scrollHeight > prevH.current && !stick.current) el.scrollTop += el.scrollHeight - prevH.current // history prepended
    else if (stick.current) el.scrollTop = el.scrollHeight
    prevH.current = el.scrollHeight; prevLen.current = d.list.length
  }, [d.list, d.loading, s.typing])
  useEffect(() => { stick.current = true; prevLen.current = 0 }, [channel])
  useEffect(() => { const el = box.current; if (el && stick.current) requestAnimationFrame(() => (el.scrollTop = el.scrollHeight)) }, [d.loaded, channel])

  const onScroll = () => {
    const el = box.current!; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90
    if (el.scrollTop < 80 && d.hasMore && !d.loading && d.loaded) { prevH.current = el.scrollHeight; c.loadMore(channel) }
    if (stick.current && (s.unread[channel] || 0) > 0) c.markRead(channel)
  }
  const typers = c.typingNames(channel)
  const rows: React.ReactNode[] = []
  d.list.forEach((m, i) => {
    const p = d.list[i - 1]
    const newDay = !p || new Date(p.createdAt).toDateString() !== new Date(m.createdAt).toDateString()
    if (newDay) rows.push(<div key={'d' + m.id} className="sx-day"><span>{fmtDay(m.createdAt)}</span></div>)
    const compact = !newDay && !!p && p.author === m.author && m.createdAt - p.createdAt < 5 * 60e3 && !replyId(m)
    rows.push(<Row key={m.tempId || m.id} m={m} compact={compact} byId={byId} canDelete={canDelete} me={s.me} onProfile={onProfile} onReply={setReplying} onImage={setLb} ch={channel} />)
  })
  return (
    <>
      <div className="sx-list" ref={box} onScroll={onScroll}>
        {d.loading && <div className="sx-loading"><Loader2 size={16} className="sx-spin" /> Yükleniyor…</div>}
        {!d.hasMore && d.loaded && <div className="sx-start">Sohbetin başlangıcı</div>}
        {d.loaded && !d.list.length && <div className="sx-empty-chat">Henüz mesaj yok. İlk mesajı sen yaz!</div>}
        {!d.loaded && !d.loading && <div className="sx-loading">Yükleniyor…</div>}
        {rows}
        <div className="sx-typing">{typers.length > 0 && <><span className="sx-dots"><i /><i /><i /></span> {typers.slice(0, 3).join(', ')} yazıyor…</>}</div>
      </div>
      <Composer channel={channel} replying={replying} onCancelReply={() => setReplying(null)} onSent={() => { stick.current = true; setReplying(null) }} />
      {lb && <Lightbox src={lb} onClose={() => setLb('')} />}
    </>
  )
}

export function Composer({ channel, replying, onCancelReply, onSent }: { channel: string; replying: Message | null; onCancelReply: () => void; onSent: () => void }) {
  const c = useSocialClient()
  const s = useSocial()
  const [text, setText] = useState('')
  const [emoji, setEmoji] = useState(false)
  const [img, setImg] = useState<{ file: File; url: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const muted = s.sanction?.kind === 'mute'

  useEffect(() => { setText(''); setImg(null) }, [channel])
  useEffect(() => { ta.current?.focus() }, [channel, replying])
  useEffect(() => () => { if (img) URL.revokeObjectURL(img.url) }, [img])

  const pickImage = useCallback((f: File | undefined | null) => {
    if (!f) return
    if (!f.type.startsWith('image/')) { c.notice('Yalnızca fotoğraf yüklenebilir.'); return }
    if (f.size > 5 * 1048576) { c.notice('Fotoğraf en fazla 5 MB olabilir.'); return }
    setImg((old) => { if (old) URL.revokeObjectURL(old.url); return { file: f, url: URL.createObjectURL(f) } })
  }, [c])
  // global paste / drop on the chat pane (listeners live on the document while this composer is mounted)
  useEffect(() => {
    const paste = (e: ClipboardEvent) => { const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/')); if (f) { e.preventDefault(); pickImage(f) } }
    window.addEventListener('paste', paste); return () => window.removeEventListener('paste', paste)
  }, [pickImage])
  useEffect(() => {
    const onDrop = (e: Event) => { const f = [...((e as CustomEvent).detail?.files || [])].find((x: File) => x.type.startsWith('image/')); if (f) pickImage(f) }
    window.addEventListener('sx-drop', onDrop); return () => window.removeEventListener('sx-drop', onDrop)
  }, [pickImage])

  const send = async () => {
    if (busy) return
    const t = text.trim()
    if (!t && !img) return
    setBusy(true)
    let ok: boolean
    if (img) ok = await c.uploadAndSend(channel, await img.file.arrayBuffer(), img.file.name || 'photo.png', img.file.type || 'image/png', t, replying?.id)
    else ok = await c.send(channel, { text: t, replyTo: replying?.id })
    setBusy(false)
    if (ok) { setText(''); setImg(null); onSent(); if (ta.current) ta.current.style.height = '' }
  }
  const sendVoice = async (blob: Blob, ms: number) => {
    setBusy(true)
    const ok = await c.uploadAndSend(channel, await blob.arrayBuffer(), 'voice.webm', blob.type || 'audio/webm', '', replying?.id)
    void ms; setBusy(false); if (ok) onSent()
  }
  return (
    <div className="sx-composer">
      {s.notice && <div className="sx-notice">{s.notice}</div>}
      {replying && <div className="sx-replybar"><Reply size={14} /> <b>{replying.author}</b> kişisine yanıt: <span>{(replying.text || (replying.attachment?.kind === 'audio' ? 'Sesli mesaj' : 'Fotoğraf')).slice(0, 80)}</span><button onClick={onCancelReply}><X size={14} /></button></div>}
      {img && <div className="sx-imgprev"><img src={img.url} alt="" /><button onClick={() => setImg(null)} aria-label="Kaldır"><X size={14} /></button></div>}
      <div className="sx-inputrow">
        <button className="sx-ibtn" onClick={() => file.current?.click()} title="Fotoğraf ekle" aria-label="Fotoğraf ekle"><ImageIcon size={18} /></button>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { pickImage(e.target.files?.[0]); e.target.value = '' }} />
        <textarea ref={ta} className="sx-ta" rows={1} value={text} maxLength={1000} disabled={muted}
          placeholder={muted ? 'Susturuldun' : channel === 'global' ? 'Genel sohbete yaz…' : 'Mesaj yaz…'}
          onChange={(e) => { setText(e.target.value); e.target.style.height = ''; e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px'; if (e.target.value) c.typing(channel) }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
        <div className="sx-emoji-wrap">
          <button className="sx-ibtn" onClick={() => setEmoji(!emoji)} title="Emoji" aria-label="Emoji"><Smile size={18} /></button>
          {emoji && <EmojiPicker onPick={(e) => { setText((t) => t + e); ta.current?.focus() }} onClose={() => setEmoji(false)} />}
        </div>
        <RecordButton onDone={sendVoice} onError={(m) => c.notice(m)} />
        <button className="sx-send" onClick={send} disabled={busy || (!text.trim() && !img)} aria-label="Gönder">{busy ? <Loader2 size={18} className="sx-spin" /> : <Send size={18} />}</button>
      </div>
    </div>
  )
}
