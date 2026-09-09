// Procedural creature artist.
//
// Every creature is *drawn*, not blitted: gradients, rim light, soft shadow,
// breathing, blinking, tail sway and an elemental aura, all derived from the
// compact `design` block in data/species.js.  That is what gives the game a
// modern look without a single image asset.
//
// Everything is authored inside a 100x100 unit box centred on (0,0), feet at
// y = +46.  drawMonster() scales that box to whatever size you ask for.

import { hsl, clamp, makeRng, hashStr, makeCanvas } from '../core/util.js';
import { getSpecies } from '../data/species.js';

// Scratch buffer for tinted renders.  'source-atop' composites against the
// whole target canvas, so a hit flash has to be applied inside an isolated
// buffer — otherwise it paints a rectangle over the entire screen.
let scratch = null, scratchCtx = null;
function getScratch(size) {
  if (!scratch) { scratch = makeCanvas(size, size); scratchCtx = scratch.getContext('2d'); }
  else if (scratch.width < size) { scratch.width = scratch.height = size; }
  scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
  scratchCtx.clearRect(0, 0, scratch.width, scratch.height);
  return scratchCtx;
}

// ---------------------------------------------------------------- palette --
function tone(c, dl = 0, ds = 0, a = 1) {
  return hsl(c[0], clamp(c[1] + ds, 0, 100), clamp(c[2] + dl, 0, 100), a);
}
function outlineOf(c) { return hsl(c[0], Math.min(c[1] * 0.85, 70), Math.max(c[2] - 34, 8)); }

function bodyGradient(ctx, x, y, rx, ry, c) {
  const g = ctx.createLinearGradient(x - rx * 0.7, y - ry, x + rx * 0.5, y + ry);
  g.addColorStop(0.00, tone(c, +20));
  g.addColorStop(0.45, tone(c, +2));
  g.addColorStop(1.00, tone(c, -16, -4));
  return g;
}

// ------------------------------------------------------------ path helpers --
/** Organic closed blob: an ellipse with per-vertex wobble driven by a seed. */
function blobPath(ctx, cx, cy, rx, ry, wobble, rng, steps = 14) {
  ctx.beginPath();
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const w = 1 + (rng() - 0.5) * wobble;
    pts.push([cx + Math.cos(a) * rx * w, cy + Math.sin(a) * ry * w]);
  }
  ctx.moveTo((pts[0][0] + pts[steps - 1][0]) / 2, (pts[0][1] + pts[steps - 1][1]) / 2);
  for (let i = 0; i < steps; i++) {
    const p = pts[i], n = pts[(i + 1) % steps];
    ctx.quadraticCurveTo(p[0], p[1], (p[0] + n[0]) / 2, (p[1] + n[1]) / 2);
  }
  ctx.closePath();
}

/** Tapered limb / tail: a thick-to-thin capsule along a quadratic curve. */
function limbPath(ctx, x1, y1, cx, cy, x2, y2, w1, w2) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const nx = Math.cos(ang + Math.PI / 2), ny = Math.sin(ang + Math.PI / 2);
  ctx.beginPath();
  ctx.moveTo(x1 + nx * w1, y1 + ny * w1);
  ctx.quadraticCurveTo(cx + nx * (w1 + w2) / 2, cy + ny * (w1 + w2) / 2, x2 + nx * w2, y2 + ny * w2);
  ctx.arc(x2, y2, w2, ang + Math.PI / 2, ang - Math.PI / 2, true);
  ctx.quadraticCurveTo(cx - nx * (w1 + w2) / 2, cy - ny * (w1 + w2) / 2, x1 - nx * w1, y1 - ny * w1);
  ctx.arc(x1, y1, w1, ang - Math.PI / 2, ang + Math.PI / 2, true);
  ctx.closePath();
}

function fillStroke(ctx, fill, stroke, lw = 3.2) {
  ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.lineJoin = 'round'; ctx.stroke(); }
}

