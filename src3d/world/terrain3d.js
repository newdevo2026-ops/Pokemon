// Turns an existing ASCII map into low-poly 3D terrain.
//
// The 2D game's maps stay the single source of truth for the world layout —
// this module only decides how each tile looks and how high it sits, then
// welds the whole thing into one mesh.

import { MeshBuilder } from '../core/meshbuilder.js';
import { hsl2rgb } from '../gfx/creature3d.js';
import { tileInfo } from '../../src/world/tiles.js';
import { valueNoise2D, fbm, makeRng } from '../../src/core/util.js';

export const UNIT = 4;          // world units per map tile
const WATER_DROP = -2.4;
const CLIFF_RISE = 3.2;

// Vivid, saturated ground palette — the "more alive" look starts here.
// Variants are deliberately close together: enough to break up a big field,
// not enough to read as a chequerboard.
const GROUND = {
  grass:     [[105, 53, 37], [102, 55, 38], [108, 51, 36], [104, 56, 38], [106, 52, 37]],
  path:      [[35, 48, 60], [33, 46, 58], [37, 50, 62]],
  sand:      [[44, 60, 72], [42, 57, 70], [46, 62, 74]],
  rock:      [[26, 17, 43], [25, 15, 41], [27, 18, 45]],
  water:     [[204, 52, 26]],
  shallow:   [[188, 70, 60]],
  bridge:    [[28, 42, 42], [26, 40, 39]],
  wood:      [[28, 34, 40], [26, 32, 37], [30, 36, 43]],
  tilefloor: [[206, 16, 66], [206, 14, 62], [208, 18, 70]],
  carpet:    [[348, 46, 42], [346, 44, 39]],
  void:      [[230, 24, 12]],
};

function groundColor(mat, x, z) {
  const set = GROUND[mat] || GROUND.grass;
  // a hash, not a stride, so neighbours do not alternate in a visible pattern
  const h = ((x * 73856093) ^ (z * 19349663)) >>> 0;
  return hsl2rgb(...set[h % set.length]);
}

/** Per-tile base elevation, before smoothing. */
function baseHeight(map, x, z, noise) {
  const info = map.info(x, z);
  if (info.water) return WATER_DROP;
  if (info.deco === 'cliff') return CLIFF_RISE;
  // Towns and interiors stay flat; open ground rolls gently.
  if (['path', 'wood', 'tilefloor', 'carpet', 'bridge'].includes(info.ground)) return 0;
  return (fbm(noise, x / 9, z / 9, 3) - 0.5) * 1.7;
}

/** Surface under a tile; props and walls borrow the floor around them. */
function surfaceOf(map, x, z) {
  const info = map.info(x, z);
  if (info.inherit) {
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, 1], [0, -1]]) {
      const n = map.info(x + dx, z + dz);
      if (!n.inherit && !n.void && !n.water) return n.ground;
    }
  }
  return info.ground === 'void' ? 'grass' : info.ground;
}

