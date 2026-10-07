// VanillaTurkey cosmetics -> three.js.  Mirrors cosmetics/src/.../data/Mesh.java + render/Emitter.java + Sim.computeCape().
// Every animation channel is evaluated from time + a small state object, exactly like the game (see FORMAT.md "Animation").
// Usage:
//   import * as THREE from 'three'
//   import { loadCosmetic } from './cosmetic3d.mjs'
//   const c = await loadCosmetic(THREE, '/models/', 'hat_crown_gold')   // c.object, c.bone, c.update(t, state), c.dispose()
//   skin.head.add(c.object)            // bone 'head'  -> skinview3d player.skin.head  (origin = neck)
//   skin.add(c.object)                 // 'body' | 'back' -> player.skin   (origin = neck)
//   c.object.position.y = -24; skin.add(c.object)   // 'pet' | 'aura' (origin = feet centre, feet are 24 px below the neck)
//   // every frame:  c.update(seconds, { mv, walkClock, flapAmp, flapClock, lean, side, fwd, vy, yawRate, lookYaw, lookPitch })   (all optional)
//   // without a state object a gentle "demo" sway is simulated so hats/capes/pets move like a slow walk-in-place.
// All units are Minecraft model pixels (1 px = 1 skinview3d unit).

const DEG = Math.PI / 180

