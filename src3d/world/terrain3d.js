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
  grass:     [[103, 56, 40], [99, 58, 42], [107, 54, 38], [101, 60, 41], [105, 55, 43]],
  path:      [[36, 44, 58], [34, 42, 56], [38, 45, 60]],
  sand:      [[44, 60, 70], [42, 57, 68], [46, 62, 72]],
  rock:      [[26, 17, 43], [25, 15, 41], [27, 18, 45]],
  water:     [[204, 52, 26]],
  shallow:   [[188, 70, 60]],
  bridge:    [[28, 44, 44]],
  wood:      [[28, 44, 42]],
  tilefloor: [[206, 20, 68]],
  carpet:    [[348, 52, 44]],
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
    for (let z = 0; z <= this.h; z++) {
      for (let x = 0; x <= this.w; x++) {
        let sum = 0, n = 0;
        for (const [dx, dz] of [[-1,-1],[0,-1],[-1,0],[0,0]]) {
          const tx = x + dx, tz = z + dz;
          if (tx < 0 || tz < 0 || tx >= this.w || tz >= this.h) continue;
          sum += this.tileH[tz * this.w + tx]; n++;
        }
        this.vertH[z * (this.w + 1) + x] = n ? sum / n : 0;
      }
    }
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
    for (let z = 0; z < this.h; z++) {
      for (let x = 0; x < this.w; x++) {
        const info = this.map.info(x, z);
        if (info.void) continue;
        const mat = info.ground === 'void' ? 'grass' : info.ground;
        const c = groundColor(mat, x, z);
        const x0 = x * UNIT, x1 = x0 + UNIT, z0 = z * UNIT, z1 = z0 + UNIT;
        const a = [x0, H(x, z), z0], b = [x1, H(x + 1, z), z0];
        const cc = [x1, H(x + 1, z + 1), z1], d = [x0, H(x, z + 1), z1];
        // split along the shorter diagonal so slopes stay clean
        if (Math.abs(a[1] - cc[1]) <= Math.abs(b[1] - d[1])) {
          m.tri(a[0],a[1],a[2], d[0],d[1],d[2], cc[0],cc[1],cc[2], c);
          m.tri(a[0],a[1],a[2], cc[0],cc[1],cc[2], b[0],b[1],b[2], c);
        } else {
          m.tri(a[0],a[1],a[2], d[0],d[1],d[2], b[0],b[1],b[2], c);
          m.tri(b[0],b[1],b[2], d[0],d[1],d[2], cc[0],cc[1],cc[2], c);
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
  const scale = big ? 1.35 : 1;
  m.push(); m.scale(scale, scale, scale);
  m.push(); m.translate(0, 1.5, 0);
  m.taper(0.32, 0.24, 0, TRUNK, 6);
  m.pop();
  m.push(); m.translate(0, 0, 0);
  m.taper(0.36, 0.26, 1.7, TRUNK, 6);
  m.pop();
  // stacked canopy discs, darker at the bottom
  const hue = 104 + (rng() - 0.5) * 26;
  for (let i = 0; i < 3; i++) {
    const t = i / 2;
    m.push();
    m.translate(0, 1.5 + i * 0.95, 0);
    m.taper(2.1 - i * 0.55, 0.9 - i * 0.35, 1.35,
      hsl2rgb(hue, 58 + i * 6, 26 + i * 9), 7);
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

function emitBuilding(m, b) {
  const w = b.w * UNIT, d = b.h * UNIT, wallH = 5.2;
  const wall = hsl2rgb(b.wall > 60 ? 40 : b.wall, 16, 78);
  const roof = hsl2rgb(b.roof, 62, 44);
  const roofDark = hsl2rgb(b.roof, 58, 32);
  m.push(); m.translate(0, wallH / 2, 0);
  m.box(w, wallH, d, wall, wall);
  m.pop();
  // hipped roof: four triangles up to a ridge
  const ex = w / 2 + 0.7, ez = d / 2 + 0.7, ry = wallH + 3.2;
  const corners = [[-ex, wallH, -ez], [ex, wallH, -ez], [ex, wallH, ez], [-ex, wallH, ez]];
  for (let i = 0; i < 4; i++) {
    const a = corners[i], bb = corners[(i + 1) % 4];
    m.tri(a[0],a[1],a[2], bb[0],bb[1],bb[2], 0,ry,0, i % 2 ? roof : roofDark);
  }
  // door
  m.push(); m.translate(0, 1.5, d / 2 + 0.06);
  m.box(2.4, 3.0, 0.2, hsl2rgb(26, 52, 30));
  m.pop();
}

/** Every prop on the map baked into a single mesh — one draw call for the lot. */
export function buildProps(map, terrain) {
  const rng = makeRng(0xBEEF);
  const m = new MeshBuilder();
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
