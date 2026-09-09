// Human characters (player + NPCs) are drawn procedurally too, so a new NPC
// costs one line of colours instead of a spritesheet.
//
// Authored in a 40 x 60 box, feet at (0, 0), facing one of 4 directions.

import { hsl, clamp } from '../core/util.js';

export const LOOKS = {
  hero:     { skin: [26, 45, 74], hair: [16, 55, 26], top: [200, 62, 46], pants: [222, 30, 30], hat: [352, 62, 48], bag: [40, 60, 46] },
  heroine:  { skin: [28, 50, 78], hair: [34, 60, 42], top: [340, 60, 58], pants: [220, 28, 32], hat: [200, 55, 52], bag: [46, 62, 50] },
  prof:     { skin: [28, 40, 76], hair: [0, 0, 82], top: [0, 0, 92], pants: [220, 18, 36], hat: null, bag: null },
  nurse:    { skin: [28, 46, 80], hair: [340, 55, 62], top: [0, 0, 96], pants: [0, 0, 90], hat: [350, 60, 66], bag: null },
  clerk:    { skin: [26, 42, 68], hair: [30, 40, 30], top: [206, 55, 48], pants: [220, 20, 30], hat: null, bag: null },
  villager: { skin: [27, 44, 72], hair: [24, 45, 34], top: [140, 40, 44], pants: [30, 30, 36], hat: null, bag: null },
  villager2:{ skin: [25, 38, 62], hair: [0, 0, 24], top: [275, 40, 52], pants: [220, 22, 28], hat: null, bag: null },
  kid:      { skin: [28, 48, 78], hair: [40, 62, 46], top: [48, 72, 56], pants: [206, 40, 40], hat: null, bag: null, small: true },
  trainer:  { skin: [26, 42, 70], hair: [210, 30, 24], top: [12, 62, 46], pants: [222, 26, 26], hat: [12, 62, 40], bag: [30, 40, 32] },
  hiker:    { skin: [24, 40, 60], hair: [20, 35, 22], top: [36, 55, 44], pants: [110, 25, 30], hat: [36, 50, 34], bag: [20, 40, 28] },
  swimmer:  { skin: [28, 50, 76], hair: [196, 50, 44], top: [192, 65, 52], pants: [192, 55, 40], hat: null, bag: null },
  scholar:  { skin: [27, 40, 72], hair: [268, 30, 34], top: [268, 40, 52], pants: [230, 24, 28], hat: [268, 40, 40], bag: null },
  rival:    { skin: [26, 44, 74], hair: [20, 75, 52], top: [150, 45, 40], pants: [222, 28, 28], hat: null, bag: [30, 45, 34] },
  elder:    { skin: [28, 30, 70], hair: [0, 0, 88], top: [40, 30, 52], pants: [30, 20, 34], hat: null, bag: null },
  guard:    { skin: [26, 40, 66], hair: [0, 0, 20], top: [220, 45, 34], pants: [220, 35, 24], hat: [220, 45, 28], bag: null },
};

const C = (c, dl = 0, a = 1) => hsl(c[0], c[1], clamp(c[2] + dl, 0, 96), a);

/**
 * @param dir  'down' | 'up' | 'left' | 'right'
 * @param step  walk phase 0..1 (0 = idle stance)
 */
