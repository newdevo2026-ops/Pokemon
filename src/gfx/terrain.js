// Terrain + decoration art, generated once at boot into offscreen canvases.
//
// Ground materials get several random variants so large fields never look
// stamped, and neighbouring materials are feathered into each other so paths
// bleed into grass instead of ending on a hard pixel edge.

import { TILE } from '../world/tiles.js';
import { makeCanvas, makeRng, valueNoise2D, fbm, hsl, clamp } from '../core/util.js';

const VARIANTS = 6;
const WATER_FRAMES = 16;

export const MATERIALS = {
  grass:     { base: [104, 40, 40], avg: '#4c7a3c', pri: 1 },
  path:      { base: [34, 34, 55],  avg: '#a08055', pri: 3 },
  sand:      { base: [44, 48, 70],  avg: '#dcc48a', pri: 2 },
  rock:      { base: [26, 12, 42],  avg: '#6d6459', pri: 4 },
  bridge:    { base: [28, 38, 42],  avg: '#8a6740', pri: 5 },
  wood:      { base: [28, 38, 40],  avg: '#7d5c38', pri: 5 },
  tilefloor: { base: [206, 14, 66], avg: '#a3aab4', pri: 5 },
  carpet:    { base: [348, 42, 42], avg: '#9a4650', pri: 6 },
  water:     { base: [206, 68, 40], avg: '#2c6ea8', pri: 0 },
  shallow:   { base: [192, 58, 62], avg: '#69bcd0', pri: 0 },
  void:      { base: [230, 20, 8],  avg: '#0d1018', pri: 9 },
};

export const ART = { ground: {}, water: [], deco: {} };

// ------------------------------------------------------------ generators --
function paintGrass(ctx, rng, noise, ox, oy, base) {
  const [h, s, l] = base;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const n = fbm(noise, (x + ox) / 11, (y + oy) / 11, 4);
      const n2 = fbm(noise, (x + ox) / 3.2, (y + oy) / 3.2, 2);
      const li = l + (n - 0.5) * 16 + (n2 - 0.5) * 7;
      ctx.fillStyle = hsl(h + (n2 - 0.5) * 14, s + (n - 0.5) * 12, clamp(li, 8, 70));
      ctx.fillRect(x, y, 1, 1);
    }
  }
  ctx.lineCap = 'round';
  for (let i = 0; i < 46; i++) {
    const x = rng() * TILE, y = rng() * TILE;
    const len = 3 + rng() * 5;
    ctx.strokeStyle = hsl(h + rng() * 14 - 4, s + 10, l + (rng() > 0.45 ? 12 : -12), 0.55);
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rng() - 0.5) * 3, y - len); ctx.stroke();
  }
}

function paintDirt(ctx, rng, noise, ox, oy, base, pebbles = 18) {
  const [h, s, l] = base;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const n = fbm(noise, (x + ox) / 8, (y + oy) / 8, 4);
      ctx.fillStyle = hsl(h + (n - 0.5) * 10, s, clamp(l + (n - 0.5) * 14, 10, 88));
      ctx.fillRect(x, y, 1, 1);
    }
  }
  for (let i = 0; i < pebbles; i++) {
    const x = rng() * TILE, y = rng() * TILE, r = 0.8 + rng() * 2.2;
    ctx.fillStyle = hsl(h, s * 0.7, l + (rng() > 0.5 ? 14 : -16), 0.7);
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.75, rng() * 3, 0, 7); ctx.fill();
  }
}

function paintRock(ctx, rng, noise, ox, oy, base) {
  paintDirt(ctx, rng, noise, ox, oy, base, 10);
  ctx.strokeStyle = hsl(base[0], base[1], base[2] - 18, 0.55);
  ctx.lineWidth = 1.3;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    let x = rng() * TILE, y = rng() * TILE;
    ctx.moveTo(x, y);
    for (let k = 0; k < 4; k++) { x += (rng() - 0.5) * 22; y += (rng() - 0.5) * 22; ctx.lineTo(x, y); }
    ctx.stroke();
  }
}