// ------------------------------------------------------------------ parts --
function drawEyes(ctx, d, x, y, spread, scale, blink, angry) {
  const kind = d.eyes;
  const white = '#ffffff';
  const dark = '#141024';
  for (const s of [-1, 1]) {
    const ex = x + s * spread, ey = y;
    if (blink > 0.5) {
      ctx.beginPath();
      ctx.moveTo(ex - 5 * scale, ey); ctx.lineTo(ex + 5 * scale, ey);
      ctx.lineWidth = 2.4 * scale; ctx.strokeStyle = dark; ctx.lineCap = 'round'; ctx.stroke();
      continue;
    }
    ctx.save();
    if (kind === 'glow') {
      const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, 9 * scale);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.35, tone(d.pal[2], +26));
      g.addColorStop(1, tone(d.pal[2], -6, 0, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(ex, ey, 9 * scale, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(ex, ey, 3.1 * scale, 0, 7); ctx.fill();
    } else if (kind === 'multi') {
      for (let i = 0; i < 3; i++) {
        const ox = (i - 1) * 3.6 * scale, oy = Math.abs(i - 1) * 1.6 * scale;
        ctx.fillStyle = i === 1 ? white : tone(d.pal[2], +10);
        ctx.beginPath(); ctx.ellipse(ex + ox, ey + oy, 2.9 * scale, 3.6 * scale, 0, 0, 7); ctx.fill();
        ctx.fillStyle = dark;
        ctx.beginPath(); ctx.arc(ex + ox, ey + oy, 1.5 * scale, 0, 7); ctx.fill();
      }
    } else {
      const ry = kind === 'sleepy' ? 3.4 : kind === 'sharp' ? 4.4 : 5.4;
      ctx.fillStyle = white;
      ctx.beginPath(); ctx.ellipse(ex, ey, 4.6 * scale, ry * scale, 0, 0, 7); ctx.fill();
      ctx.lineWidth = 1.4 * scale; ctx.strokeStyle = '#2a2440'; ctx.stroke();
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(ex + s * 0.8 * scale, ey + 0.6 * scale, 2.5 * scale, 3.2 * scale, 0, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.beginPath(); ctx.arc(ex + s * 1.6 * scale, ey - 1.5 * scale, 1.3 * scale, 0, 7); ctx.fill();
    }
    // brow
    if (kind === 'sharp' || angry) {
      ctx.beginPath();
      ctx.moveTo(ex - s * 6 * scale, ey - 7 * scale);
      ctx.lineTo(ex + s * 5 * scale, ey - 4.2 * scale);
      ctx.lineWidth = 2.6 * scale; ctx.strokeStyle = outlineOf(d.pal[0]); ctx.lineCap = 'round'; ctx.stroke();
    }
    ctx.restore();
  }
}

function drawMouth(ctx, d, x, y, w, scale, open) {
  ctx.beginPath();
  if (open > 0.02) {
    ctx.ellipse(x, y + 1 * scale, w * 0.7, (2 + open * 5) * scale, 0, 0, 7);
    ctx.fillStyle = '#5c2434'; ctx.fill();
    ctx.lineWidth = 1.8 * scale; ctx.strokeStyle = outlineOf(d.pal[0]); ctx.stroke();
  } else {
    ctx.moveTo(x - w * 0.5, y);
    ctx.quadraticCurveTo(x, y + 3.2 * scale, x + w * 0.5, y);
    ctx.lineWidth = 2.2 * scale; ctx.strokeStyle = outlineOf(d.pal[0]);
    ctx.lineCap = 'round'; ctx.stroke();
  }
}

function drawEars(ctx, d, hx, hy, hr, t, out) {
  const c = d.pal[0], acc = d.pal[2];
  const twitch = Math.sin(t * 2.1) * 0.09;
  for (const s of [-1, 1]) {
    const bx = hx + s * hr * 0.62, by = hy - hr * 0.66;
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(s * (0.35 + twitch));
    switch (d.ears) {
      case 'pointy':
        ctx.beginPath();
        ctx.moveTo(-hr * 0.34, 0); ctx.quadraticCurveTo(0, -hr * 1.25, hr * 0.32, hr * 0.06);
        ctx.quadraticCurveTo(0, hr * 0.2, -hr * 0.34, 0);
        fillStroke(ctx, bodyGradient(ctx, 0, -hr * 0.5, hr * 0.4, hr * 0.7, c), out, 2.8);
        ctx.beginPath();
        ctx.moveTo(-hr * 0.16, -hr * 0.06); ctx.quadraticCurveTo(0, -hr * 0.85, hr * 0.15, -hr * 0.02);
        ctx.closePath(); ctx.fillStyle = tone(acc, +6, 0, 0.85); ctx.fill();
        break;
      case 'round':
        ctx.beginPath(); ctx.ellipse(0, -hr * 0.42, hr * 0.42, hr * 0.5, s * 0.2, 0, 7);
        fillStroke(ctx, bodyGradient(ctx, 0, -hr * 0.4, hr * 0.42, hr * 0.5, c), out, 2.8);
        ctx.beginPath(); ctx.ellipse(0, -hr * 0.4, hr * 0.2, hr * 0.26, 0, 0, 7);
        ctx.fillStyle = tone(acc, +8, 0, 0.8); ctx.fill();
        break;
      case 'horns':
        ctx.beginPath();
        ctx.moveTo(-hr * 0.2, hr * 0.1);
        ctx.quadraticCurveTo(hr * 0.1, -hr * 1.1, hr * 0.55, -hr * 1.25);
        ctx.quadraticCurveTo(hr * 0.12, -hr * 0.7, hr * 0.24, hr * 0.12);
        ctx.closePath();
        fillStroke(ctx, tone(acc, +4), out, 2.6);
        break;
      case 'fins':
        ctx.beginPath();
        ctx.moveTo(0, hr * 0.1);
        ctx.quadraticCurveTo(hr * 0.5, -hr * 0.6, hr * 0.95, -hr * 0.2);
        ctx.quadraticCurveTo(hr * 0.5, -hr * 0.05, 0, hr * 0.3);
        ctx.closePath();
        fillStroke(ctx, tone(acc, +10, 0, 0.92), out, 2.4);
        break;
      case 'antenna':
        ctx.beginPath();
        ctx.moveTo(0, hr * 0.1);
        ctx.quadraticCurveTo(s * hr * 0.2, -hr * 0.9, s * hr * 0.55 + Math.sin(t * 2.4 + s) * 2, -hr * 1.25);
        ctx.lineWidth = 2.6; ctx.strokeStyle = out; ctx.lineCap = 'round'; ctx.stroke();
        ctx.beginPath();
        ctx.arc(s * hr * 0.55 + Math.sin(t * 2.4 + s) * 2, -hr * 1.25, hr * 0.16, 0, 7);
        fillStroke(ctx, tone(acc, +14), out, 2);
        break;
      default: break;
    }
    ctx.restore();
  }
}

function drawTail(ctx, d, bx, by, t, out, scale = 1) {
  if (!d.tail || d.tail === 'none') return;
  const sway = Math.sin(t * 2.3) * 8 * scale;
  const acc = d.pal[2], c = d.pal[0];
  ctx.save();
  switch (d.tail) {
    case 'flame': {
      const tipX = bx - 22 * scale, tipY = by - 26 * scale + sway * 0.4;
      limbPath(ctx, bx, by, bx - 14 * scale, by - 6 * scale, tipX, tipY, 5 * scale, 3 * scale);
      fillStroke(ctx, bodyGradient(ctx, bx, by, 14 * scale, 14 * scale, c), out, 2.8);
      for (let i = 0; i < 3; i++) {
        const f = 1 - i * 0.28;
        const wob = Math.sin(t * 7 + i * 1.7) * 3 * scale;
        ctx.beginPath();
        ctx.moveTo(tipX - 7 * scale * f, tipY + 3 * scale);
        ctx.quadraticCurveTo(tipX - 3 * scale + wob, tipY - 20 * scale * f, tipX + 1 * scale + wob, tipY - 26 * scale * f);
        ctx.quadraticCurveTo(tipX + 8 * scale * f, tipY - 14 * scale * f, tipX + 7 * scale * f, tipY + 3 * scale);
        ctx.closePath();
        ctx.fillStyle = i === 0 ? hsl(14, 92, 54, .95) : i === 1 ? hsl(34, 96, 60, .95) : hsl(48, 100, 74, .95);
        ctx.fill();
      }
      break;
    }
    case 'leaf': {
      const tipX = bx - 24 * scale, tipY = by - 18 * scale + sway * 0.3;
      limbPath(ctx, bx, by, bx - 14 * scale, by - 2 * scale, tipX, tipY, 4.5 * scale, 2.4 * scale);
      fillStroke(ctx, tone(c, -6), out, 2.6);
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(tipX, tipY + 2 * scale);
        ctx.quadraticCurveTo(tipX + s * 16 * scale, tipY - 14 * scale, tipX + s * 3 * scale, tipY - 20 * scale);
        ctx.quadraticCurveTo(tipX - s * 3 * scale, tipY - 10 * scale, tipX, tipY + 2 * scale);
        ctx.closePath();
        fillStroke(ctx, tone(acc, +6), out, 2.2);
      }
      break;
    }
    case 'bushy': {
      const tipX = bx - 20 * scale, tipY = by - 22 * scale + sway * 0.5;
      limbPath(ctx, bx, by, bx - 16 * scale, by - 4 * scale, tipX, tipY, 6 * scale, 9 * scale);
      fillStroke(ctx, bodyGradient(ctx, tipX, tipY, 14 * scale, 14 * scale, c), out, 2.8);
      ctx.beginPath(); ctx.ellipse(tipX - 2 * scale, tipY - 4 * scale, 7 * scale, 6 * scale, 0, 0, 7);
      ctx.fillStyle = tone(d.pal[1], +6, 0, 0.9); ctx.fill();
      break;
    }
    case 'spike': {
      const tipX = bx - 26 * scale, tipY = by - 14 * scale + sway * 0.4;
      ctx.beginPath();
      ctx.moveTo(bx, by - 6 * scale);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(bx, by + 6 * scale);
      ctx.closePath();
      fillStroke(ctx, tone(acc, 0), out, 2.6);
      break;
    }
    case 'fin': {
      const tipX = bx - 26 * scale, tipY = by - 16 * scale + sway * 0.5;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(tipX + 6 * scale, tipY + 12 * scale, tipX - 4 * scale, tipY + 16 * scale);
      ctx.quadraticCurveTo(tipX + 2 * scale, tipY, tipX - 6 * scale, tipY - 12 * scale);
      ctx.quadraticCurveTo(tipX + 8 * scale, tipY - 6 * scale, bx, by - 4 * scale);
      ctx.closePath();
      fillStroke(ctx, tone(acc, +8, 0, 0.92), out, 2.4);
      break;
    }
    case 'wisp': {
      ctx.beginPath();
      ctx.moveTo(bx - 8 * scale, by - 6 * scale);
      for (let i = 1; i <= 5; i++) {
        const p = i / 5;
        ctx.lineTo(bx - 8 * scale - p * 26 * scale,
                   by - 6 * scale + Math.sin(t * 3 + p * 5) * 8 * scale * p);
      }
      ctx.lineWidth = 7 * scale * 0.9; ctx.lineCap = 'round';
      ctx.strokeStyle = tone(c, -4, 0, 0.7); ctx.stroke();
      ctx.lineWidth = 3 * scale; ctx.strokeStyle = tone(d.pal[1], +8, 0, 0.55); ctx.stroke();
      break;
    }
    default: break;
  }
  ctx.restore();
}

function drawMarkings(ctx, d, cx, cy, rx, ry, rng) {
  const acc = d.pal[2];
  ctx.save();
  ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, 7); ctx.clip();
  switch (d.markings) {
    case 'stripes':
      ctx.strokeStyle = tone(acc, -6, 0, 0.5); ctx.lineWidth = rx * 0.16; ctx.lineCap = 'round';
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * rx * 0.4, cy - ry);
        ctx.quadraticCurveTo(cx + i * rx * 0.4 + rx * 0.12, cy, cx + i * rx * 0.4, cy + ry);
        ctx.stroke();
      }
      break;
    case 'spots':
      ctx.fillStyle = tone(acc, +4, 0, 0.45);
      for (let i = 0; i < 7; i++) {
        const a = rng() * 6.28, r = rng();
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * rx * r * 0.85, cy + Math.sin(a) * ry * r * 0.85,
          rx * (0.1 + rng() * 0.1), ry * (0.1 + rng() * 0.1), 0, 0, 7);
        ctx.fill();
      }
      break;
    case 'plates':
      ctx.strokeStyle = tone(d.pal[0], -22, 0, 0.65); ctx.lineWidth = rx * 0.08;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.ellipse(cx, cy + ry * 0.2, rx * (0.3 + i * 0.24), ry * (0.3 + i * 0.24), 0, Math.PI * 1.05, Math.PI * 1.95);
        ctx.stroke();
      }
      break;
    case 'swirl':
      ctx.strokeStyle = tone(acc, +8, 0, 0.55); ctx.lineWidth = rx * 0.1; ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < 46; i++) {
        const a = i * 0.28, r = (i / 46) * rx * 0.8;
        const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r * (ry / rx);
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
      break;
    default: break;
  }
  ctx.restore();
}