export function drawActor(ctx, look, x, y, dir = 'down', step = 0, scale = 1, opts = {}) {
  const L = typeof look === 'string' ? (LOOKS[look] || LOOKS.villager) : look;
  const s = scale * (L.small ? 0.82 : 1);
  const swing = Math.sin(step * Math.PI * 2);
  const bob = Math.abs(Math.cos(step * Math.PI * 2)) * 1.3;

  ctx.save();
  // soft shadow
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(x, y - 1, 13 * s, 5 * s, 0, 0, 7); ctx.fill();
  ctx.globalAlpha = opts.alpha ?? 1;

  ctx.translate(x, y - bob * s);
  ctx.scale(s, s);

  const side = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
  const back = dir === 'up';
  const outline = 'rgba(20,16,32,.85)';
  const lw = 1.8;

  const stroke = () => { ctx.lineWidth = lw; ctx.strokeStyle = outline; ctx.lineJoin = 'round'; ctx.stroke(); };

  // ---- legs
  for (const sgn of [-1, 1]) {
    const off = side ? sgn * swing * 5 : sgn * swing * 4;
    const lx = side ? off : sgn * 4.5;
    const ly = side ? 0 : 0;
    ctx.beginPath();
    ctx.roundRect(lx - 3.4, -15 + (side ? 0 : Math.abs(off) * -0.2), 6.8, 15, 3);
    ctx.fillStyle = C(L.pants, sgn < 0 ? -6 : 0); ctx.fill(); stroke();
    // shoe
    ctx.beginPath(); ctx.roundRect(lx - 4.2, -3.4, 8.4, 4, 2);
    ctx.fillStyle = C(L.pants, -16); ctx.fill(); stroke();
  }

  // ---- torso
  ctx.beginPath();
  ctx.roundRect(-8.5, -33, 17, 19, 5);
  const tg = ctx.createLinearGradient(-9, -33, 9, -14);
  tg.addColorStop(0, C(L.top, +12)); tg.addColorStop(1, C(L.top, -8));
  ctx.fillStyle = tg; ctx.fill(); stroke();

  // ---- arms
  for (const sgn of [-1, 1]) {
    const off = side ? -sgn * swing * 4 : sgn * swing * 3;
    ctx.save();
    ctx.translate(sgn * 9.6, -30);
    ctx.rotate(-sgn * 0.12 + off * 0.05);
    ctx.beginPath(); ctx.roundRect(-2.9, 0, 5.8, 14, 2.8);
    ctx.fillStyle = C(L.top, sgn < 0 ? -10 : +4); ctx.fill(); stroke();
    ctx.beginPath(); ctx.arc(0, 14.5, 3.1, 0, 7);
    ctx.fillStyle = C(L.skin); ctx.fill(); stroke();
    ctx.restore();
  }

  // ---- bag strap
  if (L.bag && !back) {
    ctx.beginPath();
    ctx.moveTo(-7, -31); ctx.lineTo(5, -18);
    ctx.lineWidth = 3; ctx.strokeStyle = C(L.bag, -8); ctx.stroke();
  }
  if (L.bag && back) {
    ctx.beginPath(); ctx.roundRect(-7.5, -30, 15, 14, 4);
    ctx.fillStyle = C(L.bag); ctx.fill(); stroke();
  }

  // ---- head
  const hy = -41;
  ctx.beginPath(); ctx.ellipse(side * 1.2, hy, 9.6, 10.2, 0, 0, 7);
  const hg = ctx.createRadialGradient(side * 1.2 - 3, hy - 4, 1, side * 1.2, hy, 11);
  hg.addColorStop(0, C(L.skin, +10)); hg.addColorStop(1, C(L.skin, -6));
  ctx.fillStyle = hg; ctx.fill(); stroke();

  // ---- hair
  ctx.beginPath();
  if (back) {
    ctx.ellipse(0, hy - 0.5, 10.2, 10.6, 0, 0, 7);
  } else if (side) {
    ctx.ellipse(side * 0.4, hy - 2.6, 10.2, 8.4, 0, Math.PI, Math.PI * 2);
    ctx.lineTo(-side * 9, hy + 4);
    ctx.lineTo(-side * 10, hy - 3);
  } else {
    ctx.ellipse(0, hy - 3.2, 10.1, 8.2, 0, Math.PI, Math.PI * 2);
    ctx.lineTo(9.5, hy + 1.5);
    ctx.quadraticCurveTo(0, hy - 2.5, -9.5, hy + 1.5);
  }
  ctx.closePath();
  ctx.fillStyle = C(L.hair); ctx.fill(); stroke();

  // ---- hat
  if (L.hat) {
    ctx.beginPath();
    ctx.ellipse(side * 0.6, hy - 5.5, 10.6, 6.2, 0, Math.PI, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = C(L.hat); ctx.fill(); stroke();
    if (!back) {
      ctx.beginPath();
      ctx.ellipse(side * 4.2, hy - 4.4, 8.4, 3, side ? 0.06 * side : 0, 0, Math.PI);
      ctx.fillStyle = C(L.hat, -12); ctx.fill(); stroke();
    }
  }

  // ---- face
  if (!back) {
    const ex = side ? side * 3.4 : 0;
    for (const sgn of side ? [1] : [-1, 1]) {
      const px = side ? ex + sgn * 0 : sgn * 3.6;
      ctx.beginPath(); ctx.ellipse(px, hy + 1.4, 1.5, 1.9, 0, 0, 7);
      ctx.fillStyle = '#221c33'; ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(side ? ex + side * 1.2 : 0, hy + 5.2, 2.6, 0.2, Math.PI - 0.2);
    ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(60,30,40,.7)'; ctx.stroke();
  }
  ctx.restore();
}

/** Head-only portrait used by dialogue boxes. */
export function drawActorPortrait(ctx, look, x, y, size) {
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, size / 2, 0, 7); ctx.clip();
  const L = typeof look === 'string' ? (LOOKS[look] || LOOKS.villager) : look;
  const g = ctx.createLinearGradient(x - size / 2, y - size / 2, x + size / 2, y + size / 2);
  g.addColorStop(0, hsl(L.top[0], 40, 30)); g.addColorStop(1, hsl(L.top[0], 45, 16));
  ctx.fillStyle = g; ctx.fillRect(x - size, y - size, size * 2, size * 2);
  drawActor(ctx, L, x, y + size * 0.95, 'down', 0, size / 42);
  ctx.restore();
  ctx.beginPath(); ctx.arc(x, y, size / 2, 0, 7);
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.stroke();
}