function paintPlanks(ctx, rng, base, horizontal = true) {
  const [h, s, l] = base;
  const pw = 16;
  for (let i = 0; i < TILE / pw; i++) {
    const shade = (rng() - 0.5) * 8;
    ctx.fillStyle = hsl(h, s, clamp(l + shade, 6, 80));
    if (horizontal) ctx.fillRect(0, i * pw, TILE, pw);
    else ctx.fillRect(i * pw, 0, pw, TILE);
    ctx.strokeStyle = hsl(h, s, l - 18, 0.8);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    if (horizontal) { ctx.moveTo(0, i * pw); ctx.lineTo(TILE, i * pw); }
    else { ctx.moveTo(i * pw, 0); ctx.lineTo(i * pw, TILE); }
    ctx.stroke();
  }
  ctx.strokeStyle = hsl(h, s * 0.8, l - 8, 0.35);
  ctx.lineWidth = 1;
  for (let i = 0; i < 10; i++) {
    const y = rng() * TILE;
    ctx.beginPath();
    ctx.moveTo(0, y); ctx.bezierCurveTo(TILE * 0.3, y + (rng() - 0.5) * 4, TILE * 0.7, y + (rng() - 0.5) * 4, TILE, y);
    ctx.stroke();
  }
}

function paintTileFloor(ctx, rng, base) {
  const [h, s, l] = base;
  const half = TILE / 2;
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    ctx.fillStyle = hsl(h, s, l + ((i + j) % 2 ? -6 : 2) + (rng() - 0.5) * 3);
    ctx.fillRect(i * half, j * half, half, half);
    const g = ctx.createLinearGradient(i * half, j * half, i * half + half, j * half + half);
    g.addColorStop(0, 'rgba(255,255,255,.10)'); g.addColorStop(1, 'rgba(0,0,0,.10)');
    ctx.fillStyle = g; ctx.fillRect(i * half, j * half, half, half);
  }
  ctx.strokeStyle = hsl(h, s, l - 22, 0.6); ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, TILE, TILE);
  ctx.beginPath(); ctx.moveTo(half, 0); ctx.lineTo(half, TILE); ctx.moveTo(0, half); ctx.lineTo(TILE, half); ctx.stroke();
}

function paintCarpet(ctx, rng, base) {
  const [h, s, l] = base;
  ctx.fillStyle = hsl(h, s, l); ctx.fillRect(0, 0, TILE, TILE);
  ctx.strokeStyle = hsl(h, s, l + 8, 0.3); ctx.lineWidth = 1;
  for (let i = 0; i < TILE; i += 4) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, TILE); ctx.stroke();
  }
  ctx.strokeStyle = hsl(h, s, l - 10, 0.28);
  for (let i = 0; i < TILE; i += 4) {
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(TILE, i); ctx.stroke();
  }
}