function drawWings(ctx, d, cx, cy, r, t, out, behind) {
  const flap = Math.sin(t * 5.2);
  const acc = d.pal[2];
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.translate(cx + s * r * 0.4, cy - r * 0.25);
    ctx.rotate(s * (0.25 + flap * 0.32));
    ctx.scale(s, 1);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(r * 1.5, -r * 1.3, r * 2.15, -r * 0.15);
    ctx.quadraticCurveTo(r * 1.5, r * 0.18, r * 1.65, r * 0.75);
    ctx.quadraticCurveTo(r * 0.8, r * 0.35, 0, r * 0.42);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -r, r * 2, r);
    g.addColorStop(0, tone(d.pal[1], +12, 0, behind ? 0.75 : 0.95));
    g.addColorStop(1, tone(acc, -2, 0, behind ? 0.6 : 0.9));
    fillStroke(ctx, g, out, 2.6);
    ctx.beginPath();
    ctx.moveTo(r * 0.2, r * 0.05); ctx.lineTo(r * 1.75, -r * 0.5);
    ctx.moveTo(r * 0.2, r * 0.18); ctx.lineTo(r * 1.5, r * 0.3);
    ctx.lineWidth = 1.8; ctx.strokeStyle = tone(d.pal[0], -18, 0, 0.5); ctx.stroke();
    ctx.restore();
  }
}

