import React, { useCallback, useEffect, useState } from 'react'
import { Megaphone, Trash2 } from 'lucide-react'
import { registerAdminSection } from '../registry'
import type { PanelApi } from '../types'

interface Ann { id: number; text: string; kind: string; active: boolean; by: string; at: number }
interface Room { id: string; name: string; owner: string; access: string; max: number; members: string[] }
interface Msg { id: number; author: string; text: string; at: number }

function Content({ api }: { api: PanelApi; role: string }) {
  const [anns, setAnns] = useState<Ann[]>([])
  const [text, setText] = useState('')
  const [warn, setWarn] = useState(false)
  const [slow, setSlow] = useState('3')
  const [words, setWords] = useState('')
  const [rooms, setRooms] = useState<Room[]>([])
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [msg, setMsg] = useState<{ t: string; bad: boolean } | null>(null)
  const say = useCallback((t: string, bad = false) => { setMsg({ t, bad }); setTimeout(() => setMsg((m) => (m?.t === t ? null : m)), 3500) }, [])
  const ok = (r: any, good: string) => { if (r.data?.ok) { say(good); return true } say(r.data?.error || (r.status === 403 ? 'Bu işlem için yetkin yok.' : 'İşlem başarısız.'), true); return false }
  const loadAnns = useCallback(() => { api.call('GET', '/v1/admin/announcements').then((r) => { if (r.data?.ok) setAnns(r.data.announcements) }) }, [api])
  const loadChat = useCallback(() => {
    api.call('GET', '/v1/admin/chat').then((r) => { if (r.data?.ok) { setSlow(String(r.data.slowSeconds)); setWords((r.data.words || []).join('\n')) } })
    api.call('GET', '/v1/admin/chat/recent?limit=30').then((r) => { if (r.data?.ok) setMsgs(r.data.messages) })
  }, [api])
  const loadRooms = useCallback(() => { api.call('GET', '/v1/admin/rooms').then((r) => { if (r.data?.ok) setRooms(r.data.rooms) }) }, [api])
  useEffect(() => { loadAnns(); loadChat(); loadRooms() }, [loadAnns, loadChat, loadRooms])
  return (
    <div className="vta-sec">
      <div className="vta-sechead"><div><h2>İçerik</h2><p>Duyurular, genel sohbet moderasyonu ve ses odaları.</p></div></div>
      {msg && <div className={'vta-msg' + (msg.bad ? ' bad' : '')} role="status">{msg.t}</div>}

      <div className="vta-card">
        <h3 className="vta-h3"><Megaphone size={16} /> Duyuru</h3>
        <div className="vta-add"><input value={text} maxLength={280} placeholder="Çevrimiçi herkese gösterilir (örn. Bakım 22:00)" onChange={(e) => setText(e.target.value)} />
          <label className="vta-sw"><input type="checkbox" checked={warn} onChange={(e) => setWarn(e.target.checked)} /> Uyarı</label>
          <button className="btn-primary vta-addbtn" disabled={!text.trim()} onClick={async () => { if (ok(await api.call('POST', '/v1/admin/announcements', { text, kind: warn ? 'warn' : 'info' }), 'Duyuru yayınlandı.')) { setText(''); loadAnns() } }}>Yayınla</button></div>
        <div className="vta-rows">
          {anns.filter((a) => a.active).map((a) => (
            <div key={a.id} className="vta-r"><span className={'vta-kind ' + a.kind}>{a.kind === 'warn' ? 'Uyarı' : 'Bilgi'}</span><span className="grow">{a.text}</span><span className="vta-dim">{a.by}</span>
              <button className="vta-btn danger" onClick={async () => { if (ok(await api.call('DELETE', '/v1/admin/announcements/' + a.id), 'Kaldırıldı.')) loadAnns() }}><Trash2 size={13} /></button></div>
          ))}
          {!anns.some((a) => a.active) && <p className="vta-empty">Aktif duyuru yok.</p>}
        </div>
      </div>

      <div className="vta-card">
        <h3 className="vta-h3">Genel sohbet</h3>
        <div className="vta-line"><span className="vta-dim">Yavaş mod (sn, 0 = kapalı)</span><input className="vta-num" value={slow} inputMode="numeric" onChange={(e) => setSlow(e.target.value.replace(/\D/g, ''))} /></div>
        <label className="vta-form"><label>Yasaklı kelimeler (her satıra bir tane, yıldızlanır)<textarea rows={3} value={words} onChange={(e) => setWords(e.target.value)} /></label></label>
        <div className="vta-line end"><button className="btn-primary vta-save" onClick={async () => { if (ok(await api.call('PUT', '/v1/admin/chat', { slowSeconds: Number(slow) || 0, words: words.split(/\r?\n/).map((w) => w.trim()).filter(Boolean) }), 'Sohbet kuralları kaydedildi.')) loadChat() }}>Kaydet</button></div>
        <div className="vta-rows">
          {msgs.map((m) => (
            <div key={m.id} className="vta-r"><b>{m.author}</b><span className="grow">{m.text}</span>
              <button className="vta-btn danger" onClick={async () => { if (ok(await api.call('DELETE', '/v1/admin/chat/messages/' + m.id), 'Mesaj silindi.')) loadChat() }}><Trash2 size={13} /></button></div>
          ))}
        </div>
      </div>

      <div className="vta-card">
        <h3 className="vta-h3">Ses odaları <button className="vta-btn" onClick={loadRooms}>Yenile</button></h3>
        <div className="vta-rows">
          {rooms.length === 0 && <p className="vta-empty">Açık oda yok.</p>}
          {rooms.map((r) => <RoomRow key={r.id} r={r} api={api} done={(g, good) => { if (ok(g, good)) loadRooms() }} />)}
        </div>
      </div>
    </div>
  )
}

function RoomRow({ r, api, done }: { r: Room; api: PanelApi; done: (res: any, good: string) => void }) {
  const [name, setName] = useState(r.name)
  const [max, setMax] = useState(String(r.max))
  return (
    <div className="vta-r wrap">
      <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      <input className="vta-num" value={max} inputMode="numeric" onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} />
      <span className="vta-dim">{r.members.length} kişi · {r.owner}</span>
      <button className="vta-btn" disabled={name === r.name && Number(max) === r.max} onClick={async () => done(await api.call('PUT', '/v1/admin/rooms/' + r.id, { name, max: Number(max) }), 'Oda güncellendi.')}>Kaydet</button>
      <button className="vta-btn danger" onClick={async () => { if (confirm(`"${r.name}" odası kapatılsın mı?`)) done(await api.call('POST', `/v1/admin/rooms/${r.id}/close`), 'Oda kapatıldı.') }}>Kapat</button>
    </div>
  )
}

registerAdminSection({ id: 'content', label: 'İçerik', order: 40, Component: Content })