export class Terrain3D {
  constructor(map) {
    this.map = map;
    this.w = map.w;
    this.h = map.h;
    const noise = valueNoise2D(0xA57E);

    // tile heights, then vertex heights as the average of adjacent tiles
    this.tileH = new Float32Array(this.w * this.h);
    for (let z = 0; z < this.h; z++) {
      for (let x = 0; x < this.w; x++) this.tileH[z * this.w + x] = baseHeight(map, x, z, noise);
    }
    this.vertH = new Float32Array((this.w + 1) * (this.h + 1));
    // Colour and shading live on the vertices too: averaging the surrounding
    // tiles is what turns a chequerboard of flat squares into ground that
    // reads as one continuous surface.
    this.vertC = new Float32Array((this.w + 1) * (this.h + 1) * 3);
    for (let z = 0; z <= this.h; z++) {
      for (let x = 0; x <= this.w; x++) {
        let sum = 0, n = 0, r = 0, g = 0, bl = 0, occ = 0;
        const tally = new Map();
        for (const [dx, dz] of [[-1,-1],[0,-1],[-1,0],[0,0]]) {
          const tx = x + dx, tz = z + dz;
          if (tx < 0 || tz < 0 || tx >= this.w || tz >= this.h) continue;
          sum += this.tileH[tz * this.w + tx]; n++;
          const mat = surfaceOf(map, tx, tz);
          const c = groundColor(mat, tx, tz);
          r += c[0]; g += c[1]; bl += c[2];
          const t = tally.get(mat) || { n: 0, c };
          t.n++; tally.set(mat, t);
          const info = map.info(tx, tz);
          if (info.solid && !info.water) occ++;
        }
        const i = z * (this.w + 1) + x;
        this.vertH[i] = n ? sum / n : 0;
        // Bias each vertex toward the material that dominates around it. A
        // straight average washes a two-tile path into a green smear; this
        // keeps the path reading as a path while its edges still feather.
        let modal = null, best = 0;
        for (const t of tally.values()) if (t.n > best) { best = t.n; modal = t.c; }
        const avg = [r / (n || 1), g / (n || 1), bl / (n || 1)];
        const mix = 0.38;
        const ao = 1 - Math.min(0.3, occ * 0.1);
        // a touch of per-vertex variation so big fields do not go flat
        const jit = 0.97 + (((x * 73856093) ^ (z * 19349663)) >>> 0) % 60 / 1000;
        for (let k = 0; k < 3; k++) {
          this.vertC[i * 3 + k] = ((modal ? modal[k] : avg[k]) * (1 - mix) + avg[k] * mix) * ao * jit;
        }
      }
    }
  }

  vertexColor(x, z) {
    x = Math.max(0, Math.min(this.w, x));
    z = Math.max(0, Math.min(this.h, z));
    const i = (z * (this.w + 1) + x) * 3;
    return [this.vertC[i], this.vertC[i + 1], this.vertC[i + 2]];
  }

  vertexHeight(x, z) {
    x = Math.max(0, Math.min(this.w, x));
    z = Math.max(0, Math.min(this.h, z));
    return this.vertH[z * (this.w + 1) + x];
  }

