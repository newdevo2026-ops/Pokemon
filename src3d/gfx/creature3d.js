// Builds a low-poly creature mesh from the same compact `design` block the 2D
// artist used — body archetype, palette, ears, tail, eyes, markings, wings.
// One data table drives both renderers, so the roster stays the single source
// of truth for what a creature looks like.

import { MeshBuilder } from '../core/meshbuilder.js';
import { getSpecies } from '../../src/data/species.js';

/** hsl (design units) -> linear-ish rgb, with saturation pushed for punch. */
export function hsl2rgb(h, s, l, boost = 1.18) {
  s = Math.min(100, s * boost) / 100;
  l = Math.min(96, l * 1.04) / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(Math.min(k(n) - 3, 9 - k(n)), 1));
  return [f(0), f(8), f(4)];
}

const shade = (c, k) => [
  Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k),
];

const DARK = [0.09, 0.08, 0.13];
const WHITE = [0.97, 0.97, 1.0];

function palette(d) {
  const main = hsl2rgb(...d.pal[0]);
  return {
    main,
    dark: shade(main, 0.68),
    belly: hsl2rgb(...d.pal[1]),
    accent: hsl2rgb(...d.pal[2]),
  };
}

// --------------------------------------------------------------- features --
function addEyes(m, P, d, y, z, spread, r) {
  const glow = d.eyes === 'glow';
  const count = d.eyes === 'multi' ? 3 : 1;
  for (const side of [-1, 1]) {
    for (let i = 0; i < count; i++) {
      const off = count === 1 ? 0 : (i - 1) * r * 1.5;
      m.push();
      m.translate(side * spread + off * side, y - Math.abs(off) * 0.3, z);
      m.sphere(r * (count === 1 ? 1 : 0.68), glow ? P.accent : WHITE, 6, 4);
      m.translate(0, 0, r * 0.55);
      m.sphere(r * 0.55, glow ? WHITE : DARK, 5, 3);
      m.pop();
    }
  }
}

function addEars(m, P, d, y, r) {
  if (!d.ears || d.ears === 'none') return;
  for (const side of [-1, 1]) {
    m.push();
    m.translate(side * r * 0.62, y, -r * 0.1);
    m.rotateZ(side * 0.35);
    switch (d.ears) {
      case 'pointy':
        m.taper(r * 0.3, 0, r * 1.25, P.main, 5);
        break;
      case 'round':
        m.translate(0, r * 0.42, 0);
        m.sphere(r * 0.42, P.main, 6, 4, 1.15);
        break;
      case 'horns':
        m.rotateZ(side * 0.25);
        m.taper(r * 0.26, r * 0.05, r * 1.45, P.accent, 5);
        break;
      case 'fins':
        m.rotateY(Math.PI / 2);
        m.blade([[0,0],[r*1.15,r*0.5],[r*1.25,-r*0.15],[r*0.2,-r*0.35]], P.accent, r * 0.14);
        break;
      case 'antenna':
        m.taper(r * 0.09, r * 0.05, r * 1.5, P.dark, 4);
        m.translate(0, r * 1.5, 0);
        m.sphere(r * 0.2, P.accent, 5, 4);
        break;
      default: break;
    }
    m.pop();
  }
}

function addTail(m, P, d, x, y, z, s) {
  if (!d.tail || d.tail === 'none') return;
  m.push();
  m.translate(x, y, z);
  switch (d.tail) {
    case 'flame':
      m.limb(0, 0, 0, 0, s * 0.85, -s * 0.5, s * 0.17, s * 0.09, P.main);
      m.push();
      m.translate(0, s * 0.85, -s * 0.5);
      m.taper(s * 0.3, 0, s * 0.75, hsl2rgb(22, 96, 56), 6);
      m.translate(0, s * 0.12, 0);
      m.taper(s * 0.2, 0, s * 0.55, hsl2rgb(44, 100, 66), 6);
      m.pop();
      break;
    case 'leaf':
      m.limb(0, 0, 0, 0, s * 0.7, -s * 0.55, s * 0.13, s * 0.07, P.dark);
      m.push();
      m.translate(0, s * 0.7, -s * 0.55);
      m.rotateX(-0.7);
      for (const side of [-1, 1]) {
        m.push(); m.rotateY(side * 0.5);
        m.blade([[0,0],[side*s*0.45,s*0.4],[side*s*0.15,s*0.85],[0,s*0.5]], P.accent, s * 0.08);
        m.pop();
      }
      m.pop();
      break;
    case 'bushy':
      m.limb(0, 0, 0, 0, s * 0.55, -s * 0.6, s * 0.2, s * 0.14, P.main);
      m.push();
      m.translate(0, s * 0.62, -s * 0.68);
      m.sphere(s * 0.42, P.belly, 7, 5, 1.25);
      m.pop();
      break;
    case 'spike':
      m.push(); m.rotateX(2.2);
      m.taper(s * 0.22, 0, s * 1.05, P.accent, 5);
      m.pop();
      break;
    case 'fin':
      m.push(); m.rotateY(Math.PI / 2);
      m.blade([[0,0],[-s*0.9,s*0.7],[-s*1.1,0],[-s*0.9,-s*0.6]], P.accent, s * 0.1);
      m.pop();
      break;
    case 'wisp':
      for (let i = 0; i < 4; i++) {
        const t = i / 4;
        m.push();
        m.translate(0, s * 0.25 * Math.sin(t * 3), -s * (0.25 + t * 0.8));
        m.sphere(s * (0.24 - t * 0.14), P.belly, 5, 4);
        m.pop();
      }
      break;
    default: break;
  }
  m.pop();
}