// ------------------------------------------------------------------ auras --
function drawAura(ctx, d, t, back) {
  const a = d.aura;
  if (!a) return;
  const rng = makeRng(7);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const n = 9;
  for (let i = 0; i < n; i++) {
    const ph = (t * (a === 'ice' ? 0.35 : 0.75) + i / n) % 1;
    const ax = (rng() - 0.5) * 92;
    const ay = 46 - ph * 100;
    const fade = Math.sin(ph * Math.PI);
    const size = 3 + rng() * 4;
    ctx.globalAlpha = fade * (back ? 0.35 : 0.55);
    switch (a) {
      case 'fire': ctx.fillStyle = hsl(20 + rng() * 30, 100, 62); break;
      case 'spark': ctx.fillStyle = hsl(50, 100, 70); break;
      case 'leaf': ctx.fillStyle = hsl(100 + rng() * 40, 70, 60); break;
      case 'bubble': ctx.fillStyle = hsl(196, 90, 74); break;
      case 'shadow': ctx.fillStyle = hsl(268, 60, 40); break;
      case 'light': ctx.fillStyle = hsl(48, 100, 80); break;
      case 'ice': ctx.fillStyle = hsl(188, 90, 82); break;
      case 'poison': ctx.fillStyle = hsl(290, 70, 62); break;
      case 'wind': ctx.fillStyle = hsl(200, 40, 88); break;
      default: ctx.fillStyle = '#fff';
    }
    if (a === 'spark') {
      ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(ax, ay); ctx.lineTo(ax + 4, ay + 6); ctx.lineTo(ax - 2, ay + 7); ctx.lineTo(ax + 3, ay + 14);
      ctx.stroke();
    } else if (a === 'leaf') {
      ctx.beginPath();
      ctx.ellipse(ax, ay, size * 1.5, size * 0.7, ph * 6, 0, 7); ctx.fill();
    } else if (a === 'ice') {
      ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const an = k * 1.047 + ph * 2;
        ctx.moveTo(ax - Math.cos(an) * size, ay - Math.sin(an) * size);
        ctx.lineTo(ax + Math.cos(an) * size, ay + Math.sin(an) * size);
      }
      ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(ax, ay, size, 0, 7); ctx.fill();
    }
  }
  ctx.restore();
}