function paintWater(ctx, noise, phase, base) {
  const [h, s, l] = base;
  // Flat base: any per-tile gradient would make each tile of a pond readable
  // as its own square.  All the life comes from the caustics below.
  ctx.fillStyle = hsl(h, s, l); ctx.fillRect(0, 0, TILE, TILE);
  // slow, low-contrast caustics; sampled coarsely and drawn soft so the
  // 16-frame loop does not read as a repeating stamp
  ctx.globalCompositeOperation = 'lighter';
  const drift = phase * 6.28;
  for (let y = 0; y < TILE; y += 2) {
    for (let x = 0; x < TILE; x += 2) {
      const n = fbm(noise, x / 26 + Math.cos(drift) * 0.35, y / 26 + Math.sin(drift) * 0.35, 3);
      const c = Math.pow(clamp((n - 0.55) * 3.2, 0, 1), 2.2);
      if (c > 0.02) {
        ctx.fillStyle = hsl(h - 16, 55, 82, c * 0.28);
        ctx.fillRect(x, y, 2, 2);
      }
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

// ------------------------------------------------------------ decorations --
function makeDeco(w, h, draw) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  draw(ctx);
  return c;
}

function tree(rng, big) {
  const w = big ? TILE * 1.5 : TILE * 1.15;
  const h = big ? TILE * 2.1 : TILE * 1.6;
  return makeDeco(w, h, (ctx) => {
    const cx = w / 2;
    const trunkH = h * (big ? 0.3 : 0.28);
    const hue = 104 + (rng() - 0.5) * 22;
    const sat = 42 + rng() * 14;
    // trunk
    const tg = ctx.createLinearGradient(cx - 9, 0, cx + 9, 0);
    tg.addColorStop(0, hsl(26, 40, 26)); tg.addColorStop(0.4, hsl(28, 42, 36)); tg.addColorStop(1, hsl(26, 40, 22));
    ctx.fillStyle = tg;
    ctx.beginPath();
    ctx.moveTo(cx - 8, h);
    ctx.quadraticCurveTo(cx - 6, h - trunkH * 0.6, cx - 5, h - trunkH);
    ctx.lineTo(cx + 5, h - trunkH);
    ctx.quadraticCurveTo(cx + 6, h - trunkH * 0.6, cx + 8, h);
    ctx.closePath(); ctx.fill();
    // canopy: overlapping blobs, dark -> light
    const blobs = big ? 8 : 6;
    const cy = h - trunkH - h * 0.26;
    for (let pass = 0; pass < 3; pass++) {
      const l = 22 + pass * 10;
      const shrink = 1 - pass * 0.16;
      const off = -pass * h * 0.035;
      for (let i = 0; i < blobs; i++) {
        const a = (i / blobs) * Math.PI * 2 + rng() * 0.2;
        const rr = (w * 0.3) * (0.65 + rng() * 0.45) * shrink;
        const px = cx + Math.cos(a) * w * 0.22 * shrink;
        const py = cy + Math.sin(a) * h * 0.13 * shrink + off;
        ctx.fillStyle = hsl(hue + (rng() - 0.5) * 12, sat, l + rng() * 6);
        ctx.beginPath(); ctx.ellipse(px, py, rr, rr * 0.9, 0, 0, 7); ctx.fill();
      }
      ctx.fillStyle = hsl(hue, sat, l + 3);
      ctx.beginPath(); ctx.ellipse(cx, cy + off, w * 0.36 * shrink, h * 0.23 * shrink, 0, 0, 7); ctx.fill();
    }
    // rim light top-left
    ctx.globalCompositeOperation = 'lighter';
    const rg = ctx.createRadialGradient(cx - w * 0.18, cy - h * 0.14, 2, cx - w * 0.18, cy - h * 0.14, w * 0.42);
    rg.addColorStop(0, 'rgba(200,255,170,.28)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  });
}

function boulder(rng) {
  const w = TILE, h = TILE * 0.95;
  return makeDeco(w, h, (ctx) => {
    const cx = w / 2, cy = h * 0.62;
    ctx.beginPath();
    const pts = 9;
    for (let i = 0; i < pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      const r = (0.72 + rng() * 0.24) * w * 0.42;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.78;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    const g = ctx.createLinearGradient(cx - w * 0.3, cy - h * 0.3, cx + w * 0.3, cy + h * 0.3);
    g.addColorStop(0, hsl(30, 12, 62)); g.addColorStop(0.55, hsl(28, 12, 46)); g.addColorStop(1, hsl(26, 14, 30));
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = hsl(26, 16, 22); ctx.stroke();
    ctx.strokeStyle = hsl(28, 10, 70, .35); ctx.lineWidth = 1.4;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(cx + (rng() - 0.5) * w * 0.4, cy - h * 0.25);
      ctx.lineTo(cx + (rng() - 0.5) * w * 0.5, cy + h * 0.2);
      ctx.stroke();
    }
  });
}

/** Bottom edge of a rock wall: a shaded front face with a narrow lit lip on
 *  top, plus a contact shadow so the wall sits on the ground. */
function cliff(rng) {
  const w = TILE, h = TILE * 1.35;
  return makeDeco(w, h, (ctx) => {
    const faceTop = h - TILE * 1.02;
    const fg = ctx.createLinearGradient(0, faceTop, 0, h);
    fg.addColorStop(0, hsl(26, 13, 30));
    fg.addColorStop(0.55, hsl(24, 14, 23));
    fg.addColorStop(1, hsl(22, 16, 15));
    ctx.fillStyle = fg; ctx.fillRect(0, faceTop, w, TILE * 1.02);
    // lit lip
    const tg = ctx.createLinearGradient(0, faceTop - TILE * 0.3, 0, faceTop + 4);
    tg.addColorStop(0, hsl(30, 15, 44)); tg.addColorStop(1, hsl(28, 14, 33));
    ctx.fillStyle = tg;
    ctx.beginPath();
    ctx.moveTo(0, faceTop + 3);
    ctx.lineTo(w * 0.1, faceTop - TILE * 0.3);
    ctx.lineTo(w, faceTop - TILE * 0.26);
    ctx.lineTo(w, faceTop + 3);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = hsl(30, 12, 52, .5); ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w * 0.1, faceTop - TILE * 0.29); ctx.lineTo(w, faceTop - TILE * 0.25);
    ctx.stroke();
    // cracks in the face
    ctx.strokeStyle = hsl(22, 16, 11, .55); ctx.lineWidth = 1.8;
    for (let i = 0; i < 4; i++) {
      const x = rng() * w;
      ctx.beginPath(); ctx.moveTo(x, faceTop + 6);
      ctx.lineTo(x + (rng() - 0.5) * 12, h - 6); ctx.stroke();
    }
    // contact shadow
    const sg = ctx.createLinearGradient(0, h - 12, 0, h);
    sg.addColorStop(0, 'rgba(0,0,0,0)'); sg.addColorStop(1, 'rgba(0,0,0,.45)');
    ctx.fillStyle = sg; ctx.fillRect(0, h - 12, w, 12);
  });
}

/** Interior of a rock wall: a flat, tile-sized block.  Only the bottom tile of
 *  a wall run gets the lit top face from cliff(), which is what makes a field
 *  of '^' read as a wall instead of a staircase. */
function cliffBody(rng) {
  return makeDeco(TILE, TILE, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, TILE * 0.4, TILE);
    g.addColorStop(0, hsl(26, 12, 30));
    g.addColorStop(0.6, hsl(24, 13, 24));
    g.addColorStop(1, hsl(22, 14, 19));
    ctx.fillStyle = g; ctx.fillRect(0, 0, TILE, TILE);
    ctx.strokeStyle = hsl(24, 14, 15, .55); ctx.lineWidth = 1.6;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      let x = rng() * TILE, y = rng() * TILE;
      ctx.moveTo(x, y);
      for (let k = 0; k < 3; k++) { x += (rng() - 0.5) * 26; y += (rng() - 0.5) * 26; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.fillStyle = hsl(28, 12, 40, .18);
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.ellipse(rng() * TILE, rng() * TILE, 3 + rng() * 7, 2 + rng() * 5, rng() * 3, 0, 7);
      ctx.fill();
    }
  });
}

function fence() {
  const w = TILE, h = TILE * 0.9;
  return makeDeco(w, h, (ctx) => {
    ctx.fillStyle = hsl(30, 30, 44);
    ctx.strokeStyle = hsl(28, 32, 24); ctx.lineWidth = 2;
    ctx.fillRect(0, h * 0.35, w, 7); ctx.strokeRect(0, h * 0.35, w, 7);
    ctx.fillRect(0, h * 0.65, w, 7); ctx.strokeRect(0, h * 0.65, w, 7);
    for (const x of [w * 0.12, w * 0.62]) {
      ctx.fillRect(x, h * 0.12, 10, h * 0.85);
      ctx.strokeRect(x, h * 0.12, 10, h * 0.85);
    }
  });
}

function sign() {
  const w = TILE, h = TILE * 1.05;
  return makeDeco(w, h, (ctx) => {
    ctx.fillStyle = hsl(28, 34, 32); ctx.fillRect(w * 0.44, h * 0.5, 8, h * 0.5);
    const g = ctx.createLinearGradient(0, h * 0.12, 0, h * 0.6);
    g.addColorStop(0, hsl(32, 44, 54)); g.addColorStop(1, hsl(30, 40, 38));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(w * 0.1, h * 0.1, w * 0.8, h * 0.45, 6); ctx.fill();
    ctx.lineWidth = 2.4; ctx.strokeStyle = hsl(28, 36, 22); ctx.stroke();
    ctx.strokeStyle = hsl(30, 30, 70, .6); ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(w * 0.2, h * (0.2 + i * 0.09)); ctx.lineTo(w * 0.8, h * (0.2 + i * 0.09));
      ctx.stroke();
    }
  });
}

function flower(rng) {
  const w = TILE, h = TILE;
  return makeDeco(w, h, (ctx) => {
    for (let k = 0; k < 3; k++) {
      const cx = 14 + rng() * (w - 28), cy = 22 + rng() * (h - 34);
      const hue = [348, 44, 288, 200][Math.floor(rng() * 4)];
      ctx.strokeStyle = hsl(110, 45, 32); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx, cy + 10); ctx.lineTo(cx, cy); ctx.stroke();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * 6.28;
        ctx.fillStyle = hsl(hue, 72, 66);
        ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * 4, cy + Math.sin(a) * 4, 3.4, 2.6, a, 0, 7); ctx.fill();
      }
      ctx.fillStyle = hsl(48, 90, 72);
      ctx.beginPath(); ctx.arc(cx, cy, 2.2, 0, 7); ctx.fill();
    }
  });
}