/** Corner order TL,TR,BR,BL as seen from outside, in model space (y down, front = -z). */
function faceCorners(f, x0, y0, z0, x1, y1, z1) {
  switch (f) {
    case 'front':  return { c: [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0]], n: [0,0,-1] }
    case 'back':   return { c: [[x1,y0,z1],[x0,y0,z1],[x0,y1,z1],[x1,y1,z1]], n: [0,0,1] }
    case 'right':  return { c: [[x0,y0,z1],[x0,y0,z0],[x0,y1,z0],[x0,y1,z1]], n: [-1,0,0] }
    case 'left':   return { c: [[x1,y0,z0],[x1,y0,z1],[x1,y1,z1],[x1,y1,z0]], n: [1,0,0] }
    case 'top':    return { c: [[x1,y0,z0],[x0,y0,z0],[x0,y0,z1],[x1,y0,z1]], n: [0,-1,0] }
    default:       return { c: [[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]], n: [0,1,0] }
  }
}
const FACES = ['top', 'bottom', 'right', 'front', 'left', 'back']
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** sd > 1 splits every face into up to sd x sd cells of ~2.5 px (same rule as Node.subdivide in the mod). */
function boxGeometry(THREE, boxes, tw, th, sd, fc = 63) {
  const pos = [], nor = [], uv = [], idx = []
  for (const b of boxes) {
    const [x0, y0, z0] = b.from, [x1, y1, z1] = b.to
    for (let fi = 0; fi < FACES.length; fi++) {
      if (!(fc & (1 << fi))) continue
      const f = FACES[fi]
      const { c, n } = faceCorners(f, x0, y0, z0, x1, y1, z1)
      const [fu, fv, fw, fh] = b.uv[f]
      const t = [[fu, fv], [fu + fw, fv], [fu + fw, fv + fh], [fu, fv + fh]]
      const NU = sd > 1 ? Math.min(sd, Math.max(1, Math.floor(dist(c[0], c[1]) / 2.5))) : 1
      const NV = sd > 1 ? Math.min(sd, Math.max(1, Math.floor(dist(c[0], c[3]) / 2.5))) : 1
      for (let cv = 0; cv < NV; cv++) {
        for (let cu = 0; cu < NU; cu++) {
          const base = pos.length / 3
          const us = [cu / NU, (cu + 1) / NU, (cu + 1) / NU, cu / NU], vs = [cv / NV, cv / NV, (cv + 1) / NV, (cv + 1) / NV]
          for (let k = 0; k < 4; k++) {
            const u = us[k], v = vs[k]
            for (let a = 0; a < 3; a++) pos.push(c[0][a] + (c[1][a] - c[0][a]) * u + (c[3][a] - c[0][a]) * v)
            nor.push(...n)
            uv.push((t[0][0] + (t[1][0] - t[0][0]) * u) / tw, (t[0][1] + (t[3][1] - t[0][1]) * v) / th)
          }
          idx.push(base, base + 3, base + 2, base, base + 2, base + 1)
        }
      }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  return g
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

// R5-E easing (same ids / formulas as Emitter.ease): linear outCubic outQuart outExpo inOutCubic outBack inCubic outSine inOutSine outElastic
export function ease(id, u) {
  if (u <= 0) return 0
  if (u >= 1) return 1
  switch (id) {
    case 'outCubic': return 1 - (1 - u) ** 3
    case 'outQuart': return 1 - (1 - u) ** 4
    case 'outExpo': return 1 - 2 ** (-10 * u)
    case 'inOutCubic': return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2
    case 'outBack': { const v = u - 1; return 1 + 2.70158 * v * v * v + 1.70158 * v * v }
    case 'inCubic': return u * u * u
    case 'outSine': return Math.sin(u * Math.PI / 2)
    case 'inOutSine': return 0.5 - 0.5 * Math.cos(Math.PI * u)
    case 'outElastic': return -(2 ** (-10 * u)) * Math.sin((u * 10 - 0.75) * (2 * Math.PI / 3)) + 1
    default: return u
  }
}
const smooth01 = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x) }
/** alpha / scale envelope of a rising particle (replaces the old sqrt(sin)): eased in over the first 18 %, out over the last 50 % */
const riseEnv = (f) => smooth01(f / 0.18) * smooth01((1 - f) / 0.5)

/** -1..1 waveform for a phase in radians: sine | flap (fast eased down stroke, slow up stroke) | triangle | snap */
export function wave(ph, wf) {
  switch (wf) {
    case 'flap': {
      let u = ph / (2 * Math.PI); u -= Math.floor(u)
      return u < 0.36 ? Math.cos(Math.PI * u / 0.36) : -Math.cos(Math.PI * (u - 0.36) / 0.64)
    }
    case 'triangle': return Math.asin(Math.sin(ph)) * (2 / Math.PI)
    case 'snap': { const s = Math.sin(ph); const m = Math.pow(Math.abs(s), 0.45); return s < 0 ? -m : m }
    default: return Math.sin(ph)
  }
}

/** axis: 0 rx, 1 ry, 2 rz (selects the physics input for gain=physics) */
function ang(a, s, t, axis) {
  if (!a) return 0
  let amp = a.amp, clock = t, v = a.base
  const g = a.gain
  if (g === 'physics') {
    const ph = axis === 2 ? s.side / 28 : axis === 0 ? (s.lean - 6) / 30 : s.yawRate / 200
    v += amp * clamp(ph, -1.5, 1.5)
    if (a.idle) v += a.idle * Math.sin(a.speed * clock + a.phase)
    return v * DEG
  }
  if (g === 'move') { amp *= s.mv; clock = s.walkClock }
  else if (g === 'flap') { amp *= s.flapAmp; clock = s.flapClock }
  if (amp) v += amp * wave(a.speed * clock + a.phase, a.wave)
  return v * DEG
}

function burst(b, s, t) {
  let g = 1
  if (b.gain === 'idle') g = clamp(1 - s.mv * 2.5, 0, 1)
  else if (b.gain === 'moving') g = clamp(s.mv * 2.5, 0, 1)
  if (g <= 0.001) return 0
  let f = t / b.period + b.phase01; f -= Math.floor(f)
  if (f >= b.width) return 0
  const x = f / b.width
  let e = Math.sin(Math.PI * x)
  e = b.shape === 'wiggle' ? e * e * Math.sin(6 * Math.PI * x) : e * e
  return b.amp * e * g
}

/** Cape spring output for n segments (degrees); params = { flutter, waveSpeed, wavelength, billow } (same formula as Emitter). */
export function capeAngles(n, t, lean, side, fwd, vy, outRx, outRz, params) {
  const cf = params ? params.flutter : 1, cs = params ? params.waveSpeed : 1, cw = params ? params.wavelength : 1, bill = params ? params.billow : 0
  const flutter = (1.2 + 1.6 * Math.min(Math.abs(fwd), 6) + 0.7 * Math.min(Math.abs(vy), 6)) * cf + bill
  const cn = Math.max(1, n - 1)
  for (let i = 0; i < n; i++) {
    const base = i === 0 ? lean * 0.46 : (lean * 0.54) / cn
    const w1 = flutter * Math.sin(t * 5.2 * cs - i * 0.95 * cw) * (0.35 + (0.65 * i) / cn)
    outRx[i] = base + w1
    outRz[i] = (side / n) * 1.2 + (0.45 * flutter * Math.sin(t * 3.1 * cs - i * 0.8 * cw + 1.3)) / n * 2
  }
}

// ---------------------------------------------------------------- R5-E cape cloth v2 (body-frame spring chain) - 1:1 port of render/CapeChain.java
const CN = 6, CH = 1 / 120, CSEG = 3, CHALF_W = 5, CPLANE = 2.0, CTELEPORT = 4.0, CP0 = 4.5
const wrapDeg = (a) => { a %= 360; if (a >= 180) a -= 360; if (a < -180) a += 360; return a }
const cclamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const cmargin = (cy) => { const m = 0.10 + 0.045 * cy; return m > 0.8 ? 0.8 : m }
export class CapeChain {
  constructor() {
    const f = () => new Float64Array(CN)
    this.rx = f(); this.rz = f()                      // degrees, RELATIVE segment rotations about X / Z (applied as Rz * Rx)
    this.jx = new Float64Array(CN + 1); this.jy = new Float64Array(CN + 1); this.jz = new Float64Array(CN + 1)
    this.a = f(); this.b = f(); this.av = f(); this.bv = f(); this.pa = f(); this.pb = f(); this.ta = f(); this.tb = f()
    this.oa = f(); this.ob = f()                      // interpolated absolute angles (rad, model frame)
    this.init = false; this.windScale = 1; this.legOff = 0; this.resetFlag = false
    this.pX = 0; this.pY = 0; this.pZ = 0; this.pYaw = 0; this.pLean = 0; this.pSneak = 0; this.pEly = 0
    this.fVf = 0; this.fVl = 0; this.fVu = 0; this.fW = 0; this.phiF = 0; this.acc = 0
    this.sneak = 0; this.ely = 0; this.lean = 0; this.th = 0; this.st = 0; this.ct = 1; this.rox = 0; this.roy = 0; this.roz = 0
  }
  reset() { this.init = false }
  /** dt seconds (any frame time), feet position (blocks), yaw / lean (deg), sneak 0..1, ely root offset (px), t wind phase (s) */
  step(dt, px, py, pz, yaw, lean, sneak, ely, t) {
    this.resetFlag = false
    let disp = Math.abs(px - this.pX) + Math.abs(pz - this.pZ) + Math.abs(py - this.pY)
    if (!this.init) { this.hardReset(px, py, pz, yaw, lean, sneak, ely); this.output(); return }
    if (dt <= 0.0005 && disp < 1e-9) { this.sneak = sneak; this.ely = ely; this.lean = lean; this.pSneak = sneak; this.pEly = ely; this.pLean = lean; this.fix(); this.output(); return }
    const rawSp = Math.hypot(px - this.pX, pz - this.pZ) / Math.max(dt, 0.0005)
    if (disp > CTELEPORT || dt > 5 || rawSp > 60 || Math.abs(py - this.pY) / Math.max(dt, 0.0005) > 120) {
      this.pX = px; this.pY = py; this.pZ = pz; this.pYaw = yaw
      this.fVf = this.fVl = this.fVu = this.fW = 0
      this.resetFlag = true
      if (dt > 5) this.hardReset(px, py, pz, yaw, lean, sneak, ely)
      dt = Math.min(dt, 0.1); disp = 0
    }
    if (dt < 0.0005) dt = 0.0005
    const vdt = dt
    if (dt > 0.1) dt = 0.1
    let vx = (px - this.pX) / vdt, vy = (py - this.pY) / vdt, vz = (pz - this.pZ) / vdt
    const w = cclamp(wrapDeg(yaw - this.pYaw) / vdt, -720, 720)
    const sp = Math.sqrt(vx * vx + vz * vz)
    if (sp > 14) { const k = 14 / sp; vx *= k; vz *= k }
    vy = cclamp(vy, -40, 20)
    const psi = yaw * Math.PI / 180, phi = lean * Math.PI / 180
    const sps = Math.sin(psi), cps = Math.cos(psi), sf = Math.sin(phi), cf = Math.cos(phi)
    const tvl = vx * cps + vz * sps
    const tvu = vx * (-sf * sps) + vy * cf + vz * (sf * cps)
    const tvf = vx * (-cf * sps) + vy * (-sf) + vz * (cf * cps)
    this.acc += dt
    let n = Math.floor(this.acc / CH)
    if (n > 24) n = 24
    this.acc -= n * CH
    if (this.acc > CH) this.acc = 0
    const kv = 1 - Math.exp(-CH / 0.13), kw = 1 - Math.exp(-CH / 0.09)
    for (let s = 1; s <= n; s++) {
      this.sneak = sneak; this.ely = ely; this.lean = lean   // crouch / lean / elytra are applied instantly by the pose stack
      this.fVf += (tvf - this.fVf) * kv; this.fVl += (tvl - this.fVl) * kv; this.fVu += (tvu - this.fVu) * kv
      this.fW += (w - this.fW) * kw
      this.integrate(CH, t - (n - s) * CH)
    }
    this.sneak = sneak; this.ely = ely; this.lean = lean
    this.pX = px; this.pY = py; this.pZ = pz; this.pYaw = yaw; this.pLean = lean; this.pSneak = sneak; this.pEly = ely
    this.fix()
    this.output()
  }
  hardReset(px, py, pz, yaw, lean, sneak, ely) {
    this.pX = px; this.pY = py; this.pZ = pz; this.pYaw = yaw; this.pLean = lean; this.pSneak = sneak; this.pEly = ely
    this.sneak = sneak; this.ely = ely; this.lean = lean
    this.fVf = this.fVl = this.fVu = this.fW = 0
    this.phiF = lean * Math.PI / 180
    this.acc = 0
    const p0 = CP0 * Math.PI / 180
    for (let i = 0; i < CN; i++) { this.a[i] = this.pa[i] = p0; this.b[i] = this.pb[i] = 0; this.av[i] = this.bv[i] = 0 }
    this.init = true; this.resetFlag = true
    this.pose(); this.collide()
    for (let i = 0; i < CN; i++) { this.pa[i] = this.a[i]; this.pb[i] = this.b[i] }
  }
  /** the pose of the frame (crouch / elytra) may differ from the one the last substep collided with: push both interpolation states out of the body */
  fix() {
    this.pose(); this.collide()
    const a = this.a, b = this.b, pa = this.pa, pb = this.pb, ta = this.ta, tb = this.tb
    for (let i = 0; i < CN; i++) { ta[i] = a[i]; tb[i] = b[i]; a[i] = pa[i]; b[i] = pb[i] }
    this.collide()
    for (let i = 0; i < CN; i++) { pa[i] = a[i]; pb[i] = b[i]; a[i] = ta[i]; b[i] = tb[i] }
  }
  pose() {
    this.th = 0.5 * this.sneak; this.st = Math.sin(this.th); this.ct = Math.cos(this.th)
    this.rox = 0; this.roy = 3.2 * this.sneak - this.st * this.ely; this.roz = this.ct * this.ely
  }
  integrate(h, t) {
    this.pose()
    const a = this.a, b = this.b, av = this.av, bv = this.bv, ta = this.ta, tb = this.tb
    this.phiF += (this.lean * Math.PI / 180 - this.phiF) * (1 - Math.exp(-h / 0.15))
    const phi = this.phiF, vf = this.fVf, vu = this.fVu
    const lf = vf >= 0 ? 36 * Math.tanh(vf / 5.2) : 5 * Math.tanh(vf / 3)
    const lu = vu < 0 ? 26 * Math.tanh(-vu / 8) : -9 * Math.tanh(vu / 6)
    const lift = lf + lu
    const sway = -20 * Math.tanh(this.fVl / 4.5) + 15 * Math.tanh(this.fW / 220)
    const ws = this.windScale
    for (let i = 0; i < CN; i++) {
      const wg = 0.30 + 0.70 * i / (CN - 1)
      const idleP = ws * 0.45 * Math.sin(0.8 * t + 0.7 * i) * wg
      const idleR = ws * 0.55 * Math.sin(0.55 * t + 0.9 * i + 1.0) * wg
      ta[i] = (CP0 + wg * lift + idleP) * Math.PI / 180 - phi
      tb[i] = (wg * sway + idleR) * Math.PI / 180
    }
    for (let i = 0; i < CN; i++) { this.pa[i] = a[i]; this.pb[i] = b[i] }
    for (let i = 0; i < CN; i++) {
      const f = 2.5 - 1.1 * i / (CN - 1), w0 = 2 * Math.PI * f, zeta = 1.15
      const ap = i > 0 ? a[i - 1] : a[0], an = i < CN - 1 ? a[i + 1] : a[i]
      const bp = i > 0 ? b[i - 1] : b[0], bn = i < CN - 1 ? b[i + 1] : b[i]
      const kc = 38
      av[i] = cclamp(av[i] + (w0 * w0 * (ta[i] - a[i]) - 2 * zeta * w0 * av[i] + kc * (ap + an - 2 * a[i])) * h, -3, 3)   // cloth never swings faster than ~170 deg/s
      bv[i] = cclamp(bv[i] + (w0 * w0 * (tb[i] - b[i]) - 2 * zeta * w0 * bv[i] + kc * (bp + bn - 2 * b[i])) * h, -3, 3)
    }
    for (let i = 0; i < CN; i++) {
      a[i] = cclamp(a[i] + av[i] * h, -1.2, 1.45)
      b[i] = cclamp(b[i] + bv[i] * h, -0.9, 0.9)
    }
    this.collide()
  }
  violation(cx, cy, cz) {
    let v = 0
    if (cy > -1 && cy < 13 && cx > -5.6 && cx < 5.6) { const need = CPLANE + cmargin(cy) - cz; if (need > v) v = need }
    const mz = this.roz + this.st * cy + this.ct * cz, my = this.roy + this.ct * cy - this.st * cz
    if (my > 11.5 && my < 25 && cx > -5.6 && cx < 5.6) { const need = CPLANE + Math.max(this.legOff, this.ely) + 0.45 - mz; if (need > v) v = need }
    return v
  }
  collide() {
    const a = this.a, b = this.b, av = this.av, ct = this.ct, st = this.st
    for (let pass = 0; pass < 3; pass++) {
      let moved = false
      let a00 = 1, a01 = 0, a02 = 0, a10 = 0, a11 = 1, a12 = 0, a20 = 0, a21 = 0, a22 = 1
      let px = 0, py = 0, pz = 2
      for (let i = 0; i < CN; i++) {
        const sa = Math.sin(a[i]), ca = Math.cos(a[i]), sb = Math.sin(b[i]), cb = Math.cos(b[i])
        const dxm = sb * ca, dym = cb * ca, dzm = sa
        const drx = dxm, dry = ct * dym + st * dzm, drz = -st * dym + ct * dzm
        const lx0 = a00 * drx + a10 * dry + a20 * drz, ly0 = a01 * drx + a11 * dry + a21 * drz, lz0 = a02 * drx + a12 * dry + a22 * drz
        const ra = Math.asin(cclamp(lz0, -1, 1)), rb = Math.atan2(-lx0, ly0)
        const sra = Math.sin(ra), cra = Math.cos(ra), srb = Math.sin(rb), crb = Math.cos(rb)
        const m00 = crb, m10 = srb, m20 = 0, m01 = -cra * srb, m11 = cra * crb, m21 = sra, m02 = sra * srb, m12 = -sra * crb, m22 = cra
        const n00 = a00 * m00 + a01 * m10 + a02 * m20, n01 = a00 * m01 + a01 * m11 + a02 * m21, n02 = a00 * m02 + a01 * m12 + a02 * m22
        const n10 = a10 * m00 + a11 * m10 + a12 * m20, n11 = a10 * m01 + a11 * m11 + a12 * m21, n12 = a10 * m02 + a11 * m12 + a12 * m22
        const n20 = a20 * m00 + a21 * m10 + a22 * m20, n21 = a20 * m01 + a21 * m11 + a22 * m21, n22 = a20 * m02 + a21 * m12 + a22 * m22
        a00 = n00; a01 = n01; a02 = n02; a10 = n10; a11 = n11; a12 = n12; a20 = n20; a21 = n21; a22 = n22
        const ex = px + a01 * CSEG, ey = py + a11 * CSEG, ez = pz + a21 * CSEG
        const wx = a00 * CHALF_W, wy = a10 * CHALF_W, wz = a20 * CHALF_W
        this.jx[i] = px; this.jy[i] = py; this.jz[i] = pz; this.jx[i + 1] = ex; this.jy[i + 1] = ey; this.jz[i + 1] = ez
        let need = this.violation(ex, ey, ez)
        need = Math.max(need, this.violation(ex - wx, ey - wy, ez - wz))
        need = Math.max(need, this.violation(ex + wx, ey + wy, ez + wz))
        if (need > 1e-6) {
          let da = need / (CSEG * Math.max(0.35, Math.cos(a[i])))
          if (da > 0.5) da = 0.5
          a[i] += da
          if (av[i] < 0) av[i] *= 0.2
          moved = true
        }
        px = ex; py = ey; pz = ez
      }
      if (!moved) break
    }
  }
  output() {
    const al = cclamp(this.acc / CH, 0, 1)
    const a = this.a, b = this.b, pa = this.pa, pb = this.pb, oa = this.oa, ob = this.ob
    for (let i = 0; i < CN; i++) { oa[i] = pa[i] + (a[i] - pa[i]) * al; ob[i] = pb[i] + (b[i] - pb[i]) * al }
    this.pose()
    const ct = this.ct, st = this.st
    let a00 = 1, a01 = 0, a02 = 0, a10 = 0, a11 = 1, a12 = 0, a20 = 0, a21 = 0, a22 = 1
    for (let i = 0; i < CN; i++) {
      const sa = Math.sin(oa[i]), ca = Math.cos(oa[i]), sb = Math.sin(ob[i]), cb = Math.cos(ob[i])
      const dxm = sb * ca, dym = cb * ca, dzm = sa
      const drx = dxm, dry = ct * dym + st * dzm, drz = -st * dym + ct * dzm
      const lx0 = a00 * drx + a10 * dry + a20 * drz, ly0 = a01 * drx + a11 * dry + a21 * drz, lz0 = a02 * drx + a12 * dry + a22 * drz
      const ra = Math.asin(cclamp(lz0, -1, 1)), rb = Math.atan2(-lx0, ly0)
      this.rx[i] = ra * 180 / Math.PI; this.rz[i] = rb * 180 / Math.PI
      const sra = Math.sin(ra), cra = Math.cos(ra), srb = Math.sin(rb), crb = Math.cos(rb)
      const m00 = crb, m10 = srb, m20 = 0, m01 = -cra * srb, m11 = cra * crb, m21 = sra, m02 = sra * srb, m12 = -sra * crb, m22 = cra
      const n00 = a00 * m00 + a01 * m10 + a02 * m20, n01 = a00 * m01 + a01 * m11 + a02 * m21, n02 = a00 * m02 + a01 * m12 + a02 * m22
      const n10 = a10 * m00 + a11 * m10 + a12 * m20, n11 = a10 * m01 + a11 * m11 + a12 * m21, n12 = a10 * m02 + a11 * m12 + a12 * m22
      const n20 = a20 * m00 + a21 * m10 + a22 * m20, n21 = a20 * m01 + a21 * m11 + a22 * m21, n22 = a20 * m02 + a21 * m12 + a22 * m22
      a00 = n00; a01 = n01; a02 = n02; a10 = n10; a11 = n11; a12 = n12; a20 = n20; a21 = n21; a22 = n22
    }
  }
}

/** Scripted player the launcher preview drives the cape chain with (a 12 s loop: idle, walk, stop, turn, crouch) - or the caller's own state. */
function demoMotion(t, o) {
  const T = ((t % 12) + 12) % 12
  const sm = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u) }
  o.speed = 2.3 * (sm(2.6, 3.6, T) - sm(6.6, 7.8, T))
  o.yawRate = T > 8.0 && T < 8.7 ? 130 * Math.sin(Math.PI * (T - 8.0) / 0.7) : 0
  o.sneak = sm(9.6, 9.9, T) - sm(11.2, 11.5, T)
  return o
}