// ------------------------------------------------------------ body layouts --
function drawQuad(ctx, d, t, back, out, rng, breathe, blink, mouthOpen) {
  const c = d.pal[0], belly = d.pal[1];
  const bx = 2, by = 12 + breathe * 1.5;
  const rx = 30, ry = 20 * (1 + breathe * 0.05);
  const hx = 26, hy = -12 + breathe * 2;
  const hr = 20;

  // back legs
  for (const s of [0, 1]) {
    const lx = bx + (s ? 18 : -18), lift = Math.sin(t * 2 + s * 3) * 1.5;
    limbPath(ctx, lx, by + 8, lx - 2, by + 20, lx - 1, 44 + lift, 8, 6);
    fillStroke(ctx, tone(c, -14), out, 2.8);
  }
  drawTail(ctx, d, bx - rx * 0.9, by - 2, t, out);
  // torso
  blobPath(ctx, bx, by, rx, ry, 0.1, rng);
  fillStroke(ctx, bodyGradient(ctx, bx, by, rx, ry, c), out, 3.4);
  // belly
  ctx.beginPath(); ctx.ellipse(bx + 2, by + ry * 0.42, rx * 0.62, ry * 0.5, 0, 0, 7);
  ctx.fillStyle = tone(belly, +6, -6, 0.75); ctx.fill();
  drawMarkings(ctx, d, bx, by, rx, ry, rng);
  if (d.wings) drawWings(ctx, d, bx - 4, by - 6, 16, t, out, false);
  // front legs
  for (const s of [0, 1]) {
    const lx = bx + (s ? 22 : 8), lift = Math.sin(t * 2 + s * 2 + 1.5) * 1.5;
    limbPath(ctx, lx, by + 6, lx + 2, by + 20, lx + 1, 44 + lift, 7.5, 5.5);
    fillStroke(ctx, tone(c, s ? -4 : -12), out, 2.8);
  }
  // head
  blobPath(ctx, hx, hy, hr, hr * 0.92, 0.08, rng, 12);
  fillStroke(ctx, bodyGradient(ctx, hx, hy, hr, hr, c), out, 3.4);
  drawEars(ctx, d, hx, hy, hr, t, out);
  if (!back) {
    // muzzle
    ctx.beginPath(); ctx.ellipse(hx + 8, hy + 7, 11, 8, 0, 0, 7);
    ctx.fillStyle = tone(belly, +8, -8, 0.9); ctx.fill();
    drawEyes(ctx, d, hx + 2, hy - 3, 8, 1, blink, false);
    ctx.beginPath(); ctx.ellipse(hx + 13, hy + 4, 2.6, 2.1, 0, 0, 7);
    ctx.fillStyle = outlineOf(c); ctx.fill();
    drawMouth(ctx, d, hx + 11, hy + 10, 11, 1, mouthOpen);
  }
}

function drawBiped(ctx, d, t, back, out, rng, breathe, blink, mouthOpen) {
  const c = d.pal[0], belly = d.pal[1];
  const bx = 0, by = 8 + breathe * 1.5;
  const rx = 22, ry = 26 * (1 + breathe * 0.04);
  const hx = 0, hy = -28 + breathe * 2, hr = 19;

  if (d.wings) drawWings(ctx, d, bx, by - 10, 18, t, out, true);
  drawTail(ctx, d, bx - rx * 0.8, by + 12, t, out);
  // legs
  for (const s of [-1, 1]) {
    limbPath(ctx, bx + s * 10, by + ry * 0.6, bx + s * 13, by + ry * 0.9, bx + s * 12, 45, 9, 7);
    fillStroke(ctx, tone(c, s < 0 ? -14 : -4), out, 3);
    ctx.beginPath(); ctx.ellipse(bx + s * 13, 45, 10, 5, 0, 0, 7);
    fillStroke(ctx, tone(d.pal[2], -4), out, 2.4);
  }
  // torso
  blobPath(ctx, bx, by, rx, ry, 0.08, rng, 12);
  fillStroke(ctx, bodyGradient(ctx, bx, by, rx, ry, c), out, 3.4);
  ctx.beginPath(); ctx.ellipse(bx, by + 4, rx * 0.6, ry * 0.62, 0, 0, 7);
  ctx.fillStyle = tone(belly, +6, -6, 0.7); ctx.fill();
  drawMarkings(ctx, d, bx, by, rx, ry, rng);
  // arms
  for (const s of [-1, 1]) {
    const swing = Math.sin(t * 1.9 + (s > 0 ? 1.6 : 0)) * 3;
    limbPath(ctx, bx + s * rx * 0.75, by - 10, bx + s * (rx + 8), by + 2 + swing, bx + s * (rx + 6), by + 16 + swing, 7, 5.5);
    fillStroke(ctx, tone(c, s > 0 ? -3 : -13), out, 2.8);
    ctx.beginPath(); ctx.arc(bx + s * (rx + 6), by + 18 + swing, 6.5, 0, 7);
    fillStroke(ctx, tone(d.pal[2], 0), out, 2.4);
  }
  // head
  blobPath(ctx, hx, hy, hr, hr, 0.07, rng, 12);
  fillStroke(ctx, bodyGradient(ctx, hx, hy, hr, hr, c), out, 3.4);
  drawEars(ctx, d, hx, hy, hr, t, out);
  if (!back) {
    drawEyes(ctx, d, hx, hy - 2, 8, 1, blink, false);
    drawMouth(ctx, d, hx, hy + 9, 12, 1, mouthOpen);
  }
}