function bush(rng) {
  const w = TILE, h = TILE * 0.85;
  return makeDeco(w, h, (ctx) => {
    for (let i = 0; i < 5; i++) {
      const x = w * 0.5 + (rng() - 0.5) * w * 0.5;
      const y = h * 0.65 + (rng() - 0.5) * h * 0.3;
      ctx.fillStyle = hsl(108 + rng() * 16, 46, 26 + rng() * 12);
      ctx.beginPath(); ctx.ellipse(x, y, w * 0.24, h * 0.26, 0, 0, 7); ctx.fill();
    }
  });
}

function tallGrassFrame(rng, phase) {
  const w = TILE, h = TILE * 1.2;
  return makeDeco(w, h, (ctx) => {
    for (let i = 0; i < 40; i++) {
      const x = rng() * w;
      const bh = h * (0.45 + rng() * 0.5);
      const sway = Math.sin(phase * 6.28 + x * 0.12) * 5;
      const hue = 100 + rng() * 26;
      ctx.strokeStyle = hsl(hue, 50, 24 + rng() * 20);
      ctx.lineWidth = 2.6; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.quadraticCurveTo(x + sway * 0.4, h - bh * 0.55, x + sway, h - bh);
      ctx.stroke();
    }
  });
}

function counter() {
  return makeDeco(TILE, TILE, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, TILE);
    g.addColorStop(0, hsl(200, 22, 78)); g.addColorStop(0.25, hsl(200, 20, 66)); g.addColorStop(1, hsl(205, 22, 40));
    ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(0, TILE * 0.12, TILE, TILE * 0.88, 5); ctx.fill();
    ctx.strokeStyle = hsl(205, 24, 28); ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(0, TILE * 0.12, TILE, 5);
  });
}

