// "Yönetim": role-gated admin shell with a sidebar of registered sections. Used by the launcher page and the PWA tab.
import React, { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { adminSectionDefs } from './registry'
import type { AdminMe, PanelApi } from './types'
import { roleColor as dynRoleColor } from '../social/roles'
import './sections'
import './admin.css'

/** Asks the API whether this account may open the panel. Re-checks when `key` (account) changes. */
export function useAdminMe(api: PanelApi | null, key: string): AdminMe | null {
  const [me, setMe] = useState<AdminMe | null>(null)
  useEffect(() => {
    setMe(null)
    if (!api || !key) return
    let live = true
    api.call('GET', '/v1/admin/me').then((r) => { if (live && r.data?.ok) setMe(r.data as AdminMe) }).catch(() => {})
    return () => { live = false }
  }, [api, key])
  return me
}

export const roleColor = (r: string | null | undefined) => dynRoleColor(r) || '#ffffff'   // one palette everywhere (social/roles.tsx)

export function AdminPanel({ api, me }: { api: PanelApi; me: AdminMe }) {
  const defs = adminSectionDefs().filter((d) => me.sections.some((s) => s.id === d.id))
  const [sel, setSel] = useState(defs[0]?.id || '')
  const cur = defs.find((d) => d.id === sel) || defs[0]
  return (
    <div className="vta">
      <div className="vta-head">
        <h1><ShieldCheck size={22} /> Yönetim</h1>
        <span className="vta-role" style={{ ['--rc' as any]: roleColor(me.role) }}>{me.role}</span>
      </div>
      <div className="vta-body">
        <nav className="vta-nav" aria-label="Yönetim bölümleri">
          {defs.map((d) => <button key={d.id} className={cur?.id === d.id ? 'on' : ''} onClick={() => setSel(d.id)}>{d.label}</button>)}
        </nav>
        <div className="vta-main">{cur ? <cur.Component key={cur.id} api={api} role={me.role || ''} /> : <p className="vta-empty">Açılabilecek bölüm yok.</p>}</div>
      </div>
    </div>
  )
}
