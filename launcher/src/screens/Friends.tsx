import React, { useState } from 'react'
import { useApp, Friend } from '../store'
import { Icon } from '../components/ui'
import { FAvatar, AddFriend } from '../components/Friends'
import { RoleName, getSocial } from '../social'

const ago = (t?: number) => {
  if (!t) return ''
  const m = Math.max(1, Math.round((Date.now() - t) / 60000))
  return m < 60 ? `${m} dk önce` : m < 1440 ? `${Math.round(m / 60)} sa önce` : `${Math.round(m / 1440)} gün önce`
}

export function FriendsScreen() {
  const { friends, friendAct, refreshFriends, account, toast } = useApp()
  const [confirm, setConfirm] = useState('')
  const act = async (a: 'accept' | 'decline' | 'remove', name: string) => {
    const r = await friendAct(a, name)
    if (!r.ok) toast(r.error || 'İşlem başarısız.', 'err')
    setConfirm('')
  }
  const online = friends.friends.filter((f) => f.online), off = friends.friends.filter((f) => !f.online)
  const row = (f: Friend) => (
    <div key={f.name} className={'gcard frow big' + (f.online ? '' : ' off')}>
      <FAvatar name={f.name} online={f.online} size={42} />
      <div className="fr-main"><RoleName name={f.name} /><span>{f.online ? f.status || 'Çevrimiçi' : f.since ? `Son görülme ${ago(f.since)}` : 'Çevrimdışı'}</span></div>
      <button className="icon-btn" title="Mesaj gönder" onClick={() => getSocial()?.openDm(f.name)}><Icon name="chat" size={15} /></button>
      {confirm === f.name
        ? <div className="fr-btns"><button className="btn-danger sm" onClick={() => act('remove', f.name)}>Evet, kaldır</button><button className="btn-glass sm" onClick={() => setConfirm('')}>Vazgeç</button></div>
        : <button className="icon-btn" title="Arkadaşlıktan çıkar" onClick={() => setConfirm(f.name)}><Icon name="trash" size={15} /></button>}
    </div>
  )
  return (
    <div className="friends-page">
      <div className="page-title">
        <div><h1>Arkadaşlar</h1><p>{account?.offline ? 'Arkadaşlar için VanillaTurkey hesabıyla giriş yapmalısın.' : `${online.length} çevrimiçi · ${friends.friends.length} arkadaş`}</p></div>
        <button className="btn-glass sm" onClick={refreshFriends}><Icon name="refresh" size={14} /> Yenile</button>
      </div>
      <div className="fr-grid">
        <div className="card fr-side">
          <h3>Arkadaş ekle</h3>
          <p className="muted">Kullanıcı adını yaz; karşı taraf da istek gönderdiyse arkadaşlık hemen kurulur.</p>
          <AddFriend />
          {friends.incoming.length > 0 && (
            <>
              <div className="micro fr-sec">İstekler <b className="fbadge">{friends.incoming.length}</b></div>
              {friends.incoming.map((q) => (
                <div key={q.name} className="gcard frow">
                  <FAvatar name={q.name} size={32} />
                  <div className="fr-main"><RoleName name={q.name} /><span>{ago(q.at)}</span></div>
                  <button className="icon-btn ok" title="Kabul et" onClick={() => act('accept', q.name)}><Icon name="check" size={15} /></button>
                  <button className="icon-btn" title="Reddet" onClick={() => act('decline', q.name)}><Icon name="close" size={15} /></button>
                </div>
              ))}
            </>
          )}
          {friends.outgoing.length > 0 && (
            <>
              <div className="micro fr-sec">Gönderilen istekler</div>
              {friends.outgoing.map((q) => (
                <div key={q.name} className="gcard frow off">
                  <FAvatar name={q.name} size={28} />
                  <div className="fr-main"><RoleName name={q.name} /><span>Yanıt bekleniyor · {ago(q.at)}</span></div>
                </div>
              ))}
            </>
          )}
        </div>
        <div className="card fr-main-card">
          {friends.error && <div className="warn-note">{friends.error}</div>}
          {!friends.error && friends.loaded && !friends.friends.length && <div className="empty">Henüz arkadaşın yok.<br /><span className="note">Soldan kullanıcı adıyla arkadaş ekleyebilirsin.</span></div>}
          {online.length > 0 && <div className="micro fr-sec">Çevrimiçi · {online.length}</div>}
          <div className="fr-list">{online.map(row)}</div>
          {off.length > 0 && <div className="micro fr-sec">Çevrimdışı · {off.length}</div>}
          <div className="fr-list">{off.map(row)}</div>
        </div>
      </div>
    </div>
  )
}
