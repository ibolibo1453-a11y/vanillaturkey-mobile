// Animated custom cape (R5-E): sprite sheet from the API -> painted onto the template cape model, frame by frame.
// Sheet: PNG 80 px wide, 144*frames high (frames stacked top to bottom), meta json { v, id, frames, fps, fw, fh }.
import { buildCosmetic, type Cosmetic3D } from './cosmetic3d.js'

export const isCustomCape = (id?: string | null) => !!id && /^vtcape_[0-9a-f]{12}$/.test(id)
export interface CapeMeta { v: number; id: string; frames: number; fps: number; fw: number; fh: number }
interface Sheet { meta: CapeMeta; img: CanvasImageSource; avg: Float32Array }   // avg = per-frame average colour (r,g,b) * frames
export interface TemplateModel { json: any; tex?: string; tpl?: string }

const mediaUrl = (apiBase: string, id: string, ext: 'png' | 'json') => `${apiBase.replace(/\/+$/, '')}/media/capes/${id}.${ext}`

/** The main process fetches media from our own API host (no CORS, no tainted canvas); plain fetch is the fallback (tests / browser). */
async function dataUrl(url: string): Promise<string | null> {
  try { const r = await (window as any).vt?.invoke?.('social:media', url); if (typeof r === 'string' && r) return r } catch { /* fall through */ }
  try {
    const res = await fetch(url); if (!res.ok) return null
    const b = await res.blob()
    return await new Promise((ok) => { const f = new FileReader(); f.onload = () => ok(String(f.result)); f.onerror = () => ok(null); f.readAsDataURL(b) })
  } catch { return null }
}
const loadImg = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new window.Image(); i.onload = () => res(i); i.onerror = rej; i.src = src })

const sheets = new Map<string, Promise<Sheet | null>>()
/** Loads and caches the sheet + meta of a custom cape. `bust` forces a reload (used right after an upload). */
export function loadCapeSheet(apiBase: string, id: string, bust = false): Promise<Sheet | null> {
  if (!isCustomCape(id)) return Promise.resolve(null)
  const key = apiBase + '|' + id
  if (bust) sheets.delete(key)
  let p = sheets.get(key)
  if (!p) {
    p = (async () => {
      const [mu, iu] = await Promise.all([dataUrl(mediaUrl(apiBase, id, 'json')), dataUrl(mediaUrl(apiBase, id, 'png'))])
      if (!mu || !iu) return null
      const meta = (await (await fetch(mu)).json()) as CapeMeta
      const img = await loadImg(iu)
      const frames = Math.max(1, Math.min(64, Math.floor(meta.frames) || 1)), fh = meta.fh || 144, fw = meta.fw || 80
      if (img.width !== fw || img.height < fh * frames) return null
      // per-frame average colour (1x1 downscale of each frame)
      const avg = new Float32Array(frames * 3)
      const c = document.createElement('canvas'); c.width = c.height = 1
      const cx = c.getContext('2d', { willReadFrequently: true })!
      cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high'
      for (let f = 0; f < frames; f++) {
        cx.clearRect(0, 0, 1, 1); cx.drawImage(img, 0, f * fh, fw, fh, 0, 0, 1, 1)
        const d = cx.getImageData(0, 0, 1, 1).data; avg[f * 3] = d[0]; avg[f * 3 + 1] = d[1]; avg[f * 3 + 2] = d[2]
      }
      return { meta: { ...meta, frames, fw, fh }, img, avg }
    })().catch(() => null)
    sheets.set(key, p)
    p.then((s) => { if (!s) sheets.delete(key) })   // do not cache failures
  }
  return p
}

interface Seg { index: number; count: number; back: number[]; front: number[] }
function collectSegments(node: any, out: Seg[]) {
  if (node.capeSegment && node.boxes?.[0]?.uv) {
    const uv = node.boxes[0].uv
    if (uv.back && uv.front) out.push({ index: node.capeSegment.index, count: node.capeSegment.count, back: uv.back, front: uv.front })
  }
  for (const c of node.children || []) collectSegments(c, out)
}

/**
 * Builds a custom cape from the cape template model (cape_custom, fallback cape_vt: same 6-segment layout).
 * The returned object animates by itself: update(t) repaints the texture only when the frame index changes.
 */
export async function buildCustomCape(THREE: any, id: string, tpl: TemplateModel, apiBase: string): Promise<Cosmetic3D | null> {
  const sheet = await loadCapeSheet(apiBase, id)
  if (!sheet) return null
  const json = tpl.json
  const [tw, th] = json.texSize as [number, number]
  const segs: Seg[] = []; collectSegments(json.root, segs)
  if (!segs.length) return null
  const cv = document.createElement('canvas'); cv.width = tw; cv.height = th
  const cx = cv.getContext('2d')!
  cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high'
  const { meta, img, avg } = sheet
  const fps = Math.max(1, meta.fps || 10)
  let shown = -1
  const paint = (f: number) => {
    shown = f
    const o = f * meta.fh
    const r = avg[f * 3] * 0.7, g = avg[f * 3 + 1] * 0.7, b = avg[f * 3 + 2] * 0.7
    cx.globalCompositeOperation = 'source-over'
    cx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`   // sides / top / bottom rects
    cx.fillRect(0, 0, tw, th)
    for (const s of segs) {
      const sh = meta.fh / s.count, sy = o + s.index * sh
      const [bx, by, bw, bh] = s.back, [fx, fy, fw, fh] = s.front
      cx.drawImage(img, 0, sy, meta.fw, sh, bx, by, bw, bh)
      // inner face: mirrored copy, darkened to 60 %
      cx.save(); cx.translate(fx + fw, fy); cx.scale(-1, 1)
      cx.drawImage(img, 0, sy, meta.fw, sh, 0, 0, fw, fh)
      cx.restore()
      cx.fillStyle = 'rgba(0,0,0,0.4)'; cx.fillRect(fx, fy, fw, fh)
    }
  }
  paint(0)
  const texture = new THREE.CanvasTexture(cv)
  const base = buildCosmetic(THREE, { ...json, id }, texture)
  const update = base.update
  base.update = (t: number, state?: Record<string, number>) => {
    const f = Math.floor(Math.max(0, t) * fps) % meta.frames
    if (f !== shown) { paint(f); texture.needsUpdate = true }
    update(t, state)
  }
  return base
}