function shelf() {
  return makeDeco(TILE, TILE * 1.2, (ctx) => {
    const h = TILE * 1.2;
    ctx.fillStyle = hsl(28, 34, 30); ctx.fillRect(2, h - TILE * 1.1, TILE - 4, TILE * 1.1);
    ctx.strokeStyle = hsl(26, 32, 18); ctx.lineWidth = 2; ctx.strokeRect(2, h - TILE * 1.1, TILE - 4, TILE * 1.1);
    for (let r = 0; r < 3; r++) {
      const y = h - TILE * 1.0 + r * TILE * 0.32;
      ctx.fillStyle = hsl(26, 30, 20); ctx.fillRect(4, y + TILE * 0.26, TILE - 8, 4);
      for (let b = 0; b < 5; b++) {
        ctx.fillStyle = hsl((b * 67 + r * 33) % 360, 55, 52);
        ctx.fillRect(7 + b * 10, y + 4, 7, TILE * 0.22);
      }
    }
  });
}

function machine() {
  return makeDeco(TILE, TILE * 1.15, (ctx) => {
    const h = TILE * 1.15;
    const g = ctx.createLinearGradient(0, h - TILE, 0, h);
    g.addColorStop(0, hsl(200, 18, 86)); g.addColorStop(1, hsl(205, 20, 58));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(4, h - TILE * 1.05, TILE - 8, TILE * 1.05, 8); ctx.fill();
    ctx.strokeStyle = hsl(205, 22, 34); ctx.lineWidth = 2.4; ctx.stroke();
    ctx.fillStyle = hsl(160, 60, 46);
    ctx.beginPath(); ctx.roundRect(12, h - TILE * 0.92, TILE - 24, TILE * 0.34, 4); ctx.fill();
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = ['#f05a5a', '#f0c25a', '#5af0a0'][i];
      ctx.beginPath(); ctx.arc(18 + i * 14, h - TILE * 0.34, 4.5, 0, 7); ctx.fill();
    }
  });
}

