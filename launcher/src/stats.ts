// Play statistics (R5-C: the level curve is gone; coins live in coins.ts). The API is authoritative; this is the offline placeholder.
export interface Stats {
  ok: boolean; totalSeconds: number
  streakDays: number; firstPlayed: number; playerKills: number; mobKills: number; last7Days: number[]
}

export function computeStats(raw: any): Stats {
  const total = Math.max(0, Number(raw?.totalSeconds ?? raw?.total_seconds ?? 0) || 0)
  const last7 = Array.isArray(raw?.last7Days) ? raw.last7Days.slice(-7).map((x: any) => Number(x) || 0) : []
  while (last7.length < 7) last7.unshift(0)
  return {
    ok: !!raw, totalSeconds: total,
    streakDays: Number(raw?.streakDays) || 0, firstPlayed: Number(raw?.firstPlayed) || 0,
    playerKills: Number(raw?.playerKills) || 0, mobKills: Number(raw?.mobKills) || 0, last7Days: last7
  }
}

/** Accepts the API payload. */
export const fromApi = (d: any): Stats => computeStats(d)

export function dur(sec: number, long = false) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60)
  if (h <= 0) return `${m}dk`
  return long || h < 100 ? `${h}sa ${m}dk` : `${h}sa ${m}dk`
}

export const DAY_LABELS = ['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz']
/** Labels for the last 7 days ending today. */
export function dayLabels() {
  const out: string[] = []
  for (let i = 6; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5); out.push(DAY_LABELS[(d.getDay() + 6) % 7]) }
  return out
}