function addWings(m, P, d, y, z, s) {
  if (!d.wings) return;
  const inner = shade(P.accent, 1.05);
  const outer = shade(P.main, 1.15);
  for (const side of [-1, 1]) {
    m.push();
    m.translate(side * s * 0.35, y, z);
    m.rotateY(side * -0.55);
    m.rotateZ(side * 0.3);
    // two panels folded slightly apart so the wing has volume from any angle
    m.push(); m.rotateY(side * 0.16);
    m.blade([[0,0],[side*s*0.95,s*0.7],[side*s*1.15,s*0.05],[side*s*0.55,-s*0.45]],
      inner, s * 0.06);
    m.pop();
    m.push(); m.translate(side * s * 0.9, s * 0.28, 0); m.rotateY(side * -0.2); m.rotateZ(side * -0.18);
    m.blade([[0,0],[side*s*0.85,s*0.42],[side*s*1.0,-s*0.2],[side*s*0.35,-s*0.5]],
      outer, s * 0.06);
    m.pop();
    // leading edge bone
    m.limb(0, 0, 0, side * s * 1.6, s * 0.55, 0, s * 0.07, s * 0.03, P.dark);
    m.pop();
  }
}

/** Stripes / plates read as banding on the body; spots as bumps. */
function addMarkings(m, P, d, w, h, dep) {
  switch (d.markings) {
    case 'stripes':
      for (let i = -1; i <= 1; i++) {
        m.push();
        m.translate(0, h * 0.1, i * dep * 0.28);
        m.box(w * 1.02, h * 0.5, dep * 0.12, shade(P.accent, 0.9));
        m.pop();
      }
      break;
    case 'plates':
      for (let i = -1; i <= 1; i++) {
        m.push();
        m.translate(0, h * 0.42, i * dep * 0.3);
        m.box(w * 0.7, h * 0.16, dep * 0.2, P.accent);
        m.pop();
      }
      break;
    case 'spots':
      for (let i = 0; i < 5; i++) {
        const a = i * 2.4;
        m.push();
        m.translate(Math.cos(a) * w * 0.32, h * 0.12 + Math.sin(a * 1.7) * h * 0.22,
                    Math.sin(a) * dep * 0.34);
        m.sphere(w * 0.13, P.accent, 5, 4);
        m.pop();
      }
      break;
    case 'swirl':
      for (let i = 0; i < 6; i++) {
        const a = i * 1.1, r = (i / 6) * w * 0.42;
        m.push();
        m.translate(Math.cos(a) * r, h * 0.15 + Math.sin(a) * r * 0.5, dep * 0.46);
        m.sphere(w * 0.08, P.accent, 4, 3);
        m.pop();
      }
      break;
    default: break;
  }
}

