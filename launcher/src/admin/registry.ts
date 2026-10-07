// Admin panel sections registry ("Yönetim"). Launcher, PWA and (mirrored) the game read the section list from the API
// (GET /v1/admin/me -> sections the caller may open) and render the ones registered here.
// R5-B (roles) and R5-C (coins) add their own file under ./sections and ONE import line in ./sections/index.ts.
import type React from 'react'
import type { PanelApi } from './types'

export interface AdminSectionDef {
  id: string                       // must equal the id the API registered (app.admin.addSection)
  label: string
  order: number                    // sidebar order
  Component: React.ComponentType<{ api: PanelApi; role: string }>
}
const list: AdminSectionDef[] = []
export function registerAdminSection(s: AdminSectionDef) { if (!list.some((x) => x.id === s.id)) list.push(s); list.sort((a, b) => a.order - b.order) }
export const adminSectionDefs = () => list
