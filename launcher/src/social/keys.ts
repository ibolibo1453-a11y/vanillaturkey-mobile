// Keybind strings shared by launcher (renderer + main) and the game mod: tokens joined by '+', upper case.
// Modifiers: CTRL SHIFT ALT META. Main key: A..Z, 0..9, F1..F24, SPACE, ENTER, TAB, CAPSLOCK, ARROWUP, NUMPAD0,
// BACKQUOTE ..., or a mouse button MOUSE4 / MOUSE5 (side buttons; MOUSE1-3 = left/right/middle). Example: "CTRL+SHIFT+M", "MOUSE4".
export const MODS = ['CTRL', 'SHIFT', 'ALT', 'META']
const MOD_ALIAS: Record<string, string> = { CONTROL: 'CTRL', CTRLRIGHT: 'CTRL', CONTROLLEFT: 'CTRL', CONTROLRIGHT: 'CTRL', SHIFTLEFT: 'SHIFT', SHIFTRIGHT: 'SHIFT', ALTLEFT: 'ALT', ALTRIGHT: 'ALT', METALEFT: 'META', METARIGHT: 'META', CMD: 'META', WIN: 'META', OPTION: 'ALT' }

export function normalizeKey(c: string): string {
  const parts = String(c || '').split('+').map((p) => p.trim().toUpperCase()).filter(Boolean).map((p) => MOD_ALIAS[p] || p)
  const mods = MODS.filter((m) => parts.includes(m))
  const main = parts.filter((p) => !MODS.includes(p)).pop() || ''
  return [...mods, main].filter(Boolean).join('+')
}
export function keyFromUiohook(n: string): string { const u = n.toUpperCase(); return MOD_ALIAS[u] || u }
export function parseCombo(c: string): { main: string; mods: string[]; accel: string } {
  const parts = normalizeKey(c).split('+').filter(Boolean)
  const mods = parts.filter((p) => MODS.includes(p)); const main = parts.filter((p) => !MODS.includes(p))[0] || ''
  const map: Record<string, string> = { CTRL: 'Control', META: 'Super', SPACE: 'Space', ENTER: 'Return', ESCAPE: 'Esc', ARROWUP: 'Up', ARROWDOWN: 'Down', ARROWLEFT: 'Left', ARROWRIGHT: 'Right', BACKQUOTE: '`', CAPSLOCK: 'Capslock' }
  const m = (x: string) => map[x] || (x.length === 1 ? x : x[0] + x.slice(1).toLowerCase())
  return { main, mods, accel: [...mods.map(m), m(main)].join('+') }
}
/** Browser KeyboardEvent -> normalized main key (modifier-only presses return the modifier). */
export function keyFromEvent(e: KeyboardEvent): string {
  const code = e.code || ''
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  const u = code.toUpperCase()
  return MOD_ALIAS[u] || u
}
export function comboFromEvent(e: KeyboardEvent): string {
  const k = keyFromEvent(e)
  const mods = [e.ctrlKey && 'CTRL', e.shiftKey && 'SHIFT', e.altKey && 'ALT', e.metaKey && 'META'].filter(Boolean) as string[]
  return normalizeKey([...mods, k].join('+'))
}
/** MouseEvent.button (0 left,1 middle,2 right,3 back,4 forward) -> MOUSEn */
export const mouseName = (button: number) => ({ 0: 'MOUSE1', 1: 'MOUSE3', 2: 'MOUSE2' } as Record<number, string>)[button] || 'MOUSE' + (button + 1)
const TR: Record<string, string> = { CTRL: 'Ctrl', SHIFT: 'Shift', ALT: 'Alt', META: 'Win', SPACE: 'Boşluk', ENTER: 'Enter', ESCAPE: 'Esc', TAB: 'Tab', CAPSLOCK: 'Caps Lock', BACKSPACE: 'Geri Sil', ARROWUP: 'Yukarı Ok', ARROWDOWN: 'Aşağı Ok', ARROWLEFT: 'Sol Ok', ARROWRIGHT: 'Sağ Ok', BACKQUOTE: '`', INSERT: 'Insert', DELETE: 'Delete', HOME: 'Home', END: 'End', PAGEUP: 'Page Up', PAGEDOWN: 'Page Down' }
export function displayCombo(c: string): string {
  if (!c) return 'Atanmadı'
  return normalizeKey(c).split('+').map((p) => { const m = /^MOUSE(\d+)$/.exec(p); if (m) return m[1] === '1' ? 'Sol Tık' : m[1] === '2' ? 'Sağ Tık' : m[1] === '3' ? 'Orta Tık' : `Fare ${m[1]}`; return TR[p] || (p.startsWith('NUMPAD') ? 'Numpad ' + p.slice(6) : p) }).join(' + ')
}