// -------------------------------------------------------------- archetypes --
const BODIES = {
  quad(m, P, d) {
    const w = 0.8, h = 0.62, dep = 1.25;
    m.push(); m.translate(0, 0.95, 0);
    m.box(w, h, dep, P.main, shade(P.main, 1.12));
    addMarkings(m, P, d, w, h, dep);
    m.push(); m.translate(0, -h * 0.42, 0);
    m.box(w * 0.82, h * 0.3, dep * 0.85, P.belly);
    m.pop();
    m.pop();
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      m.limb(sx * w * 0.34, 0.95 - h * 0.3, sz * dep * 0.34,
             sx * w * 0.36, 0.06, sz * dep * 0.36, 0.14, 0.12,
             sz < 0 ? P.dark : P.main);
      m.push(); m.translate(sx * w * 0.36, 0.06, sz * dep * 0.36);
      m.box(0.3, 0.12, 0.36, P.accent);
      m.pop();
    }
    m.push(); m.translate(0, 1.28, dep * 0.62);
    m.sphere(0.52, P.main, 8, 6, 0.95);
    m.push(); m.translate(0, -0.1, 0.42);
    m.box(0.42, 0.3, 0.34, P.belly);
    m.pop();
    addEyes(m, P, d, 0.12, 0.44, 0.22, 0.13);
    addEars(m, P, d, 0.4, 0.5);
    m.pop();
    addTail(m, P, d, 0, 1.1, -dep * 0.62, 1.0);
    addWings(m, P, d, 1.3, -0.1, 0.9);
  },

  biped(m, P, d) {
    const w = 0.78, h = 1.0, dep = 0.62;
    for (const sx of [-1, 1]) {
      m.limb(sx * 0.24, 0.9, 0, sx * 0.26, 0.08, 0.02, 0.17, 0.14, P.dark);
      m.push(); m.translate(sx * 0.26, 0.07, 0.08);
      m.box(0.32, 0.14, 0.46, P.accent);
      m.pop();
    }
    m.push(); m.translate(0, 1.42, 0);
    m.box(w, h, dep, P.main, shade(P.main, 1.1));
    addMarkings(m, P, d, w, h, dep);
    m.push(); m.translate(0, -h * 0.1, dep * 0.42);
    m.box(w * 0.6, h * 0.62, dep * 0.2, P.belly);
    m.pop();
    m.pop();
    for (const sx of [-1, 1]) {
      m.limb(sx * w * 0.55, 1.78, 0, sx * (w * 0.62), 1.05, 0.12, 0.14, 0.12, P.main);
      m.push(); m.translate(sx * w * 0.62, 1.0, 0.14);
      m.sphere(0.17, P.accent, 6, 4);
      m.pop();
    }
    m.push(); m.translate(0, 2.16, 0.02);
    m.sphere(0.5, P.main, 8, 6);
    addEyes(m, P, d, 0.06, 0.42, 0.2, 0.13);
    addEars(m, P, d, 0.38, 0.48);
    m.pop();
    addTail(m, P, d, 0, 1.1, -dep * 0.6, 1.0);
    addWings(m, P, d, 1.7, -dep * 0.4, 1.0);
  },

  serpent(m, P, d) {
    const seg = 9;
    for (let i = 0; i < seg; i++) {
      const t = i / (seg - 1);
      const r = 0.42 * (1 - t * 0.45);
      m.push();
      m.translate(Math.sin(t * 5) * 0.5, 0.4 + t * 1.5, -t * 1.1 + 0.5);
      m.sphere(r, i % 2 ? P.main : shade(P.main, 0.92), 7, 5);
      m.pop();
    }
    m.push(); m.translate(Math.sin(5) * 0.5, 2.05, -0.65);
    m.sphere(0.48, P.main, 8, 6, 0.9);
    m.push(); m.translate(0, -0.06, 0.4);
    m.box(0.4, 0.26, 0.4, P.belly);
    m.pop();
    addEyes(m, P, d, 0.12, 0.4, 0.2, 0.12);
    addEars(m, P, d, 0.36, 0.46);
    m.pop();
    addTail(m, P, d, 0.2, 0.4, 0.7, 0.9);
    addWings(m, P, d, 1.5, 0, 0.95);
  },

  avian(m, P, d) {
    for (const sx of [-1, 1]) {
      m.limb(sx * 0.16, 0.85, 0, sx * 0.18, 0.06, 0, 0.07, 0.06, P.accent);
      m.push(); m.translate(sx * 0.18, 0.05, 0.1);
      m.box(0.2, 0.08, 0.34, P.accent);
      m.pop();
    }
    m.push(); m.translate(0, 1.3, 0);
    m.sphere(0.6, P.main, 8, 6, 1.15);
    addMarkings(m, P, d, 1.0, 1.1, 1.0);
    m.push(); m.translate(0, -0.12, 0.34);
    m.sphere(0.36, P.belly, 6, 5, 1.1);
    m.pop();
    m.pop();
    m.push(); m.translate(0, 2.0, 0.1);
    m.sphere(0.42, P.main, 8, 6);
    m.push(); m.translate(0, -0.04, 0.36);
    m.rotateX(Math.PI / 2);
    m.taper(0.16, 0, 0.42, P.accent, 5);
    m.pop();
    addEyes(m, P, d, 0.1, 0.34, 0.18, 0.11);
    addEars(m, P, d, 0.32, 0.42);
    m.pop();
    addTail(m, P, d, 0, 1.15, -0.6, 1.0);
    // Wings are the silhouette here, so an avian always gets them.
    const saved = d.wings; d.wings = true;
    addWings(m, P, d, 1.35, 0, 1.05);
    d.wings = saved;
  },

  insect(m, P, d) {
    for (let i = 0; i < 3; i++) {
      m.push();
      m.translate(0, 1.05 - i * 0.06, -i * 0.42);
      m.sphere(0.38 - i * 0.05, i % 2 ? P.accent : P.main, 7, 5, 1.05);
      m.pop();
    }
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
      m.limb(sx * 0.22, 1.0, 0.15 - i * 0.3,
             sx * 0.72, 0.08, 0.3 - i * 0.42, 0.055, 0.04, P.dark);
    }
    m.push(); m.translate(0, 1.2, 0.55);
    m.sphere(0.36, P.main, 7, 5);
    addEyes(m, P, d, 0.06, 0.3, 0.17, 0.12);
    addEars(m, P, d, 0.28, 0.4);
    m.pop();
    const saved = d.wings; d.wings = true;
    addWings(m, P, d, 1.35, -0.15, 0.95);
    d.wings = saved;
    addTail(m, P, d, 0, 1.0, -1.0, 0.8);
  },

  aquatic(m, P, d) {
    m.push(); m.translate(0, 1.15, 0);
    m.sphere(0.72, P.main, 9, 6, 1.05);
    addMarkings(m, P, d, 1.1, 1.2, 1.1);
    m.push(); m.translate(0, -0.2, 0.3);
    m.sphere(0.44, P.belly, 6, 5, 0.9);
    m.pop();
    // dorsal fin
    m.push(); m.translate(0, 0.6, -0.1); m.rotateY(Math.PI / 2);
    m.blade([[0,0],[0.5,0.7],[-0.5,0.55]], P.accent, 0.1);
    m.pop();
    for (const sx of [-1, 1]) {
      m.push(); m.translate(sx * 0.62, -0.05, 0.05); m.rotateZ(sx * -0.5);
      m.blade([[0,0],[sx*0.7,0.3],[sx*0.6,-0.35]], P.accent, 0.08);
      m.pop();
    }
    addEyes(m, P, d, 0.22, 0.62, 0.26, 0.14);
    addEars(m, P, d, 0.5, 0.55);
    m.pop();
    addTail(m, P, d, 0, 1.05, -0.7, 1.0);
  },

  golem(m, P, d) {
    m.push(); m.translate(0, 0.95, 0);
    m.box(1.15, 1.25, 0.95, P.main, shade(P.main, 1.14));
    addMarkings(m, P, d, 1.15, 1.25, 0.95);
    m.pop();
    for (const sx of [-1, 1]) {
      m.push(); m.translate(sx * 0.8, 1.05, 0);
      m.box(0.4, 0.75, 0.4, P.belly);
      m.pop();
      m.push(); m.translate(sx * 0.34, 0.2, 0);
      m.box(0.44, 0.42, 0.55, shade(P.main, 0.8));
      m.pop();
    }
    m.push(); m.translate(0, 1.92, 0);
    m.box(0.78, 0.62, 0.7, shade(P.main, 1.08));
    addEyes(m, P, d, 0.04, 0.36, 0.2, 0.12);
    addEars(m, P, d, 0.32, 0.42);
    m.pop();
    addTail(m, P, d, 0, 0.9, -0.55, 0.9);
    addWings(m, P, d, 1.5, -0.4, 1.0);
  },

  spirit(m, P, d) {
    m.push(); m.translate(0, 1.45, 0);
    m.sphere(0.68, P.main, 9, 7);
    addMarkings(m, P, d, 1.0, 1.1, 1.0);
    addEyes(m, P, d, 0.14, 0.58, 0.24, 0.15);
    addEars(m, P, d, 0.5, 0.6);
    m.pop();
    // trailing skirt of shrinking blobs instead of legs
    for (let i = 0; i < 4; i++) {
      const t = i / 4;
      m.push();
      m.translate(0, 0.95 - t * 0.55, 0);
      m.sphere(0.5 - t * 0.28, shade(P.main, 0.9 - t * 0.15), 7, 4, 0.7);
      m.pop();
    }
    addTail(m, P, d, 0, 1.2, -0.55, 1.0);
    addWings(m, P, d, 1.6, -0.2, 1.0);
  },
};

/** @returns geometry data ready for Renderer.mesh() */
export function buildCreatureMesh(speciesId) {
  const sp = getSpecies(speciesId);
  const d = sp.design;
  const P = palette(d);
  const m = new MeshBuilder();
  // Creatures are authored around 2 units tall; this lifts them to read
  // properly next to a ~2.6 unit player.
  const s = (d.size ?? 1) * 1.35;
  m.push();
  m.scale(s, s, s);
  (BODIES[d.body] || BODIES.quad)(m, P, d);
  m.pop();
  return m.data();
}

export const AURA_COLOR = {
  fire: [1.0, 0.45, 0.15], spark: [1.0, 0.9, 0.25], leaf: [0.4, 0.9, 0.35],
  bubble: [0.4, 0.8, 1.0], shadow: [0.45, 0.3, 0.75], light: [1.0, 0.92, 0.6],
  ice: [0.6, 0.95, 1.0], poison: [0.8, 0.4, 0.95], wind: [0.8, 0.95, 1.0],
};