  /** Bilinear ground height at a world position — what the player stands on. */
  heightAt(wx, wz) {
    const fx = wx / UNIT, fz = wz / UNIT;
    const x0 = Math.floor(fx), z0 = Math.floor(fz);
    const tx = fx - x0, tz = fz - z0;
    const h00 = this.vertexHeight(x0, z0), h10 = this.vertexHeight(x0 + 1, z0);
    const h01 = this.vertexHeight(x0, z0 + 1), h11 = this.vertexHeight(x0 + 1, z0 + 1);
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  tileAtWorld(wx, wz) {
    return { x: Math.floor(wx / UNIT), z: Math.floor(wz / UNIT) };
  }

  build() {
    const m = new MeshBuilder();
    const H = (x, z) => this.vertexHeight(x, z);
    const C = (x, z) => this.vertexColor(x, z);
    for (let z = 0; z < this.h; z++) {
      for (let x = 0; x < this.w; x++) {
        if (this.map.info(x, z).void) continue;
        const x0 = x * UNIT, x1 = x0 + UNIT, z0 = z * UNIT, z1 = z0 + UNIT;
        const a = [x0, H(x, z), z0], b = [x1, H(x + 1, z), z0];
        const cc = [x1, H(x + 1, z + 1), z1], d = [x0, H(x, z + 1), z1];
        // Each tile keeps its own colour through the middle and only leans
        // toward the shared vertex blend at the corners: crisp paths, soft
        // edges. A pure vertex average smears narrow features away entirely.
        const own = groundColor(surfaceOf(this.map, x, z), x, z);
        const lean = (v) => [
          own[0] * 0.62 + v[0] * 0.38,
          own[1] * 0.62 + v[1] * 0.38,
          own[2] * 0.62 + v[2] * 0.38,
        ];
        const ca = lean(C(x, z)), cb = lean(C(x + 1, z));
        const ccc = lean(C(x + 1, z + 1)), cd = lean(C(x, z + 1));
        // split along the shorter diagonal so slopes stay clean
        if (Math.abs(a[1] - cc[1]) <= Math.abs(b[1] - d[1])) {
          m.triC(a, d, cc, ca, cd, ccc);
          m.triC(a, cc, b, ca, ccc, cb);
        } else {
          m.triC(a, d, b, ca, cd, cb);
          m.triC(b, d, cc, cb, cd, ccc);
        }
      }
    }
    return m.data();
  }

  /** Separate translucent pass so water reads as a surface over the bed. */
  buildWater() {
    const m = new MeshBuilder();
    const c = hsl2rgb(203, 68, 34);
    let any = false;
    for (let z = 0; z < this.h; z++) {
      for (let x = 0; x < this.w; x++) {
        if (!this.map.info(x, z).water) continue;
        any = true;
        const x0 = x * UNIT, x1 = x0 + UNIT, z0 = z * UNIT, z1 = z0 + UNIT;
        const y = -0.45;
        m.quad([x0,y,z0], [x0,y,z1], [x1,y,z1], [x1,y,z0], c);
      }
    }
    return any ? m.data() : null;
  }
}

// ------------------------------------------------------------------ props --
const TRUNK = hsl2rgb(26, 46, 30);

function emitTree(m, rng, big) {
  const scale = big ? 1.4 : 1;
  m.push(); m.scale(scale, scale, scale);
  m.push();
  m.taper(0.5, 0.34, 2.2, TRUNK, 6);
  m.pop();
  // stacked canopy tiers, darkest at the bottom
  const hue = 102 + (rng() - 0.5) * 24;
  for (let i = 0; i < 4; i++) {
    m.push();
    m.translate(0, 1.5 + i * 1.2, 0);
    m.taper(3.0 - i * 0.62, 1.5 - i * 0.36, 1.9,
      hsl2rgb(hue, 56 + i * 5, 24 + i * 7), 8);
    m.pop();
  }
  m.pop();
}

function emitRock(m, rng) {
  const c = hsl2rgb(28, 16, 46);
  for (let i = 0; i < 3; i++) {
    m.push();
    m.translate((rng() - 0.5) * 0.8, 0.35 + rng() * 0.4, (rng() - 0.5) * 0.8);
    m.rotateY(rng() * 3);
    m.box(0.9 + rng() * 0.7, 0.7 + rng() * 0.6, 0.9 + rng() * 0.7, c, hsl2rgb(30, 14, 58));
    m.pop();
  }
}

function emitTuft(m, rng) {
  for (let i = 0; i < 7; i++) {
    const a = rng() * 6.28, r = rng() * 1.5;
    const hgt = 0.9 + rng() * 0.7;
    m.push();
    m.translate(Math.cos(a) * r, 0, Math.sin(a) * r);
    m.rotateY(rng() * 3);
    m.blade([[0,0],[0.16,hgt * 0.6],[0.05,hgt],[-0.16,hgt * 0.55]],
      hsl2rgb(98 + rng() * 22, 66, 34 + rng() * 14), 0.06);
    m.pop();
  }
}

/** Interior wall segment. Kept low so an overhead camera can see into the
 *  room, and only emitted where it actually borders walkable floor — a solid
 *  block of wall tiles would otherwise fill the screen with grey. */
function emitWall(m) {
  const h = 3.0;
  m.push(); m.translate(0, h / 2, 0);
  m.box(UNIT, h, UNIT, hsl2rgb(214, 14, 44), hsl2rgb(214, 12, 62));
  m.pop();
}

function emitBuilding(m, b) {
  const w = b.w * UNIT, d = b.h * UNIT;
  const wallH = 5.6, ox = 0.9;
  const W = w / 2 + ox, D = d / 2 + ox;
  const ridgeY = wallH + 3.0;

  const hue = b.wall > 60 ? 42 : b.wall;
  const plaster = hsl2rgb(hue, 16, 84);
  const plasterTop = hsl2rgb(hue, 14, 90);
  const timber = hsl2rgb(26, 42, 30);
  const timberLight = hsl2rgb(28, 40, 40);
  const roof = hsl2rgb(b.roof, 58, 44);
  const roofDark = hsl2rgb(b.roof, 54, 32);
  const glass = hsl2rgb(200, 70, 62);

  // --- plinth, walls, corner posts
  m.push(); m.translate(0, 0.3, 0);
  m.box(w + 0.5, 0.6, d + 0.5, hsl2rgb(28, 12, 46), hsl2rgb(28, 12, 56));
  m.pop();
  m.push(); m.translate(0, wallH / 2 + 0.5, 0);
  m.box(w, wallH, d, plaster, plasterTop);
  m.pop();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    m.push(); m.translate(sx * (w / 2 - 0.2), wallH / 2 + 0.5, sz * (d / 2 - 0.2));
    m.box(0.55, wallH, 0.55, timber, timberLight);
    m.pop();
  }
  // beam under the eaves ties the walls to the roof
  m.push(); m.translate(0, wallH + 0.55, 0);
  m.box(w + 0.35, 0.45, d + 0.35, timber, timberLight);
  m.pop();

