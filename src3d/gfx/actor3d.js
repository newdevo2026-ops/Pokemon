// Chunky low-poly humanoid built from the same colour table the 2D sprites use.
// Returned in parts so limbs can be animated independently.

import { MeshBuilder } from '../core/meshbuilder.js';
import { hsl2rgb } from './creature3d.js';
import { LOOKS } from '../../src/gfx/actor.js';

export function buildActorMeshes(lookId) {
  const L = LOOKS[lookId] || LOOKS.hero;
  const skin = hsl2rgb(...L.skin);
  const top = hsl2rgb(...L.top);
  const pants = hsl2rgb(...L.pants);
  const hair = hsl2rgb(...L.hair);
  const hat = L.hat ? hsl2rgb(...L.hat) : null;
  const bag = L.bag ? hsl2rgb(...L.bag) : null;

  // ---- torso, head, hair, hat, bag
  const body = new MeshBuilder();
  body.push(); body.translate(0, 1.42, 0);
  body.box(0.86, 1.0, 0.5, top, top);
  body.pop();
  body.push(); body.translate(0, 2.2, 0);
  body.sphere(0.42, skin, 8, 6, 1.05);
  body.push(); body.translate(0, 0.12, -0.02);
  body.sphere(0.44, hair, 8, 5, 0.78);
  body.pop();
  // eyes
  for (const s of [-1, 1]) {
    body.push(); body.translate(s * 0.16, 0.02, 0.36);
    body.sphere(0.07, [0.08, 0.07, 0.12], 5, 4);
    body.pop();
  }
  if (hat) {
    body.push(); body.translate(0, 0.34, 0);
    body.taper(0.46, 0.34, 0.26, hat, 8);
    body.translate(0, -0.02, 0.12);
    body.push(); body.rotateX(-0.1);
    body.box(0.62, 0.06, 0.52, hat);
    body.pop();
    body.pop();
  }
  body.pop();
  if (bag) {
    body.push(); body.translate(0, 1.6, -0.34);
    body.box(0.6, 0.6, 0.28, bag);
    body.pop();
  }

  // ---- one arm and one leg, drawn twice with mirrored transforms
  const arm = new MeshBuilder();
  arm.push(); arm.translate(0, -0.34, 0);
  arm.box(0.24, 0.7, 0.24, top);
  arm.translate(0, -0.42, 0);
  arm.sphere(0.16, skin, 6, 4);
  arm.pop();

  const leg = new MeshBuilder();
  leg.push(); leg.translate(0, -0.4, 0);
  leg.box(0.28, 0.82, 0.28, pants);
  leg.translate(0, -0.46, 0.06);
  leg.box(0.32, 0.16, 0.48, hsl2rgb(L.pants[0], L.pants[1], Math.max(8, L.pants[2] - 14)));
  leg.pop();

  return { body: body.data(), arm: arm.data(), leg: leg.data() };
}

/** Flat disc used as a soft contact shadow under anything that stands up. */
export function buildShadowMesh(radius = 1) {
  const m = new MeshBuilder();
  const seg = 12;
  const c = [0, 0, 0];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * 6.28, a1 = ((i + 1) / seg) * 6.28;
    m.tri(0, 0, 0,
      Math.cos(a1) * radius, 0, Math.sin(a1) * radius,
      Math.cos(a0) * radius, 0, Math.sin(a0) * radius, c);
  }
  return m.data();
}
