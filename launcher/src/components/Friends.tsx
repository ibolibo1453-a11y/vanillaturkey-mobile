import { SignInPrompt } from './SignInPrompt'
import React, { useState } from 'react'
import { useApp, Friend } from '../store'
import { Icon } from './ui'
import { Head, RoleName, getSocial } from '../social'

export const FAvatar = ({ name, online, size = 34 }: { name: string; online?: boolean; size?: number }) => (
  <span className="fav" style={{ width: size, height: size }}>
    <Head name={name} size={size} />
    {online !== undefined && <i className={online ? 'on' : ''} />}
  </span>
)

const statusText = (f: Friend) => (f.online ? f.status || 'Çevrimiçi' : 'Çevrimdışı')

export function AddFriend({ compact }: { compact?: boolean }) {
  const { friendAct, account } = useApp()
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    const n = name.trim(); if (!n || busy) return
    setBusy(true); setErr('')
    const r = await friendAct('request', n)
    setBusy(false)
    if (r.ok) setName(''); else setErr(r.error || 'Eklenemedi.')
  }
  return (
    <div className="addf">
      <div className={'input' + (compact ? ' sm' : '')}>
        <Icon name="plus" size={15} />
        <input value={name} maxLength={16} placeholder="Kullanıcı adıyla ekle" onChange={(e) => { setName(e.target.value); setErr('') }} onKeyDown={(e) => e.key === 'Enter' && submit()} disabled={account?.offline} />
        <button className="addf-go" onClick={submit} disabled={!name.trim() || busy}>{busy ? <i className="spin" /> : 'Ekle'}</button>
      </div>
      {err && <div className="addf-err">{err}</div>}
    </div>
  )
}

function Unavailable({ msg }: { msg: string }) { return <p className="friends-empty">{msg}</p> }

/** Home right-column card. */
export function FriendsCard({ go }: { go: () => void }) {
  const { friends, account } = useApp()
  const offline = !!account?.offline
  const shown = friends.friends.slice(0, 4)
  const onlineN = friends.friends.filter((f) => f.online).length
  return (
    <div className="card friends-card">
      <div className="card-head">
        <span className="micro">Arkadaşlar{onlineN ? ` · ${onlineN} çevrimiçi` : ''}</span>
        <span className="fc-right">{friends.incoming.length > 0 && <b className="fbadge" title="Bekleyen istekler">{friends.incoming.length}</b>}<a onClick={go}>Tümü</a></span>
      </div>
      {offline ? <SignInPrompt msg="Arkadaşlar için VanillaTurkey hesabı gerekiyor." /> : (
        <>
          <AddFriend compact />
          <div className="fc-list">
            {friends.error && !friends.friends.length && <Unavailable msg={friends.error} />}
            {friends.loaded && !friends.error && !friends.friends.length && <Unavailable msg={friends.incoming.length ? 'Bekleyen istekler var: Tümü’ne tıkla.' : 'Henüz arkadaşın yok. Kullanıcı adıyla ekle.'} />}
            {shown.map((f) => (
              <div key={f.name} className={'frow' + (f.online ? '' : ' off')}>
                <FAvatar name={f.name} online={f.online} size={28} />
                <div><RoleName name={f.name} /><span>{statusText(f)}</span></div>
                <button className="fr-dm" title="Mesaj gönder" onClick={() => getSocial()?.openDm(f.name)}><Icon name="chat" size={14} /></button>
              </div>
            ))}
          </div>
          {friends.friends.length > shown.length && <a className="fc-more" onClick={go}>+{friends.friends.length - shown.length} arkadaş daha</a>}
        </>
      )}
    </div>
  )
}
