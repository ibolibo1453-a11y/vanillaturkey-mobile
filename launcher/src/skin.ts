// Procedural default skin + cape textures so the 3D preview works fully offline.
function rect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string) { c.fillStyle = col; c.fillRect(x, y, w, h) }
function box(c: CanvasRenderingContext2D, u: number, v: number, w: number, h: number, d: number, top: string, side: string, bottom: string, front?: string) {
  rect(c, u + d, v, w, d, top); rect(c, u + d + w, v, w, d, bottom)
  rect(c, u, v + d, d, h, side); rect(c, u + d, v + d, w, h, front || side); rect(c, u + d + w, v + d, d, h, side); rect(c, u + 2 * d + w, v + d, w, h, side)
}
export function defaultSkin(): string {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64
  const c = cv.getContext('2d')!
  const skin = '#E0AC8A', hair = '#3B2517', shirt = '#2F8CFF', shirt2 = '#1A5FD1', pants = '#3A3A5C'
  box(c, 0, 0, 8, 8, 8, hair, skin, skin, skin)
  rect(c, 8, 8, 8, 3, hair); rect(c, 0, 8, 8, 2, hair); rect(c, 16, 8, 8, 2, hair); rect(c, 24, 8, 8, 8, hair)
  rect(c, 10, 12, 2, 2, '#FFFFFF'); rect(c, 14, 12, 2, 2, '#FFFFFF'); rect(c, 11, 12, 1, 2, '#3B6EE0'); rect(c, 14, 12, 1, 2, '#3B6EE0'); rect(c, 11, 15, 4, 1, '#9A5B45')
  box(c, 16, 16, 8, 12, 4, shirt, shirt, shirt2)
  box(c, 40, 16, 4, 12, 4, shirt, shirt, skin); rect(c, 44, 26, 4, 2, skin)
  box(c, 32, 48, 4, 12, 4, shirt, shirt, skin); rect(c, 36, 58, 4, 2, skin)
  box(c, 0, 16, 4, 12, 4, pants, pants, '#222'); box(c, 16, 48, 4, 12, 4, pants, pants, '#222')
  return cv.toDataURL('image/png')
}
export function capeTexture(color: string, color2: string): string {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 32
  const c = cv.getContext('2d')!
  const g = c.createLinearGradient(0, 0, 0, 32); g.addColorStop(0, color); g.addColorStop(1, color2)
  c.fillStyle = color2; c.fillRect(0, 0, 64, 32)
  c.fillStyle = g; c.fillRect(0, 0, 22, 17); c.fillRect(22, 0, 24, 22)
  c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(1, 1, 10, 2)
  return cv.toDataURL('image/png')
}
export function hashColors(id: string, rarity: string): [string, string] {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  const base = rarity === 'legendary' ? 38 : rarity === 'epic' ? 280 : rarity === 'rare' ? 210 : h % 360
  return [`hsl(${base} 85% 55%)`, `hsl(${(base + 25) % 360} 80% 28%)`]
}