function drawSerpent(ctx, d, t, back, out, rng, breathe, blink, mouthOpen) {
  const c = d.pal[0];
  const wave = Math.sin(t * 1.6);
  // coiled body: a chain of shrinking circles along an S curve
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const p = i / 12;
    pts.push([
      -26 + p * 46 + Math.sin(p * 4 + wave) * 10,
      44 - p * 58 + Math.cos(p * 3.2 + wave * 0.8) * 6,
    ]);
  }
  drawTail(ctx, d, pts[0][0], pts[0][1], t, out, 0.9);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.lineWidth = 30; ctx.strokeStyle = out; ctx.stroke();
  ctx.lineWidth = 24;
  const g = ctx.createLinearGradient(-30, 40, 30, -40);
  g.addColorStop(0, tone(c, -12)); g.addColorStop(0.5, tone(c, +8)); g.addColorStop(1, tone(c, -4));
  ctx.strokeStyle = g; ctx.stroke();
  ctx.lineWidth = 9; ctx.strokeStyle = tone(d.pal[1], +6, -6, 0.55); ctx.stroke();

  const hx = pts[12][0] + 6, hy = pts[12][1] - 6, hr = 18;
  if (d.wings) drawWings(ctx, d, hx - 14, hy + 16, 15, t, out, true);
  blobPath(ctx, hx, hy, hr * 1.1, hr * 0.9, 0.06, rng, 12);
  fillStroke(ctx, bodyGradient(ctx, hx, hy, hr, hr, c), out, 3.2);
  drawEars(ctx, d, hx, hy, hr, t, out);
  if (!back) {
    drawEyes(ctx, d, hx + 2, hy - 2, 8, 1, blink, true);
    drawMouth(ctx, d, hx + 6, hy + 9, 12, 1, mouthOpen);
  }
}

function drawAvian(ctx, d, t, back, out, rng, breathe, blink, mouthOpen) {
  const c = d.pal[0], belly = d.pal[1];
  const bx = 0, by = 6 + breathe * 2;
  const rx = 22, ry = 26;
  drawWings(ctx, d, bx, by - 6, 17, t, out, true);
  drawTail(ctx, d, bx - 6, by + ry * 0.75, t, out);
  for (const s of [-1, 1]) {
    limbPath(ctx, bx + s * 7, by + ry * 0.7, bx + s * 8, by + ry * 0.95, bx + s * 8, 45, 3.4, 2.8);
    fillStroke(ctx, tone(d.pal[2], -6), out, 2.2);
    ctx.beginPath();
    ctx.moveTo(bx + s * 8 - 6, 46); ctx.lineTo(bx + s * 8 + 6, 46);
    ctx.lineWidth = 3; ctx.strokeStyle = tone(d.pal[2], -6); ctx.lineCap = 'round'; ctx.stroke();
  }
  blobPath(ctx, bx, by, rx, ry, 0.07, rng, 12);
  fillStroke(ctx, bodyGradient(ctx, bx, by, rx, ry, c), out, 3.4);
  ctx.beginPath(); ctx.ellipse(bx, by + 6, rx * 0.6, ry * 0.6, 0, 0, 7);
  ctx.fillStyle = tone(belly, +8, -8, 0.75); ctx.fill();
  drawMarkings(ctx, d, bx, by, rx, ry, rng);
  drawWings(ctx, d, bx, by - 6, 17, t + 0.02, out, false);
  const hx = 4, hy = -26 + breathe * 2, hr = 16;
  blobPath(ctx, hx, hy, hr, hr, 0.06, rng, 12);
  fillStroke(ctx, bodyGradient(ctx, hx, hy, hr, hr, c), out, 3.2);
  drawEars(ctx, d, hx, hy, hr, t, out);
  if (!back) {
    ctx.beginPath();
    ctx.moveTo(hx + 10, hy + 1); ctx.lineTo(hx + 26, hy + 5 + mouthOpen * 4); ctx.lineTo(hx + 10, hy + 9);
    ctx.closePath();
    fillStroke(ctx, tone(d.pal[2], +6), out, 2.4);
    drawEyes(ctx, d, hx, hy - 2, 7, 0.95, blink, false);
  }
}

function drawInsect(ctx, d, t, back, out, rng, breathe, blink, mouthOpen) {
  const c = d.pal[0];
  const hover = Math.sin(t * 3) * 3;
  const bx = 0, by = 10 + hover;
  if (d.wings) drawWings(ctx, d, bx, by - 14, 19, t * 1.9, out, true);
  // abdomen segments
  for (let i = 3; i >= 0; i--) {
    const seg = 1 - i * 0.14;
    ctx.beginPath();
    ctx.ellipse(bx - 4 - i * 3, by + i * 9, 15 * seg, 12 * seg, 0, 0, 7);
    fillStroke(ctx, bodyGradient(ctx, bx, by + i * 9, 15, 12, i % 2 ? d.pal[1] : c), out, 2.6);
  }
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const a = -0.5 + i * 0.5;
      limbPath(ctx, bx + s * 8, by + i * 6 - 2, bx + s * 20, by + i * 7 + 4,
        bx + s * 26, by + i * 8 + 14 + Math.sin(t * 3 + i) * 2, 2.6, 1.8);
      fillStroke(ctx, tone(c, -18), out, 1.8);
    }
  }
  const hx = 6, hy = -20 + hover, hr = 15;
  blobPath(ctx, hx, hy, hr, hr * 0.95, 0.06, rng, 12);
  fillStroke(ctx, bodyGradient(ctx, hx, hy, hr, hr, c), out, 3);
  drawEars(ctx, d, hx, hy, hr, t, out);
  if (!back) {
    drawEyes(ctx, d, hx, hy - 1, 7.5, 1, blink, false);
    drawMouth(ctx, d, hx, hy + 9, 8, 1, mouthOpen);
  }
  if (d.wings) drawWings(ctx, d, bx, by - 14, 15, t * 1.9 + 0.4, out, false);
}

