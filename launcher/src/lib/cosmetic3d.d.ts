export interface Cosmetic3D {
  id: string; slot: string; bone: 'head' | 'body' | 'back' | 'pet' | 'aura' | 'hit'; object: any; json: any
  update(t: number, state?: Record<string, number>): void
  dispose(): void
}
export function buildCosmetic(THREE: any, json: any, texture: any, opts?: Record<string, any>): Cosmetic3D
export function tintTemplate(THREE: any, img: HTMLImageElement, a: number, b: number): any
export function capeAngles(n: number, t: number, lean: number, side: number, fwd: number, vy: number, outRx: Float32Array, outRz: Float32Array, params?: { flutter: number; waveSpeed: number; wavelength: number; billow: number } | null): void
export function wave(phase: number, shape?: string): number
export function ease(id: string, u: number): number
/** R5-E cape cloth: verlet chain, 1:1 port of the mod's CapeChain.java (rx / rz = relative segment rotations in degrees) */
export class CapeChain {
  rx: Float64Array; rz: Float64Array; windScale: number
  reset(): void
  step(dt: number, x: number, y: number, z: number, yawDeg: number, leanDeg: number, sneak: number, elyPx: number, t: number): void
}