  // --- gabled roof with an overhang
  const eaveY = wallH + 0.8;
  m.quad([-W, eaveY, D], [W, eaveY, D], [W, ridgeY, 0], [-W, ridgeY, 0], roof);
  m.quad([W, eaveY, -D], [-W, eaveY, -D], [-W, ridgeY, 0], [W, ridgeY, 0], roofDark);
  for (const sx of [1, -1]) {
    const a = [sx * W, eaveY, sx * D], bb = [sx * W, eaveY, -sx * D], c = [sx * W, ridgeY, 0];
    m.tri(a[0], a[1], a[2], bb[0], bb[1], bb[2], c[0], c[1], c[2], plasterTop);
  }
  m.push(); m.translate(0, ridgeY + 0.12, 0);
  m.box(w + ox * 2 + 0.3, 0.35, 0.6, roofDark, hsl2rgb(b.roof, 50, 52));
  m.pop();

  // --- front face: door and windows
  const doorLocal = b.door != null
    ? (b.door + 0.5) * UNIT - (b.x + b.w / 2) * UNIT : null;
  const zf = d / 2;
  if (doorLocal != null) {
    m.push(); m.translate(doorLocal, 2.3, zf + 0.08);
    m.box(3.4, 4.4, 0.3, timber, timberLight);         // frame
    m.pop();
    m.push(); m.translate(doorLocal, 2.1, zf + 0.26);
    m.box(2.6, 3.8, 0.24, hsl2rgb(22, 52, 34), hsl2rgb(22, 50, 42));
    m.pop();
    m.push(); m.translate(doorLocal + 0.85, 2.1, zf + 0.42);   // handle
    m.sphere(0.18, hsl2rgb(46, 78, 62), 6, 4);
    m.pop();
    m.push(); m.translate(doorLocal, 0.25, zf + 1.1);          // step
    m.box(4.0, 0.5, 1.8, hsl2rgb(30, 10, 62), hsl2rgb(30, 10, 72));
    m.pop();
    m.push(); m.translate(doorLocal, 4.9, zf + 0.85);          // little awning
    m.rotateX(-0.32);
    m.box(4.4, 0.28, 1.9, roofDark, roof);
    m.pop();
    if (b.label) {                                             // hanging sign
      m.push(); m.translate(doorLocal, 6.0, zf + 0.5);
      m.box(5.0, 1.5, 0.35, timber, timberLight);
      m.translate(0, 0, 0.22);
      m.box(4.4, 1.0, 0.12, hsl2rgb(b.roof, 46, 60), hsl2rgb(b.roof, 44, 68));
      m.pop();
    }
  }

  const window = (x, y, z, rotY) => {
    m.push(); m.translate(x, y, z); m.rotateY(rotY);
    m.box(2.4, 2.4, 0.28, timber, timberLight);
    m.translate(0, 0, 0.18);
    m.box(1.8, 1.8, 0.12, glass, hsl2rgb(198, 60, 78));
    m.box(0.16, 1.9, 0.2, timber);                     // mullions
    m.box(1.9, 0.16, 0.2, timber);
    m.translate(0, -1.35, 0.05);
    m.box(2.7, 0.25, 0.5, plasterTop);                 // sill
    m.pop();
  };
  const span = w - 3;
  const count = Math.max(1, Math.round(span / 5));
  for (let i = 0; i <= count; i++) {
    const x = -span / 2 + (span / count) * i;
    if (doorLocal != null && Math.abs(x - doorLocal) < 3.2) continue;
    window(x, 3.4, zf + 0.1, 0);
  }
  for (const sx of [-1, 1]) {
    const zs = d > UNIT * 2 ? [-d / 4, d / 4] : [0];
    for (const z of zs) window(sx * (w / 2 + 0.1), 3.4, z, sx * Math.PI / 2);
  }
}