function drawAquatic(ctx, d, t, back, out, rng, breathe, blink, mouthOpen) {
  const c = d.pal[0], belly = d.pal[1];
  const bob = Math.sin(t * 2.2) * 3;
  const bx = 0, by = 8 + bob;
  const rx = 26, ry = 28;
  drawTail(ctx, d, bx - rx * 0.85, by + 6, t, out);
  // dorsal fin
  ctx.beginPath();
  ctx.moveTo(bx - 4, by - ry * 0.85);
  ctx.quadraticCurveTo(bx + 4, by - ry * 1.5, bx + 14, by - ry * 0.7);
  ctx.closePath();
  fillStroke(ctx, tone(d.pal[2], +6, 0, 0.92), out, 2.4);
  blobPath(ctx, bx, by, rx, ry, 0.07, rng, 12);
  fillStroke(ctx, bodyGradient(ctx, bx, by, rx, ry, c), out, 3.4);
  ctx.beginPath(); ctx.ellipse(bx + 2, by + ry * 0.28, rx * 0.62, ry * 0.55, 0, 0, 7);
  ctx.fillStyle = tone(belly, +8, -6, 0.72); ctx.fill();
  drawMarkings(ctx, d, bx, by, rx, ry, rng);
  // side fins
  for (const s of [-1, 1]) {
    ctx.save(); ctx.translate(bx + s * rx * 0.75, by + 4); ctx.rotate(s * (0.4 + Math.sin(t * 3) * 0.15));
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.quadraticCurveTo(s * 18, 2, 0, 12); ctx.closePath();
    fillStroke(ctx, tone(d.pal[2], +4, 0, 0.9), out, 2.2);
    ctx.restore();
  }
  drawEars(ctx, d, bx, by - ry * 0.6, 16, t, out);
  if (!back) {
    drawEyes(ctx, d, bx + 2, by - ry * 0.35, 9, 1, blink, false);
    drawMouth(ctx, d, bx + 4, by - ry * 0.02, 12, 1, mouthOpen);
  }
}

function drawGolem(ctx, d, t, back, out, rng, breathe, blink, mouthOpen) {
  const c = d.pal[0];
  const by = 8 + breathe * 1.2;
  const chunk = (x, y, w, h, rot, col) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.beginPath();
    const r = Math.min(w, h) * 0.22;
    ctx.moveTo(-w + r, -h);
    ctx.arcTo(w, -h, w, h, r); ctx.arcTo(w, h, -w, h, r);
    ctx.arcTo(-w, h, -w, -h, r); ctx.arcTo(-w, -h, w, -h, r);
    ctx.closePath();
    fillStroke(ctx, bodyGradient(ctx, 0, 0, w, h, col), out, 3);
    ctx.restore();
  };
  chunk(-22, by + 22, 10, 8, -0.12, [c[0], c[1], c[2] - 10]);
  chunk(22, by + 22, 10, 8, 0.12, [c[0], c[1], c[2] - 10]);
  chunk(0, by, 28, 24, 0.03, c);
  drawMarkings(ctx, d, 0, by, 26, 22, rng);
  chunk(-30, by - 4, 9, 12, -0.3, d.pal[1]);
  chunk(30, by - 4, 9, 12, 0.3, d.pal[1]);
  chunk(0, by - 30, 18, 14, -0.02, [c[0], c[1], c[2] + 4]);
  drawEars(ctx, d, 0, by - 30, 16, t, out);
  if (!back) {
    drawEyes(ctx, d, 0, by - 31, 8, 0.95, blink, true);
    drawMouth(ctx, d, 0, by - 21, 12, 1, mouthOpen);
  }
}

function drawSpirit(ctx, d, t, back, out, rng, breathe, blink, mouthOpen) {
  const c = d.pal[0];
  const bob = Math.sin(t * 1.8) * 4;
  const cx = 0, cy = -4 + bob, rx = 26, ry = 26;
  if (d.wings) drawWings(ctx, d, cx, cy, 18, t * 1.4, out, true);
  drawTail(ctx, d, cx - 6, cy + ry * 0.7, t, out);
  // wispy skirt
  ctx.beginPath();
  ctx.moveTo(cx - rx, cy + 4);
  ctx.quadraticCurveTo(cx - rx * 0.6, cy + ry * 1.5, cx - rx * 0.3, cy + ry * 1.1 + Math.sin(t * 3) * 3);
  ctx.quadraticCurveTo(cx, cy + ry * 1.7, cx + rx * 0.3, cy + ry * 1.1 + Math.sin(t * 3 + 2) * 3);
  ctx.quadraticCurveTo(cx + rx * 0.7, cy + ry * 1.5, cx + rx, cy + 4);
  ctx.closePath();
  fillStroke(ctx, bodyGradient(ctx, cx, cy + ry, rx, ry, c), out, 3);
  blobPath(ctx, cx, cy, rx, ry, 0.09, rng, 12);
  fillStroke(ctx, bodyGradient(ctx, cx, cy, rx, ry, c), out, 3.4);
  drawMarkings(ctx, d, cx, cy, rx, ry, rng);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35;
  const gg = ctx.createRadialGradient(cx, cy, 2, cx, cy, rx * 1.7);
  gg.addColorStop(0, tone(d.pal[2], +20)); gg.addColorStop(1, tone(d.pal[2], 0, 0, 0));
  ctx.fillStyle = gg;
  ctx.beginPath(); ctx.arc(cx, cy, rx * 1.7, 0, 7); ctx.fill();
  ctx.restore();
  drawEars(ctx, d, cx, cy, 20, t, out);
  if (!back) {
    drawEyes(ctx, d, cx, cy - 3, 9, 1.05, blink, false);
    drawMouth(ctx, d, cx, cy + 10, 11, 1, mouthOpen);
  }
  if (d.wings) drawWings(ctx, d, cx, cy, 15, t * 1.4 + 0.3, out, false);
}

