// Accumulates flat-shaded, vertex-coloured geometry.
//
// Everything in the game is built from a handful of chunky primitives pushed
// through a transform stack — the same approach that gives early-2000s 3D RPGs
// their readable, faceted look.  No textures, no smooth normals: each triangle
// carries one normal and one colour, so silhouettes stay crisp.

import { Stack } from './mat4.js';

const P = [0, 0, 0], Q = [0, 0, 0], R = [0, 0, 0];

export class MeshBuilder {
  constructor() {
    this.pos = [];
    this.norm = [];
    this.col = [];
    this.stack = new Stack();
    this.tint = [1, 1, 1];
  }

  get vertexCount() { return this.pos.length / 3; }

  // ---- transform stack passthrough ----
  push() { this.stack.push(); return this; }
  pop() { this.stack.pop(); return this; }
  translate(x, y, z) { this.stack.translate(x, y, z); return this; }
  scale(x, y, z) { this.stack.scale(x, y, z); return this; }
  rotateX(a) { this.stack.rotateX(a); return this; }
  rotateY(a) { this.stack.rotateY(a); return this; }
  rotateZ(a) { this.stack.rotateZ(a); return this; }

  /** One flat-shaded triangle in local space; the normal is derived per face. */
  tri(ax, ay, az, bx, by, bz, cx, cy, cz, color) {
    const s = this.stack;
    s.apply(P, ax, ay, az);
    s.apply(Q, bx, by, bz);
    s.apply(R, cx, cy, cz);
    const ux = Q[0]-P[0], uy = Q[1]-P[1], uz = Q[2]-P[2];
    const vx = R[0]-P[0], vy = R[1]-P[1], vz = R[2]-P[2];
    let nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const [tr, tg, tb] = this.tint;
    const r = color[0]*tr, g = color[1]*tg, b = color[2]*tb;
    this.pos.push(P[0],P[1],P[2], Q[0],Q[1],Q[2], R[0],R[1],R[2]);
    this.norm.push(nx,ny,nz, nx,ny,nz, nx,ny,nz);
    this.col.push(r,g,b, r,g,b, r,g,b);
    return this;
  }

  /** Triangle with an independent colour per corner — used by the terrain so
   *  materials fade into each other instead of meeting at a hard tile edge. */
  triC(a, b, c, ca, cb, cc) {
    const s = this.stack;
    s.apply(P, a[0], a[1], a[2]);
    s.apply(Q, b[0], b[1], b[2]);
    s.apply(R, c[0], c[1], c[2]);
    const ux = Q[0]-P[0], uy = Q[1]-P[1], uz = Q[2]-P[2];
    const vx = R[0]-P[0], vy = R[1]-P[1], vz = R[2]-P[2];
    let nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    this.pos.push(P[0],P[1],P[2], Q[0],Q[1],Q[2], R[0],R[1],R[2]);
    this.norm.push(nx,ny,nz, nx,ny,nz, nx,ny,nz);
    this.col.push(ca[0],ca[1],ca[2], cb[0],cb[1],cb[2], cc[0],cc[1],cc[2]);
    return this;
  }

  quad(a, b, c, d, color) {
    this.tri(a[0],a[1],a[2], b[0],b[1],b[2], c[0],c[1],c[2], color);
    this.tri(a[0],a[1],a[2], c[0],c[1],c[2], d[0],d[1],d[2], color);
    return this;
  }

  /** Axis-aligned box centred on the origin of the current transform. */
  box(w, h, d, color, topColor) {
    const x = w/2, y = h/2, z = d/2;
    const top = topColor || color;
    // +y / -y
    this.quad([-x,y,-z],[-x,y,z],[x,y,z],[x,y,-z], top);
    this.quad([-x,-y,z],[-x,-y,-z],[x,-y,-z],[x,-y,z], color);
    // +z / -z
    this.quad([-x,-y,z],[x,-y,z],[x,y,z],[-x,y,z], color);
    this.quad([x,-y,-z],[-x,-y,-z],[-x,y,-z],[x,y,-z], color);
    // +x / -x
    this.quad([x,-y,z],[x,-y,-z],[x,y,-z],[x,y,z], color);
    this.quad([-x,-y,-z],[-x,-y,z],[-x,y,z],[-x,y,-z], color);
    return this;
  }

