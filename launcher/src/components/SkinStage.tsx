import React, { useEffect, useRef } from 'react'
import * as sv from 'skinview3d'
import * as THREE from 'three'
import { buildCosmetic, tintTemplate, type Cosmetic3D } from '../lib/cosmetic3d.js'
import { isCustomCape, buildCustomCape } from '../lib/customCape'
import { useApp } from '../store'

export type Loadout = Record<string, string | undefined>
interface Props { zoom?: number; fitTop?: number; skin: string; slim?: boolean; cape?: string | null; elytra?: boolean; className?: string; loadout?: Loadout; renk?: [number, number] }

// 3D cosmetic models (format: cosmetics/build/models/FORMAT.md) are fetched once from the main process and cached
const modelCache = new Map<string, Promise<{ json: any; tex: string; tpl: string } | null>>()
const getModel = (id: string) => { let p = modelCache.get(id); if (!p) { p = window.vt.invoke('cosmetic:model', id); modelCache.set(id, p) } return p }
const loadImg = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new window.Image(); i.onload = () => res(i); i.onerror = rej; i.src = src })

async function buildFor(id: string, renk?: [number, number], apiBase = ''): Promise<Cosmetic3D | null> {
  if (isCustomCape(id)) {   // animated custom cape: template cape_custom (fallback cape_vt) painted from the uploaded sprite sheet
    const tpl = (await getModel('cape_custom')) || (await getModel('cape_vt'))
    return tpl?.json ? buildCustomCape(THREE, id, tpl, apiBase) : null
  }
  const base = id.startsWith('renklerin_') ? 'renklerin' : id
  const m = await getModel(base)
  if (!m || !m.tex) return null
  let tex: any
  if (base === 'renklerin' && m.tpl) {
    const c = renk || [0xff7a6b, 0x9b6bff]
    tex = tintTemplate(THREE, await loadImg(m.tpl), c[0], c[1])
  } else tex = await new THREE.TextureLoader().loadAsync(m.tex)
  return buildCosmetic(THREE, m.json, tex)
}