// ---------------------------------------------------------------- colour fx (same maths as Emitter.fxColor)
const hueRGB = (h) => { h = (h - Math.floor(h)) * 6; return [clamp(Math.abs(h - 3) - 1, 0, 1), clamp(2 - Math.abs(h - 2), 0, 1), clamp(2 - Math.abs(h - 4), 0, 1)] }
const OUT = [0, 0, 0, 0]
function fxColor(fx, baseA, s, t, trans) {
  let r = fx.tint[0], g = fx.tint[1], b = fx.tint[2], a = baseA
  if (fx.hue) {
    const h = hueRGB(fx.hue.phase + fx.hue.speed * t + fx.hue.space * s), k = fx.hue.strength
    r += (h[0] - r) * k; g += (h[1] - g) * k; b += (h[2] - b) * k
  }
  if (fx.band) {
    let w = fx.band.space * s - fx.band.speed * t; w -= Math.floor(w)
    let band = 1 - Math.abs(w - 0.5) * 2 / Math.max(0.01, fx.band.width)
    if (band < 0) band = 0
    band = band * band * (3 - 2 * band)
    const bv = fx.band.base + (fx.band.peak - fx.band.base) * band
    if (trans) a *= bv; else { r *= bv; g *= bv; b *= bv }
  }
  let mul = 1
  if (fx.pulse) mul *= 1 - fx.pulse.depth * (0.5 - 0.5 * Math.sin(fx.pulse.speed * t + fx.pulse.phase))
  if (fx.flicker) {
    const q = fx.flicker.speed * t + fx.flicker.seed
    mul *= 1 - fx.flicker.depth * (0.5 + 0.25 * Math.sin(q) + 0.15 * Math.sin(2.7 * q + 1.3) + 0.1 * Math.sin(6.1 * q + 0.4))
  }
  if (trans) a *= mul; else { r *= mul; g *= mul; b *= mul }
  OUT[0] = r; OUT[1] = g; OUT[2] = b; OUT[3] = a
  return OUT
}

