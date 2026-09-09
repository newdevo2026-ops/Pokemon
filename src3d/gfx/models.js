// Model registry: loads a .glb per species and falls back to the procedural
// mesh when there isn't one.
//
// A creature is converted one at a time — drop `assets/models/<id>.glb` in and
// list it in the manifest, and that creature switches over while every other
// one keeps its generated mesh. Nothing breaks half-way through the migration.
//
// Imported models arrive at arbitrary scale, orientation and origin, so each
// one is normalised on load: centred on X/Z, resting on Y=0, and scaled so its
// height matches what the roster says that creature's height should be.

import { parseGLB } from '../core/gltf.js';
import { buildCreatureMesh } from './creature3d.js';
import { getSpecies } from '../../src/data/species.js';

export const MODEL_DIR = 'assets/models/';

/** Per-model corrections, for when auto-fit can't know the intent.
 *  rotY: radians to turn the model so it faces +Z (the direction the engine
 *  treats as "forward"). height: override the auto-fitted height in world units. */
export const MODEL_TWEAKS = {
  // bytec: { rotY: Math.PI, height: 2.4 },
};

const BASE_HEIGHT = 2.9;        // world units for a size-1.0 creature

function fitPrimitives(parsed, targetHeight, rotY) {
  const { min, max } = parsed.bounds;
  const height = Math.max(1e-4, max[1] - min[1]);
  const scale = targetHeight / height;
  const cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2;
  const cos = Math.cos(rotY), sin = Math.sin(rotY);

  for (const prim of parsed.primitives) {
    const p = prim.pos, n = prim.norm;
    for (let i = 0; i < p.length; i += 3) {
      const x = (p[i] - cx) * scale;
      const y = (p[i + 1] - min[1]) * scale;
      const z = (p[i + 2] - cz) * scale;
      p[i] = x * cos + z * sin;
      p[i + 1] = y;
      p[i + 2] = -x * sin + z * cos;
      const nx = n[i], nz = n[i + 2];
      n[i] = nx * cos + nz * sin;
      n[i + 2] = -nx * sin + nz * cos;
    }
  }
  return { scale, height: targetHeight };
}

export class ModelRegistry {
  constructor(renderer, baseUrl = '') {
    this.renderer = renderer;
    this.baseUrl = baseUrl;
    this.models = new Map();      // id -> { parts:[{mesh,texture,alpha}] }
    this.procedural = new Map();  // id -> Mesh
    this.pending = new Set();
    this.available = null;        // ids listed in the manifest
    this.onLoad = null;
  }

  /** Reads the manifest once. Without one we stay fully procedural, which is
   *  what the offline single-file build needs. */
  async init() {
    if (this.available) return this.available;
    // file:// cannot fetch anything, so don't even try — it would only log a
    // scary console error on the double-click build.
    if (location.protocol === 'file:') { this.available = new Set(); return this.available; }
    try {
      const res = await fetch(this.baseUrl + MODEL_DIR + 'manifest.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      this.available = new Set(data.models || []);
    } catch {
      this.available = new Set();
    }
    return this.available;
  }

  has(id) { return this.models.has(id); }

  /** The procedural mesh, built on first use. */
  fallback(id) {
    if (!this.procedural.has(id)) {
      this.procedural.set(id, this.renderer.mesh(buildCreatureMesh(id)));
    }
    return this.procedural.get(id);
  }

  /** Kicks off a load if the manifest lists this creature. Safe to call often. */
  request(id) {
    if (!this.available?.has(id) || this.models.has(id) || this.pending.has(id)) return;
    this.pending.add(id);
    this.load(id).catch((e) => console.warn(`model ${id}:`, e.message));
  }

  async load(id) {
    const url = `${this.baseUrl}${MODEL_DIR}${id}.glb`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch failed (${res.status})`);
    const parsed = await parseGLB(await res.arrayBuffer());

    const tweak = MODEL_TWEAKS[id] || {};
    const sp = getSpecies(id);
    const target = tweak.height ?? BASE_HEIGHT * (sp?.design.size ?? 1);
    fitPrimitives(parsed, target, tweak.rotY ?? 0);

    const parts = parsed.primitives.map((prim) => ({
      mesh: this.renderer.mesh({
        pos: prim.pos, norm: prim.norm, col: prim.color, uv: prim.uv, indices: prim.indices,
      }),
      texture: prim.image ? this.renderer.texture(prim.image) : null,
      alpha: prim.alpha,
    }));
    this.models.set(id, { parts });
    this.pending.delete(id);
    this.onLoad?.(id);
  }

  /** Draws a creature: imported model when present, generated mesh otherwise. */
  draw(id, opts) {
    const model = this.models.get(id);
    if (!model) {
      this.request(id);
      this.renderer.draw(this.fallback(id), opts);
      return;
    }
    for (const part of model.parts) {
      this.renderer.draw(part.mesh, {
        ...opts,
        texture: part.texture,
        smooth: true,
        alpha: (opts.alpha ?? 1) * part.alpha,
      });
    }
  }
}