/** 3D player preview: real skin texture, front 3/4 view, idle animation, plus the real 3D cosmetics (hats, masks, bodies, capes, wings, pets, auras). */
const FIT_Y = 0.5   // body centre offset in skin units (calibrated against screenshots)
export function SkinStage({ skin, slim, cape, elytra, className, zoom, loadout, renk, fitTop }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const viewer = useRef<sv.SkinViewer | null>(null)
  const worn = useRef<Map<string, { id: string; obj: Cosmetic3D }>>(new Map())
  const seq = useRef(0)
  const { awake, settings } = useApp()
  const apiBase = settings.apiBase
  const awakeRef = useRef(awake)
  awakeRef.current = awake // no rendering while the window is hidden or the game is running

  useEffect(() => {
    const el = wrap.current!
    const v = new sv.SkinViewer({ canvas: canvas.current!, width: el.clientWidth || 400, height: el.clientHeight || 560, fov: 22, zoom: (zoom ?? 0.74) * 0.89, pixelRatio: 'match-device', renderPaused: false })
    // skinview3d 3.x defaults are ambient 3 / camera point 0.6; lower values render the skin muddy and dark
    v.globalLight.intensity = 3
    v.cameraLight.intensity = 0.7
    v.controls.enableZoom = false
    v.controls.enablePan = false
    v.animation = new sv.IdleAnimation()
    v.autoRotate = false
    v.camera.position.y = fitTop == null ? 2 : 0.6
    viewer.current = v
    // gentle sway around a front 3/4 view instead of a full spin, so the model never sits edge-on;
    // dragging takes over, and the sway eases back 2.5 s after release
    const BASE = -0.35, AMP = 0.16
    let dragging = false, idleSince = performance.now(), hidden = document.visibilityState === 'hidden', last = 0
    const FRAME = 1000 / 30
    // throttle skinview3d's own draw loop to 30 fps (60 while dragging): sway + cosmetics animate right before each real frame
    const anyV = v as any
    const origDraw = anyV.draw.bind(v)
    anyV.draw = () => {
      const now = performance.now()
      if (hidden || !awakeRef.current || (!dragging && now - last < ((window as any).__rec ? 4 : FRAME) - 3)) { anyV.animationID = window.requestAnimationFrame(() => anyV.draw()); return }
      last = now
      if (!dragging) {
        const target = BASE + Math.sin(now / 1800) * AMP
        const ease = now - idleSince > 2500 ? 0.08 : 0
        v.playerObject.rotation.y += (target - v.playerObject.rotation.y) * ease
      }
      const t = now / 1000
      for (const w of worn.current.values()) w.obj.update(t)
      origDraw()
    }
    v.playerObject.rotation.y = BASE
    const down = () => { dragging = true }
    const up = () => { if (dragging) { dragging = false; idleSince = performance.now() } }
    canvas.current!.addEventListener('pointerdown', down)
    window.addEventListener('pointerup', up)
    const vis = () => { hidden = document.visibilityState === 'hidden' }
    document.addEventListener('visibilitychange', vis)
    // fitTop (home): scale + position the 32-unit body so head-to-feet fits between the chips (fitTop px from the top) and the stage bottom
    // with an equal gap (24 px; room for a hat above the head); camera straight on, slightly above
    const fit = (h: number) => {
      if (fitTop == null) return
      const gap = 24, s = Math.max(4, (h - fitTop - 2 * gap) / 33.6)
      const t = Math.tan((v.fov / 2) * Math.PI / 180)
      const d = (h / s) / (2 * t)
      v.zoom = 16.5 / t / Math.max(1, d - 4.5)
      v.controls.target.set(0, ((fitTop + h) / 2 - h / 2) / s + FIT_Y, 0)
    }
    const ro = new ResizeObserver(() => { const w = el.clientWidth, h = el.clientHeight; if (w > 10 && h > 10) { v.setSize(w, h); fit(h) } })
    ro.observe(el)
    return () => {
      ro.disconnect(); window.removeEventListener('pointerup', up); document.removeEventListener('visibilitychange', vis)
      for (const w of worn.current.values()) w.obj.dispose()
      worn.current.clear(); v.dispose()
    }
  }, [])
  useEffect(() => { viewer.current?.loadSkin(skin, { model: slim ? 'slim' : 'auto-detect' }).catch(() => {}) }, [skin, slim])
  const capeCos = loadout?.cape
  useEffect(() => {
    const v = viewer.current; if (!v) return
    if (capeCos) { v.resetCape(); return }
    if (cape) v.loadCape(cape, { backEquipment: elytra ? 'elytra' : 'cape' }).catch(() => {}); else v.resetCape()
  }, [cape, elytra, capeCos])

  // sync worn cosmetics with the loadout (diff per slot)
  const key = JSON.stringify(loadout || {}) + (renk ? renk.join() : '')
  useEffect(() => {
    const v = viewer.current; if (!v) return
    const my = ++seq.current
    const want = loadout || {}
    for (const [slot, w] of [...worn.current]) {
      if (want[slot] !== w.id) { w.obj.object.parent?.remove(w.obj.object); w.obj.dispose(); worn.current.delete(slot) }
    }
    for (const [slot, id] of Object.entries(want)) {
      if (!id || worn.current.get(slot)?.id === id) continue
      buildFor(id, renk, apiBase).then((obj) => {
        if (!obj || my !== seq.current || viewer.current !== v) { obj?.dispose(); return }
        const old = worn.current.get(slot); if (old) { old.obj.object.parent?.remove(old.obj.object); old.obj.dispose() }
        const skinObj: any = v.playerObject.skin
        if (obj.bone === 'head') skinObj.head.add(obj.object)
        else if (obj.bone === 'body' || obj.bone === 'back') skinObj.add(obj.object)
        else if (obj.bone === 'hit') { obj.object.position.set(0, -6, 22); skinObj.add(obj.object) }   // R5-E hit effect: about one block in front of the chest, loops
        else { obj.object.position.set(obj.bone === 'pet' ? -15.2 : 0, -24, obj.bone === 'pet' ? -7.2 : 0); skinObj.add(obj.object) }
        worn.current.set(slot, { id, obj })
      })
    }
  }, [key])

  return (
    <div className={'stage ' + (className || '')} ref={wrap}>
      <div className="stage-floor" />
      <canvas ref={canvas} />
    </div>
  )
}
