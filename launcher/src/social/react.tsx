import React, { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { SocialClient, SocialState } from './client'
import { cachedHead, isStale, loadHead, onSkinChange, placeholderHead } from './heads'

export const SocialCtx = createContext<SocialClient | null>(null)
let current: SocialClient | null = null
export const setCurrentSocial = (c: SocialClient | null) => { current = c }
export const getSocial = () => current
export const useSocialClient = () => useContext(SocialCtx)!
export const useSocialMaybe = () => useContext(SocialCtx)
export function useSocial(): SocialState {
  const c = useContext(SocialCtx)!
  return useSyncExternalStore(c.subscribe, c.getState)
}

/** Head image src for a player: placeholder immediately, real head when loaded, refreshed on skin_upd. */
export function useHead(name: string): string {
  const c = useContext(SocialCtx)
  const [src, setSrc] = useState(() => cachedHead(name) || placeholderHead(name))
  useEffect(() => {
    let live = true
    const run = () => { setSrc(cachedHead(name) || placeholderHead(name)); if (!cachedHead(name) || isStale(name)) loadHead(c ? c.a : null, name).then((s) => live && setSrc(s)) }
    run()
    const off = onSkinChange((n) => { if (n === '' || n.toLowerCase() === name.toLowerCase()) run() })
    return () => { live = false; off() }
  }, [name, c])
  return src
}

export const Head = React.memo(function Head({ name, size = 32, glow, className, onClick, title }: { name: string; size?: number; glow?: boolean; className?: string; onClick?: (e: React.MouseEvent) => void; title?: string }) {
  const src = useHead(name)
  return <img className={'sx-head' + (glow ? ' speaking' : '') + (className ? ' ' + className : '')} src={src} width={size} height={size} style={{ width: size, height: size }} alt={name} title={title ?? name} onClick={onClick} draggable={false} />
})

export function useTick(ms: number) { const [, s] = useState(0); useEffect(() => { const t = setInterval(() => s((x) => x + 1), ms); return () => clearInterval(t) }, [ms]) }
export const memoFn = <T,>(f: () => T, deps: any[]) => useMemo(f, deps)
