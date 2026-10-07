// Tiny WebAudio blips for join / leave / mute / notification (no assets needed).
let ctx: AudioContext | null = null
const get = () => ctx || (ctx = new (window.AudioContext || (window as any).webkitAudioContext)())
export const setQuiet = (v: boolean) => { quiet = v }
let quiet = false
function tone(freqs: number[], dur = 0.09, vol = 0.07, sink?: string) {
  if (quiet) return
  try {
    const c = get(); if (c.state === 'suspended') c.resume()
    const t0 = c.currentTime
    freqs.forEach((f, i) => {
      const o = c.createOscillator(), g = c.createGain()
      o.type = 'sine'; o.frequency.value = f
      g.gain.setValueAtTime(0.0001, t0 + i * dur); g.gain.exponentialRampToValueAtTime(vol, t0 + i * dur + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t0 + (i + 1) * dur)
      o.connect(g); g.connect(c.destination); o.start(t0 + i * dur); o.stop(t0 + (i + 1) * dur + 0.02)
    })
    void sink
  } catch { /* audio blocked */ }
}
export const sfx = {
  join: () => tone([520, 780]), leave: () => tone([620, 400]), mute: () => tone([330], 0.08, 0.05), unmute: () => tone([440], 0.08, 0.05),
  deafen: () => tone([330, 250], 0.07, 0.05), undeafen: () => tone([300, 440], 0.07, 0.05), notify: () => tone([880, 1175], 0.07, 0.05), sent: () => tone([660], 0.05, 0.03)
}
