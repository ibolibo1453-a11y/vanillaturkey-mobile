// RNNoise (WASM, MIT) AudioWorklet loader. Everything is bundled: the worklet source becomes a Blob URL and the wasm binary is
// inlined as base64 (no CDN, no file:// fetch). Failure is sticky for the session: the caller falls back to the gate-only
// pipeline and shows one toast.
import workletSrc from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?raw'
import { RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor'
import { wasmPlain, wasmSimd } from './rnnoise-wasm'

let binary: ArrayBuffer | null = null
let workletUrl = ''
let patched = false
let broken = ''
let noticed = false
const loaded = new WeakSet<BaseAudioContext>()

const simd = () => { try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])) } catch { return false } }
function decode(b64: string): ArrayBuffer {
  const b = atob(b64); const u = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i)
  return u.buffer
}

/** true exactly once after the suppressor broke (one toast per session) */
export const takeBrokenNotice = () => { if (noticed) return false; noticed = true; return true }
export const denoiseBroken = () => broken
export function markDenoiseBroken(why: string) { broken = why || 'unknown' }

/** The stock worklet throws away RNNoise's per-frame voice probability (return value of rnnoise_process_frame). Patch it to post that
 *  value to the main thread every ~32 ms. If the bundle layout ever changes the patch is a no-op and the caller uses heuristics only. */
function patchWorklet(src: string): string {
  const a = 't.processFrame(e),d(e)}', b = 'this.processor.process(e[0],t[0])'
  if (!src.includes(a) || !src.includes(b)) return src
  return src.replace(a, 'globalThis.__vad=t.processFrame(e),d(e)}').replace(b, b + ',(this.__c=(this.__c||0)+1)%12===0&&this.port.postMessage({vad:globalThis.__vad})')
}
export const denoiseHasVad = () => patched

/** Creates the RNNoise node on a 48 kHz context. Throws (and marks the feature broken) when the worklet/wasm cannot start. */
export async function createDenoise(ctx: AudioContext): Promise<AudioWorkletNode> {
  if (broken) throw new Error(broken)
  try {
    if (ctx.sampleRate !== 48000) throw new Error('RNNoise needs 48 kHz (got ' + ctx.sampleRate + ')')
    if (!ctx.audioWorklet) throw new Error('AudioWorklet unavailable')
    if (!binary) binary = decode(simd() ? wasmSimd : wasmPlain)
    if (!workletUrl) { const ps = patchWorklet(workletSrc); patched = ps !== workletSrc; workletUrl = URL.createObjectURL(new Blob([ps], { type: 'text/javascript' })) }
    if (!loaded.has(ctx)) { await ctx.audioWorklet.addModule(workletUrl); loaded.add(ctx) }
    return new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: binary })
  } catch (e: any) {
    broken = String(e?.message || e); throw e
  }
}
