/** Minimal Fabric-style Minecraft version range matcher: ">=1.21.9 <=1.21.10", "~26.3", "1.21.x", "^1.21", "a || b", exact; arrays = OR. */
const parse = (v: string) => v.split('.').map((x) => parseInt(x, 10) || 0)
const cmp = (a: number[], b: number[]) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d < 0 ? -1 : 1 } return 0 }

function term(t: string, v: number[]): boolean {
  t = t.trim(); if (!t || t === '*') return true
  const m = /^(>=|<=|>|<|=|~|\^)?\s*v?([0-9][0-9.]*(?:\.[xX*])?)$/.exec(t)
  if (!m) return false
  const op = m[1] || '='
  let raw = m[2]
  if (/[xX*]$/.test(raw)) { // 1.21.x == >=1.21 <1.22
    const base = parse(raw.replace(/\.[xX*]$/, '')); const hi = base.slice(); hi[hi.length - 1]++
    return cmp(v, base) >= 0 && cmp(v, hi) < 0
  }
  const b = parse(raw)
  switch (op) {
    case '>=': return cmp(v, b) >= 0
    case '<=': return cmp(v, b) <= 0
    case '>': return cmp(v, b) > 0
    case '<': return cmp(v, b) < 0
    case '~': { const hi = b.length >= 2 ? [b[0], b[1] + 1] : [b[0] + 1]; return cmp(v, b) >= 0 && cmp(v, hi) < 0 }
    case '^': { const hi = [b[0] + 1]; return cmp(v, b) >= 0 && cmp(v, hi) < 0 }
    default: return cmp(v, b) === 0
  }
}

export function mcMatches(range: string | string[] | undefined, mc: string): boolean {
  if (range == null) return false
  const v = parse(mc)
  const alts = (Array.isArray(range) ? range : [range]).flatMap((r) => String(r).split('||'))
  return alts.some((alt) => alt.split(/\s+(?=[<>=~^]|\d)|(?<=[<>=~^])\s+/).filter(Boolean).every((t) => term(t, v)))
}