function pcDesk() {
  return makeDeco(TILE, TILE * 1.1, (ctx) => {
    const h = TILE * 1.1;
    ctx.fillStyle = hsl(28, 30, 34); ctx.fillRect(4, h - TILE * 0.5, TILE - 8, TILE * 0.5);
    ctx.fillStyle = hsl(210, 16, 30);
    ctx.beginPath(); ctx.roundRect(10, h - TILE * 0.98, TILE - 20, TILE * 0.5, 5); ctx.fill();
    ctx.fillStyle = hsl(190, 70, 52);
    ctx.fillRect(15, h - TILE * 0.92, TILE - 30, TILE * 0.36);
    ctx.fillStyle = 'rgba(255,255,255,.25)';
    ctx.fillRect(15, h - TILE * 0.92, TILE - 30, 6);
  });
}

function crate() {
  return makeDeco(TILE, TILE, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, TILE, TILE);
    g.addColorStop(0, hsl(32, 42, 48)); g.addColorStop(1, hsl(28, 40, 30));
    ctx.fillStyle = g; ctx.fillRect(4, 6, TILE - 8, TILE - 10);
    ctx.strokeStyle = hsl(28, 40, 20); ctx.lineWidth = 2.4;
    ctx.strokeRect(4, 6, TILE - 8, TILE - 10);
    ctx.beginPath();
    ctx.moveTo(4, 6); ctx.lineTo(TILE - 4, TILE - 4);
    ctx.moveTo(TILE - 4, 6); ctx.lineTo(4, TILE - 4);
    ctx.stroke();
  });
}

function wallBlock() {
  return makeDeco(TILE, TILE, (ctx) => {
    ctx.fillStyle = hsl(220, 12, 40); ctx.fillRect(0, 0, TILE, TILE);
    ctx.strokeStyle = hsl(220, 12, 26); ctx.lineWidth = 2;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 2; c++) {
        ctx.strokeRect((c * TILE) / 2 + (r % 2 ? TILE / 4 : 0) - TILE / 4, (r * TILE) / 4, TILE / 2, TILE / 4);
      }
    }
  });
}