/** Every prop on the map baked into a single mesh — one draw call for the lot. */
export function buildProps(map, terrain) {
  const rng = makeRng(0xBEEF);
  const m = new MeshBuilder();
  const covered = new Set();
  for (const b of map.buildings || []) {
    for (let z = b.y - 1; z < b.y + b.h + 1; z++) {
      for (let x = b.x - 1; x < b.x + b.w + 1; x++) covered.add(x + ',' + z);
    }
  }
  for (let z = 0; z < map.h; z++) {
    for (let x = 0; x < map.w; x++) {
      const info = map.info(x, z);
      if (!info.deco && !info.tall) continue;
      const wx = x * UNIT + UNIT / 2, wz = z * UNIT + UNIT / 2;
      const y = terrain.heightAt(wx, wz);
      const jitter = ((x * 31 + z * 17) % 9) / 9;
      m.push();
      m.translate(wx, y, wz);
      m.rotateY(jitter * 6.28);
      switch (info.deco) {
        case 'tree': m.scale(0.9 + jitter * 0.4, 0.9 + jitter * 0.4, 0.9 + jitter * 0.4); emitTree(m, rng, false); break;
        case 'bigtree': emitTree(m, rng, true); break;
        case 'boulder': emitRock(m, rng); break;
        case 'cliff': break;   // cliffs are already terrain elevation
        case 'wall': {
          if (covered.has(x + ',' + z)) break;   // the building mesh owns this tile
          const open = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dz]) => {
            const n = map.info(x + dx, z + dz);
            return !n.solid && !n.void;
          });
          if (open) emitWall(m);
          break;
        }
        case 'fence': m.push(); m.translate(0, 0.9, 0); m.box(UNIT, 1.8, 0.5, hsl2rgb(28, 42, 40)); m.pop(); break;
        case 'sign': {
          m.push(); m.translate(0, 1.1, 0); m.taper(0.16, 0.14, 1.2, hsl2rgb(26, 44, 30), 5);
          m.translate(0, 1.2, 0.05); m.box(2.1, 1.3, 0.24, hsl2rgb(32, 46, 48), hsl2rgb(32, 44, 58));
          m.pop(); break;
        }
        case 'counter': m.push(); m.translate(0, 1.1, 0); m.box(UNIT, 2.2, UNIT * 0.8, hsl2rgb(202, 22, 62), hsl2rgb(202, 20, 78)); m.pop(); break;
        case 'shelf': m.push(); m.translate(0, 1.9, 0); m.box(UNIT, 3.8, UNIT * 0.7, hsl2rgb(26, 40, 34), hsl2rgb(26, 38, 44)); m.pop(); break;
        case 'machine': m.push(); m.translate(0, 1.5, 0); m.box(UNIT * 0.8, 3.0, UNIT * 0.7, hsl2rgb(200, 18, 78), hsl2rgb(160, 60, 52)); m.pop(); break;
        case 'pc': m.push(); m.translate(0, 1.0, 0); m.box(UNIT * 0.9, 2.0, UNIT * 0.7, hsl2rgb(210, 16, 40), hsl2rgb(190, 70, 55)); m.pop(); break;
        case 'crate': m.push(); m.translate(0, 1.0, 0); m.box(UNIT * 0.8, 2.0, UNIT * 0.8, hsl2rgb(30, 44, 42), hsl2rgb(30, 42, 52)); m.pop(); break;
        default:
          if (info.tall) emitTuft(m, rng);
      }
      m.pop();
    }
  }
  for (const b of map.buildings || []) {
    const wx = (b.x + b.w / 2) * UNIT, wz = (b.y + b.h / 2) * UNIT;
    m.push();
    m.translate(wx, terrain.heightAt(wx, wz), wz);
    emitBuilding(m, b);
    m.pop();
  }
  return m.data();
}