export function buildCosmetic(THREE, json, texture, opts = {}) {
  texture.flipY = false
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  if ('colorSpace' in texture) texture.colorSpace = THREE.SRGBColorSpace
  else texture.encoding = THREE.sRGBEncoding
  const [tw, th] = json.texSize
  const unlit = !!opts.unlit
  const particleScale = opts.particleScale ?? 0.4
  const mats = []
  const mat = (glow, alpha, vcol) => {
    const trans = alpha < 0.999
    const p = { map: texture, side: THREE.DoubleSide, alphaTest: 0.1, transparent: trans, opacity: vcol ? 1 : alpha, depthWrite: !trans, vertexColors: !!vcol }
    const m = glow || unlit ? new THREE.MeshBasicMaterial(p) : new THREE.MeshLambertMaterial(p)
    mats.push(m)
    return m
  }
  const nodes = []
  const root = new THREE.Group() // y-flip: model space (y down, front -z) -> three (y up, front +z)
  root.rotation.x = Math.PI
  const capeRx = new Float32Array(16), capeRz = new Float32Array(16)
  let capeN = 0
  let capeParams = null
  const chain = new CapeChain(); chain.windScale = 2.4
  const sim = { lastT: null, x: 0, z: 0, yaw: 180, speed: 0, demo: { speed: 0, yawRate: 0, sneak: 0 } }

  function build(p, parent, isRoot) {
    const outer = new THREE.Group()   // translate(pivot + offsets) * Rz Ry Rx * scale
    outer.rotation.order = 'ZYX'
    const inner = new THREE.Group()   // translate(-pivot)
    inner.position.set(-p.pivot[0], -p.pivot[1], -p.pivot[2])
    outer.add(inner)
    parent.add(outer)
    const a = p.anim
    let fxn = null, mesh0 = null
    if (isRoot && a && a.capeParams) capeParams = a.capeParams
    if (p.boxes) {
      const alpha = p.alpha ?? 1
      const geo = boxGeometry(THREE, p.boxes, tw, th, p.subdivide || 1, p.faceMask ?? 63)
      let m
      if (a && a.fx) {
        const n = geo.attributes.position.count
        const col = new Float32Array(n * 4)
        geo.setAttribute('color', new THREE.BufferAttribute(col, 4))
        const d = a.fx.dir || [0, 1, 0]
        const sp = new Float32Array(n), P = geo.attributes.position.array
        for (let i = 0; i < n; i++) sp[i] = (P[i * 3] * d[0] + P[i * 3 + 1] * d[1] + P[i * 3 + 2] * d[2]) / 16 // blocks, like the mod
        fxn = { fx: a.fx, col, sp, n, baseA: alpha < 0.999 ? alpha : 1, trans: alpha < 0.999, attr: geo.attributes.color }
        m = mat(!!p.glow, alpha, true)
      } else m = mat(!!p.glow, alpha, false)
      const mesh = new THREE.Mesh(geo, m)
      mesh.frustumCulled = false
      inner.add(mesh)
      mesh0 = m
    }
    nodes.push({ p, outer, fxn, mat: p.boxes && !fxn ? mesh0 : null, alpha0: p.alpha ?? 1 })
    if (p.capeSegment) capeN = Math.max(capeN, p.capeSegment.count)
    for (const c of p.children || []) build(c, inner, false)
  }
  build(json.root, root, true)
  let hitLife = 0
  for (const { p } of nodes) { const e = p.anim && p.anim.effect; if (e) hitLife = Math.max(hitLife, e.start + e.dur) }

  const S = { mv: 0, walkClock: 0, flapAmp: 0.4, flapClock: 0, lean: 6, side: 0, fwd: 0, vy: 0, yawRate: 0, lookYaw: 0, lookPitch: 0 }
  function update(t, state) {
    let s = S
    if (state) Object.assign(S, state)
    else {   // demo sway: a slow walk-in-place wobble so physics-driven parts (capes, hats, tails) show their motion
      S.side = 6 * Math.sin(t * 0.9); S.lean = 6 + 3 * (0.5 + 0.5 * Math.sin(t * 0.5)); S.yawRate = 40 * Math.sin(t * 0.6)
      S.lookYaw = 22 + 14 * Math.sin(t * 0.55); S.lookPitch = -12 + 5 * Math.sin(t * 0.8)
      S.flapAmp = 0.85 + 0.2 * Math.sin(t * 0.4)   // lively wings in the preview (the game idles at 0.4 and beats harder when moving)
    }
    if (!state || state.flapClock === undefined) s.flapClock = t
    // hit effects: one-shot clock = seconds since the (simulated) hit; the preview loops it every life + 0.9 s
    const hitAge = hitLife > 0 ? (s.hitAge !== undefined ? s.hitAge : (((t % (hitLife + 0.9)) + hitLife + 0.9) % (hitLife + 0.9))) : 0
    if (!state || state.walkClock === undefined) s.walkClock = t * 3
    if (capeN) {
      // virtual player for the cloth chain: the caller's { fwd, yawRate, sneak } or the demo loop
      let dt = sim.lastT == null ? 0 : t - sim.lastT; sim.lastT = t
      if (dt < 0 || dt > 0.5) { dt = 0; chain.reset() }
      const m = state && (state.fwd !== undefined || state.yawRate !== undefined) ? { speed: state.fwd ?? 0, yawRate: state.yawRate ?? 0, sneak: state.sneak ?? 0 } : demoMotion(t, sim.demo)
      sim.yaw += m.yawRate * dt
      const f = sim.yaw * DEG
      sim.x += -Math.sin(f) * m.speed * dt; sim.z += Math.cos(f) * m.speed * dt
      sim.speed += (m.speed - sim.speed) * Math.min(1, dt * 10)
      chain.step(dt, sim.x, 64, sim.z, sim.yaw, 0, 0, 0, t)   // the launcher skin never crouches
      const cp = capeParams
      const cf = cp ? cp.flutter : 1, bill = cp ? cp.billow : 0
      const flutter = Math.min(3.5, (0.5 + 0.25 * Math.min(sim.speed, 6) + 0.08 * Math.min(Math.abs(s.vy || 0), 6)) * cf + bill * 0.5)
      const cs = cp ? cp.waveSpeed : 1, cw = cp ? cp.wavelength : 1
      const cnn = Math.min(capeN, 12), cn = Math.max(1, cnn - 1)
      for (let i = 0; i < cnn; i++) {
        const k = i / cn
        // pitch ripple only pushes outwards (never into the body), roll ripple is tiny
        capeRx[i] = chain.rx[i] + flutter * (0.5 + 0.5 * Math.sin(t * 5.2 * cs - i * 0.95 * cw)) * (0.2 + 0.8 * k) * 0.8
        capeRz[i] = chain.rz[i] + flutter * Math.sin(t * 3.1 * cs - i * 0.8 * cw + 1.3) * (0.2 + 0.8 * k) * 0.35
      }
    }
    for (const { p, outer, fxn, mat, alpha0 } of nodes) {
      const a = p.anim
      let rx = 0, ry = 0, rz = 0, ox = 0, oy = 0, oz = 0, sc = 1, env = 1
      if (p.capeSegment) { rx = capeRx[p.capeSegment.index] * DEG; rz = capeRz[p.capeSegment.index] * DEG }
      else if (a) {
        rx = ang(a.rx, s, t, 0); ry = ang(a.ry, s, t, 1); rz = ang(a.rz, s, t, 2)
        if (a.spin) ry += (a.spin.degPerSec * t + a.spin.phaseDeg) * DEG
      }
      if (a) {
        if (a.orbit) { const w = a.orbit.speed * t + a.orbit.phase; ox += Math.cos(w) * a.orbit.radius; oz += Math.sin(w) * a.orbit.radius }
        if (a.rise) {
          let f = a.rise.cyclesPerSec * t + a.rise.phase01; f -= Math.floor(f)
          if (a.rise.duty > 0) f = f < a.rise.duty ? f / a.rise.duty : 2
          oy -= a.rise.height * Math.sin(Math.min(f, 1) * Math.PI / 2)   // R5-E: eased travel + smooth in / out envelope
          sc *= f >= 1 ? 0 : riseEnv(f)
        }
        if (a.slideX) ox += a.slideX.amp * Math.sin(a.slideX.speed * t + a.slideX.phase)
        if (a.bobY) oy += a.bobY.amp * Math.sin(a.bobY.speed * t + a.bobY.phase)
        if (a.slideZ) oz += a.slideZ.amp * Math.sin(a.slideZ.speed * t + a.slideZ.phase)
        if (a.pulse) sc *= 1 + a.pulse.amp * Math.sin(a.pulse.speed * t + a.pulse.phase)
        if (a.bursts) {
          for (const b of a.bursts) {
            const v = burst(b, s, t)
            if (v === 0) continue
            switch (b.axis) {
              case 'rx': rx += v * DEG; break
              case 'ry': ry += v * DEG; break
              case 'rz': rz += v * DEG; break
              case 'x': ox += v; break
              case 'y': oy += v; break
              case 'z': oz += v; break
              default: sc *= 1 + v
            }
          }
        }
        if (a.effect) {
          const e = a.effect, age = hitAge - e.start, u = age / e.dur
          if (u < 0 || u > 1) { outer.visible = false; continue }
          outer.visible = true
          const ep = ease(e.ease, u), es = ease(e.scaleEase, u)
          ox += e.move[0] * ep; oy += e.move[1] * ep + 0.5 * e.fall * age * age; oz += e.move[2] * ep
          sc *= e.scale[0] + (e.scale[1] - e.scale[0]) * es
          env = (e.fadeIn > 0 ? smooth01(u / e.fadeIn) : 1) * (e.fadeOut > 0 ? smooth01((1 - u) / e.fadeOut) : 1)
          if (e.spin) { const sp = e.spin * ep * DEG; if (e.spinAxis === 'x') rx += sp; else if (e.spinAxis === 'y') ry += sp; else rz += sp }
          if (mat) mat.opacity = alpha0 * env
        }
        if (a.look) {
          ry += clamp(s.lookYaw, -a.look.maxYaw, a.look.maxYaw) * a.look.gain * DEG
          rx += clamp(s.lookPitch, -a.look.maxPitch, a.look.maxPitch) * a.look.gain * DEG
        }
      }
      outer.position.set(p.pivot[0] + ox, p.pivot[1] + oy, p.pivot[2] + oz)
      outer.rotation.set(rx, ry, rz, 'ZYX')
      if (a && (a.rise || a.orbit) && particleScale !== 1) sc *= particleScale   // launcher-only: the stage is zoomed in ~4x vs the game camera, so particles read bigger
      outer.scale.setScalar(sc > 0.02 ? sc : 0.0001)
      if (fxn) {
        const { fx, col, sp, n, baseA, trans, attr } = fxn
        for (let i = 0; i < n; i++) {
          const c = fxColor(fx, baseA, sp[i], t, trans)
          col[i * 4] = c[0] * c[0]; col[i * 4 + 1] = c[1] * c[1]; col[i * 4 + 2] = c[2] * c[2]  // sRGB-ish -> linear
          col[i * 4 + 3] = clamp(c[3], 0, 1)
        }
        attr.needsUpdate = true
      }
    }
  }
  update(0)
  return {
    id: json.id, slot: json.slot, bone: json.bone, object: root, update, json,
    dispose() { root.traverse(o => o.geometry && o.geometry.dispose()); mats.forEach(m => m.dispose()); texture.dispose() },
  }
}

/** Recolours the user-tinted cape template (renklerin) in a canvas -> THREE.CanvasTexture. Same math as Cosmetic.texture(). */
export function tintTemplate(THREE, img, a, b) {
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height
  const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0)
  const d = cx.getImageData(0, 0, cv.width, cv.height), px = d.data
  const A = [a >> 16 & 255, a >> 8 & 255, a & 255], B = [b >> 16 & 255, b >> 8 & 255, b & 255]
  for (let i = 0; i < px.length; i += 4) {
    if (!px[i + 3]) continue
    const t = px[i] / 255, g = px[i + 1] / 255
    for (let k = 0; k < 3; k++) { let c = A[k] + (B[k] - A[k]) * t; c = c + (255 - c) * g; px[i + k] = Math.max(0, Math.min(255, Math.round(c))) }
  }
  cx.putImageData(d, 0, 0)
  return new THREE.CanvasTexture(cv)
}

export async function loadCosmetic(THREE, base, id, opts = {}) {
  const json = await (await fetch(`${base}${id}.json`)).json()
  const tex = await new THREE.TextureLoader().loadAsync(`${base}${json.texture}`)
  return buildCosmetic(THREE, json, tex, opts)
}