  /** Low-poly UV sphere; `seg`/`rings` stay small on purpose. */
  sphere(r, color, seg = 8, rings = 6, squashY = 1) {
    for (let i = 0; i < rings; i++) {
      const p0 = Math.PI * i / rings, p1 = Math.PI * (i + 1) / rings;
      const y0 = Math.cos(p0) * r * squashY, y1 = Math.cos(p1) * r * squashY;
      const r0 = Math.sin(p0) * r, r1 = Math.sin(p1) * r;
      for (let j = 0; j < seg; j++) {
        const t0 = 2 * Math.PI * j / seg, t1 = 2 * Math.PI * (j + 1) / seg;
        const a = [Math.cos(t0)*r0, y0, Math.sin(t0)*r0];
        const b = [Math.cos(t1)*r0, y0, Math.sin(t1)*r0];
        const c = [Math.cos(t1)*r1, y1, Math.sin(t1)*r1];
        const d = [Math.cos(t0)*r1, y1, Math.sin(t0)*r1];
        if (i === 0) this.tri(a[0],a[1],a[2], c[0],c[1],c[2], d[0],d[1],d[2], color);
        else if (i === rings - 1) this.tri(a[0],a[1],a[2], b[0],b[1],b[2], c[0],c[1],c[2], color);
        else this.quad(a, b, c, d, color);
      }
    }
    return this;
  }

  /** Tapered cylinder along +y, base at y=0. Radius 0 at one end gives a cone. */
  taper(r0, r1, h, color, seg = 8, cap = true) {
    for (let j = 0; j < seg; j++) {
      const t0 = 2 * Math.PI * j / seg, t1 = 2 * Math.PI * (j + 1) / seg;
      const a = [Math.cos(t0)*r0, 0, Math.sin(t0)*r0];
      const b = [Math.cos(t1)*r0, 0, Math.sin(t1)*r0];
      const c = [Math.cos(t1)*r1, h, Math.sin(t1)*r1];
      const d = [Math.cos(t0)*r1, h, Math.sin(t0)*r1];
      if (r1 < 1e-4) this.tri(a[0],a[1],a[2], b[0],b[1],b[2], c[0],c[1],c[2], color);
      else if (r0 < 1e-4) this.tri(a[0],a[1],a[2], c[0],c[1],c[2], d[0],d[1],d[2], color);
      else this.quad(a, b, c, d, color);
      if (cap) {
        if (r0 > 1e-4) this.tri(0,0,0, a[0],a[1],a[2], b[0],b[1],b[2], color);
        if (r1 > 1e-4) this.tri(0,h,0, c[0],c[1],c[2], d[0],d[1],d[2], color);
      }
    }
    return this;
  }

  /** Limb between two points in the current space. */
  limb(x0, y0, z0, x1, y1, z1, r0, r1, color, seg = 6) {
    const dx = x1-x0, dy = y1-y0, dz = z1-z0;
    const len = Math.hypot(dx, dy, dz) || 1e-4;
    const yaw = Math.atan2(dx, dz);
    const pitch = Math.acos(Math.max(-1, Math.min(1, dy / len)));
    this.push();
    this.translate(x0, y0, z0).rotateY(yaw).rotateX(pitch);
    this.taper(r0, r1, len, color, seg);
    this.pop();
    return this;
  }

  /** Flat double-sided blade — wings, fins, leaves. */
  blade(pts, color, thickness = 0.02) {
    for (const s of [thickness / 2, -thickness / 2]) {
      for (let i = 1; i < pts.length - 1; i++) {
        const a = pts[0], b = pts[i], c = pts[i + 1];
        if (s > 0) this.tri(a[0],a[1],s, b[0],b[1],s, c[0],c[1],s, color);
        else this.tri(a[0],a[1],s, c[0],c[1],s, b[0],b[1],s, color);
      }
    }
    return this;
  }

  merge(other) {
    this.pos.push(...other.pos);
    this.norm.push(...other.norm);
    this.col.push(...other.col);
    return this;
  }

  data() {
    return {
      pos: new Float32Array(this.pos),
      norm: new Float32Array(this.norm),
      col: new Float32Array(this.col),
      count: this.pos.length / 3,
    };
  }
}
