import React, { useMemo } from 'react'
import { AdminPanel } from '../admin/AdminPanel'
import type { AdminMe, PanelApi } from '../admin/types'

/** Launcher host of the shared admin panel: API over IPC (token stays in the main process). */
export const launcherPanelApi: PanelApi = {
  call: (method, path, body) => window.vt.invoke('api:call', method, path, body, true),
  upload: async (path, file) => window.vt.invoke('api:upload', path, { data: await file.arrayBuffer(), name: file.name, type: file.type })
}

export function AdminScreen({ me }: { me: AdminMe }) {
  const api = useMemo(() => launcherPanelApi, [])
  return <div className="page-inner full admin-page"><AdminPanel api={api} me={me} /></div>
}
