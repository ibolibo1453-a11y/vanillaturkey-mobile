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

// ---------------------------------------------------------------- R5-E cape cloth (verlet chain, world space) - 1:1 port of render/CapeChain.java
const CK = 0.9375 / 16, CSEG = 3 * CK, CPLANE = 2.15, CG = 24, CKN = 3.6, CKT = 0.55, CMAX_DT = 1 / 125
const CN = 6
const wrapDeg = (a) => { a %= 360; if (a >= 180) a -= 360; if (a < -180) a += 360; return a }
export class CapeChain {
  constructor() {
    this.x = new Float64Array(CN + 1); this.y = new Float64Array(CN + 1); this.z = new Float64Array(CN + 1)
    this.ox = new Float64Array(CN + 1); this.oy = new Float64Array(CN + 1); this.oz = new Float64Array(CN + 1)
    this.rx = new Float64Array(CN); this.rz = new Float64Array(CN)   // degrees, relative segment rotations about X / Z
    this.init = false; this.windScale = 1
    this.p = { x: 0, y: 0, z: 0, yaw: 0, lean: 0, sneak: 0, ely: 0 }
    this.b = {}   // basis scratch (fixed shape after the first call)
  }
  reset() { this.init = false }
  step(dt, px, py, pz, yaw, lean, sneak, ely, t) {
    const P = this.p, x = this.x, y = this.y, z = this.z, ox = this.ox, oy = this.oy, oz = this.oz
    if (!this.init || Math.abs(px - P.x) + Math.abs(pz - P.z) + Math.abs(py - P.y) > 8 || dt > 0.5) {
      P.x = px; P.y = py; P.z = pz; P.yaw = yaw; P.lean = lean; P.sneak = sneak; P.ely = ely
      this.basis(px, py, pz, yaw, lean, sneak, ely)
      const B = this.b
      for (let i = 0; i <= CN; i++) {
        const cy = 3 * i, cz = i === 0 ? 2 : CPLANE
        x[i] = ox[i] = B.orx + (B.e1x * cy + B.e2x * cz) * CK
        y[i] = oy[i] = B.ory + (B.e1y * cy + B.e2y * cz) * CK
        z[i] = oz[i] = B.orz + (B.e1z * cy + B.e2z * cz) * CK
      }
      this.init = true
      this.outAngles()
      return
    }
    if (dt <= 1e-6) return
    if (dt > 0.1) dt = 0.1
    let n = Math.ceil(dt / CMAX_DT); if (n < 1) n = 1
    const h = dt / n, dyaw = wrapDeg(yaw - P.yaw)
    for (let s = 1; s <= n; s++) {
      const a = s / n
      const cel = P.ely + (ely - P.ely) * a
      this.basis(P.x + (px - P.x) * a, P.y + (py - P.y) * a, P.z + (pz - P.z) * a, P.yaw + dyaw * a, P.lean + (lean - P.lean) * a, P.sneak + (sneak - P.sneak) * a, cel)
      this.substep(h, t - dt + dt * a, cel)
    }
    P.x = px; P.y = py; P.z = pz; P.yaw = yaw; P.lean = lean; P.sneak = sneak; P.ely = ely
    this.outAngles()
  }
  basis(X, Y, Z, yawDeg, leanDeg, sneak, ely) {
    const B = this.b
    const psi = yawDeg * DEG, phi = leanDeg * DEG
    const sp = Math.sin(psi), cp = Math.cos(psi), sf = Math.sin(phi), cf = Math.cos(phi)
    B.lx = cp; B.lz = sp
    B.ux = -sf * sp; B.uy = cf; B.uz = sf * cp
    B.fx = -cf * sp; B.fy = -sf; B.fz = cf * cp
    B.bx = X; B.by = Y; B.bz = Z
    const th = 0.5 * sneak, st = Math.sin(th), ct = Math.cos(th)
    B.e0x = B.lx; B.e0y = 0; B.e0z = B.lz
    const ymx = -B.ux, ymy = -B.uy, ymz = -B.uz, zmx = -B.fx, zmy = -B.fy, zmz = -B.fz
    B.e1x = ct * ymx + st * zmx; B.e1y = ct * ymy + st * zmy; B.e1z = ct * ymz + st * zmz
    B.e2x = -st * ymx + ct * zmx; B.e2y = -st * ymy + ct * zmy; B.e2z = -st * ymz + ct * zmz
    const ty = 3.2 * sneak
    B.orx = X + CK * (24 * B.ux + ty * ymx); B.ory = Y + CK * (24 * B.uy + ty * ymy); B.orz = Z + CK * (24 * B.uz + ty * ymz)
    B.orx += B.e2x * CK * ely; B.ory += B.e2y * CK * ely; B.orz += B.e2z * CK * ely
  }
  substep(h, t, ely) {
    const B = this.b, x = this.x, y = this.y, z = this.z, ox = this.ox, oy = this.oy, oz = this.oz, W = this.windScale
    x[0] = B.orx + B.e2x * 2 * CK; y[0] = B.ory + B.e2y * 2 * CK; z[0] = B.orz + B.e2z * 2 * CK
    for (let i = 1; i <= CN; i++) {
      const sc = 0.25 + 1.75 * (i - 1) / (CN - 1)
      const fn = 1 - Math.exp(-CKN * sc * h), ft = 1 - Math.exp(-CKT * sc * h)
      const vx = x[i] - ox[i], vy = y[i] - oy[i], vz = z[i] - oz[i]
      ox[i] = x[i]; oy[i] = y[i]; oz[i] = z[i]
      const wph = t * 1.1 + i * 0.75
      const wx = W * (0.45 * Math.sin(0.37 * t + 0.4) + 0.55 * Math.sin(1.31 * t + i * 0.8) + 0.2 * Math.sin(3.7 * wph))
      const wz = W * (0.40 * Math.sin(0.29 * t + 1.7) + 0.50 * Math.sin(1.7 * t - i * 0.6) + 0.2 * Math.sin(4.3 * wph + 1.0))
      const wy = W * 0.15 * Math.sin(2.1 * t + i * 1.1)
      const nx = B.e2x, ny = B.e2y, nz = B.e2z
      const rvx = vx / h - wx, rvy = vy / h - wy, rvz = vz / h - wz
      const dn = rvx * nx + rvy * ny + rvz * nz
      const tx = rvx - dn * nx, ty = rvy - dn * ny, tz = rvz - dn * nz
      const ax = -(dn * nx * fn + tx * ft), ay = -(dn * ny * fn + ty * ft), az = -(dn * nz * fn + tz * ft)
      const damp = 0.9985
      x[i] += vx * damp + ax * h; y[i] += vy * damp + ay * h - CG * h * h; z[i] += vz * damp + az * h
    }
    for (let i = 1; i <= 2; i++) {   // shoulders hold the top of the cape against the back (the hem is free)
      const kk = 1 - Math.exp(-(i === 1 ? 16 : 5) * h)
      const tx = B.orx + (B.e1x * 3 * i + B.e2x * CPLANE) * CK, ty = B.ory + (B.e1y * 3 * i + B.e2y * CPLANE) * CK, tz = B.orz + (B.e1z * 3 * i + B.e2z * CPLANE) * CK
      x[i] += (tx - x[i]) * kk; y[i] += (ty - y[i]) * kk; z[i] += (tz - z[i]) * kk
    }
    for (let it = 0; it < 4; it++) {
      for (let i = 0; i < CN; i++) {
        const dx = x[i + 1] - x[i], dy = y[i + 1] - y[i], dz = z[i + 1] - z[i]
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (d < 1e-9) continue
        const k = (d - CSEG) / d
        if (i === 0) { x[1] -= dx * k; y[1] -= dy * k; z[1] -= dz * k }
        else {
          const hx = dx * k * 0.5, hy = dy * k * 0.5, hz = dz * k * 0.5
          x[i] += hx; y[i] += hy; z[i] += hz; x[i + 1] -= hx; y[i + 1] -= hy; z[i + 1] -= hz
        }
      }
      for (let i = 0; i + 2 <= CN; i++) {
        const dx = x[i + 2] - x[i], dy = y[i + 2] - y[i], dz = z[i + 2] - z[i]
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz), min = 2 * CSEG * 0.47
        if (d < min && d > 1e-9) {
          const k = (min - d) / d * (i === 0 ? 1 : 0.5)
          if (i === 0) { x[2] += dx * k; y[2] += dy * k; z[2] += dz * k }
          else {
            x[i] -= dx * k * 0.5; y[i] -= dy * k * 0.5; z[i] -= dz * k * 0.5
            x[i + 2] += dx * k * 0.5; y[i + 2] += dy * k * 0.5; z[i + 2] += dz * k * 0.5
          }
        }
      }
      for (let i = 1; i <= CN; i++) this.collide(i, ely)
    }
  }
  collide(i, ely) {
    const B = this.b, x = this.x, y = this.y, z = this.z
    const dx = x[i] - B.orx, dy = y[i] - B.ory, dz = z[i] - B.orz
    const cx = (dx * B.e0x + dy * B.e0y + dz * B.e0z) / CK, cy = (dx * B.e1x + dy * B.e1y + dz * B.e1z) / CK, cz = (dx * B.e2x + dy * B.e2y + dz * B.e2z) / CK
    if (cy > -1 && cy < 13 && cx > -5.6 && cx < 5.6 && cz < CPLANE) {
      const m = (CPLANE - cz) * CK
      x[i] += B.e2x * m; y[i] += B.e2y * m; z[i] += B.e2z * m
    }
    const qx = x[i] - B.bx, qy = y[i] - B.by, qz = z[i] - B.bz
    const ql = (qx * B.lx + qz * B.lz) / CK, qu = (qx * B.ux + qy * B.uy + qz * B.uz) / CK, qf = (qx * B.fx + qy * B.fy + qz * B.fz) / CK
    const lim = -(CPLANE + ely)
    if (qu > -1 && qu < 12.5 && ql > -5.6 && ql < 5.6 && qf > lim) {
      const m = (qf - lim) * CK
      x[i] -= B.fx * m; y[i] -= B.fy * m; z[i] -= B.fz * m
    }
    if (y[i] < B.by + 0.02) y[i] = B.by + 0.02
  }
  outAngles() {
    const B = this.b, x = this.x, y = this.y, z = this.z
    let a00 = 1, a01 = 0, a02 = 0, a10 = 0, a11 = 1, a12 = 0, a20 = 0, a21 = 0, a22 = 1
    for (let i = 0; i < CN; i++) {
      let dx = x[i + 1] - x[i], dy = y[i + 1] - y[i], dz = z[i + 1] - z[i]
      let d = Math.sqrt(dx * dx + dy * dy + dz * dz); if (d < 1e-9) d = 1
      dx /= d; dy /= d; dz /= d
      const r0 = dx * B.e0x + dy * B.e0y + dz * B.e0z, r1 = dx * B.e1x + dy * B.e1y + dz * B.e1z, r2 = dx * B.e2x + dy * B.e2y + dz * B.e2z
      const l0 = a00 * r0 + a10 * r1 + a20 * r2, l1 = a01 * r0 + a11 * r1 + a21 * r2, l2 = a02 * r0 + a12 * r1 + a22 * r2
      const a = Math.asin(Math.max(-1, Math.min(1, l2))), b = Math.atan2(-l0, l1)
      this.rx[i] = a / DEG; this.rz[i] = b / DEG
      const sa = Math.sin(a), ca = Math.cos(a), sb = Math.sin(b), cb = Math.cos(b)
      const m00 = cb, m10 = sb, m20 = 0, m01 = -ca * sb, m11 = ca * cb, m21 = sa, m02 = sa * sb, m12 = -sa * cb, m22 = ca
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
      chain.step(dt, sim.x, 64, sim.z, sim.yaw, 0, m.sneak, 0, t)
      const cp = capeParams
      const flutter = (0.9 + 1.0 * Math.min(sim.speed, 6) + 0.4 * Math.min(Math.abs(s.vy || 0), 6)) * (cp ? cp.flutter : 1) + (cp ? cp.billow : 0)
      const cs = cp ? cp.waveSpeed : 1, cw = cp ? cp.wavelength : 1
      const cnn = Math.min(capeN, 12), cn = Math.max(1, cnn - 1)
      for (let i = 0; i < cnn; i++) {
        const k = i / cn
        capeRx[i] = chain.rx[i] + flutter * Math.sin(t * 5.2 * cs - i * 0.95 * cw) * (0.2 + 0.8 * k) * 0.9
        capeRz[i] = chain.rz[i] + flutter * Math.sin(t * 3.1 * cs - i * 0.8 * cw + 1.3) * (0.2 + 0.8 * k) * 0.5
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