const LAYOUTS = {
  quad: drawQuad, biped: drawBiped, serpent: drawSerpent, avian: drawAvian,
  insect: drawInsect, aquatic: drawAquatic, golem: drawGolem, spirit: drawSpirit,
};

// ------------------------------------------------------------------- API ---
/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} speciesId
 * @param {number} x  centre x on screen
 * @param {number} y  ground line (feet) on screen
 * @param {number} size  pixel height of the 100-unit box
 * @param {object} o  { t, back, alpha, flash, shake, squash, shadow, faint }
 */
export function drawMonster(ctx, speciesId, x, y, size, o = {}) {
  const sp = getSpecies(speciesId);
  if (!sp) return;
  const d = sp.design;
  const t = o.t ?? 0;
  const back = !!o.back;
  const alpha = o.alpha ?? 1;
  const scale = (size / 100) * (d.size ?? 1) * (o.scale ?? 1);
  const rng = makeRng(hashStr(speciesId) ^ 0x9e37);
  const out = outlineOf(d.pal[0]);

  const breathe = Math.sin(t * 1.7) * 0.5 + 0.5;
  const blinkPhase = (t * 0.45 + (sp.dex % 7) * 0.13) % 1;
  const blink = blinkPhase > 0.965 ? 1 : 0;
  const mouthOpen = o.mouthOpen ?? 0;

  ctx.save();
  ctx.globalAlpha = alpha;
  if (o.shake) ctx.translate((Math.random() - 0.5) * o.shake, (Math.random() - 0.5) * o.shake);

  // ground shadow
  if (o.shadow !== false) {
    ctx.save();
    ctx.globalAlpha = alpha * 0.3;
    const sw = 34 * scale, sh = 9 * scale;
    const sg = ctx.createRadialGradient(x, y, 0, x, y, sw);
    sg.addColorStop(0, 'rgba(0,0,0,.75)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.ellipse(x, y, sw, sh, 0, 0, 7); ctx.fill();
    ctx.restore();
  }

  const paint = (g) => {
    g.save();
    g.scale(scale * (back ? -1 : 1), scale);
    if (o.squash) g.transform(1 / o.squash, 0, 0, o.squash, 0, 0);
    g.translate(0, -46);
    drawAura(g, d, t, true);
    (LAYOUTS[d.body] || drawQuad)(g, d, t, back, out, rng, breathe, blink, mouthOpen);
    drawAura(g, d, t, false);
    g.restore();
  };

  if (o.flash > 0.01) {
    // Draw into an isolated buffer, tint it, then blit — keeps the flash on
    // the creature's own pixels.
    const box = Math.ceil(220 * scale) + 8;
    const g = getScratch(box);
    g.save();
    g.translate(box / 2, box * 0.72);
    paint(g);
    g.restore();
    g.save();
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = Math.min(1, o.flash);
    g.fillStyle = o.flashColor || '#fff';
    g.fillRect(0, 0, box, box);
    g.restore();
    ctx.drawImage(scratch, 0, 0, box, box, x - box / 2, y - box * 0.72, box, box);
  } else {
    ctx.translate(x, y);
    paint(ctx);
  }
  ctx.restore();
}

/** Compact portrait for menus / party lists — head-and-shoulders framing.
 *  `silhouette` blanks the creature out for catalogue entries not yet caught. */
export function drawMonsterIcon(ctx, speciesId, x, y, size, t = 0, silhouette = false) {
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, size / 2, 0, 7); ctx.clip();
  const sp = getSpecies(speciesId);
  const g = ctx.createLinearGradient(x - size / 2, y - size / 2, x + size / 2, y + size / 2);
  const h = sp ? sp.design.pal[0][0] : 200;
  g.addColorStop(0, hsl(h, 40, 26)); g.addColorStop(1, hsl(h, 45, 14));
  ctx.fillStyle = g; ctx.fillRect(x - size, y - size, size * 2, size * 2);
  drawMonster(ctx, speciesId, x, y + size * 0.42, size * 1.15, {
    t, shadow: false,
    flash: silhouette ? 1 : 0, flashColor: '#0f1626',
  });
  ctx.restore();
  ctx.beginPath(); ctx.arc(x, y, size / 2, 0, 7);
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.stroke();
}
