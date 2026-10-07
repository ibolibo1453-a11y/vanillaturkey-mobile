// R5-B: VanillaTurkey roles. Same colours everywhere: launcher friends / chat / voice rooms, the PWA and the game.
import React from 'react'
import { useSocialMaybe } from './react'

export const ROLE_COLORS: Record<string, string> = { 'KURUCU': '#FF4D4D', 'YETKİLİ': '#3D8BFF', 'SPONSOR': '#FFD23F', 'VIP': '#B36BFF' }
export const ROLE_LIST = Object.keys(ROLE_COLORS)
/** custom roles (name + colour) come from GET /v1/roles/defs and the roles_defs frame */
let defs: Record<string, string> = {}
export const setRoleDefs = (list: { name: string; color: string }[] | undefined) => { defs = Object.fromEntries((list || []).map((d) => [d.name, d.color])) }
export const roleColor = (role?: string | null) => (role ? defs[role] || ROLE_COLORS[role] : undefined)

/** the role of a player as known by the social client (re-renders when it changes); undefined = no role */
export function useRole(name: string): string | undefined {
  const c = useSocialMaybe()
  const [, bump] = React.useReducer((x: number) => x + 1, 0)
  React.useEffect(() => (c ? c.subscribe(bump) : undefined), [c])
  return c ? c.roleOf(name) : undefined
}

/** small coloured pill with the role name */
export function RoleChip({ role, className }: { role?: string | null; className?: string }) {
  if (!role) return null
  const col = roleColor(role)
  return <em className={'vt-role-chip' + (className ? ' ' + className : '')} style={{ ['--rc' as any]: col }} title={role}>{role}</em>
}

/** name text tinted with the player's role colour (tooltip = role name). `as` picks the element, defaults to <b>. */
export function RoleName({ name, as = 'b', className, onClick, children }: { name: string; as?: 'b' | 'span' | 'strong'; className?: string; onClick?: (e: React.MouseEvent) => void; children?: React.ReactNode }) {
  const role = useRole(name)
  const col = roleColor(role)
  return React.createElement(as, { className, onClick, style: col ? { color: col } : undefined, title: role || undefined }, children ?? name)
}