// ------------------------------------------------------------------ boot --
export function buildTerrainArt() {
  const noise = valueNoise2D(1337);
  for (const [name, m] of Object.entries(MATERIALS)) {
    ART.ground[name] = [];
    for (let v = 0; v < VARIANTS; v++) {
      const c = makeCanvas(TILE, TILE);
      const ctx = c.getContext('2d');
      const rng = makeRng(0xabc + v * 977 + name.length * 31);
      const ox = v * 197 + 31, oy = v * 149 + 17;
      switch (name) {
        case 'grass': paintGrass(ctx, rng, noise, ox, oy, m.base); break;
        case 'path': paintDirt(ctx, rng, noise, ox, oy, m.base, 20); break;
        case 'sand': paintDirt(ctx, rng, noise, ox, oy, m.base, 26); break;
        case 'rock': paintRock(ctx, rng, noise, ox, oy, m.base); break;
        case 'wood': paintPlanks(ctx, rng, m.base, true); break;
        case 'bridge': paintPlanks(ctx, rng, m.base, false); break;
        case 'tilefloor': paintTileFloor(ctx, rng, m.base); break;
        case 'carpet': paintCarpet(ctx, rng, m.base); break;
        case 'shallow':
          paintDirt(ctx, rng, noise, ox, oy, MATERIALS.sand.base, 12);
          ctx.fillStyle = hsl(192, 62, 58, 0.55); ctx.fillRect(0, 0, TILE, TILE);
          break;
        case 'void':
          ctx.fillStyle = hsl(230, 22, 7); ctx.fillRect(0, 0, TILE, TILE); break;
        default:
          ctx.fillStyle = m.avg; ctx.fillRect(0, 0, TILE, TILE);
      }
      ART.ground[name].push(c);
    }
  }
  // animated water
  for (let f = 0; f < WATER_FRAMES; f++) {
    const c = makeCanvas(TILE, TILE);
    paintWater(c.getContext('2d'), noise, f / WATER_FRAMES, MATERIALS.water.base);
    ART.water.push(c);
  }
  ART.ground.water = ART.water;

  const rng = makeRng(20260909);
  ART.deco.tree = [tree(rng), tree(rng), tree(rng)];
  ART.deco.bigtree = [tree(rng, true), tree(rng, true)];
  ART.deco.boulder = [boulder(rng), boulder(rng)];
  ART.deco.cliff = [cliff(rng), cliff(rng)];
  ART.deco.cliffbody = [cliffBody(rng), cliffBody(rng), cliffBody(rng)];
  ART.deco.fence = [fence()];
  ART.deco.sign = [sign()];
  ART.deco.flower = [flower(rng), flower(rng)];
  ART.deco.bush = [bush(rng), bush(rng)];
  ART.deco.counter = [counter()];
  ART.deco.shelf = [shelf()];
  ART.deco.machine = [machine()];
  ART.deco.pc = [pcDesk()];
  ART.deco.crate = [crate()];
  ART.deco.wall = [wallBlock()];
  ART.deco.tallgrass = [];
  for (let f = 0; f < 8; f++) ART.deco.tallgrass.push(tallGrassFrame(makeRng(555), f / 8));
}

/** Materials whose texture is direction-agnostic, so tiles can be mirrored to
 *  multiply the variant count and break up visible repetition. */
export const FLIPPABLE = new Set(['grass', 'path', 'sand', 'rock', 'shallow']);

export function groundTile(mat, vx, vy, waterFrame) {
  if (mat === 'water') return ART.water[waterFrame % ART.water.length];
  const arr = ART.ground[mat] || ART.ground.grass;
  return arr[(vx * 7 + vy * 13) % arr.length];
}

export function decoSprite(name, vx, vy) {
  const arr = ART.deco[name];
  if (!arr || !arr.length) return null;
  return arr[(vx * 5 + vy * 11) % arr.length];
}
