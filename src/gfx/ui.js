// Shared UI kit: glassy panels, RTL-aware text, animated bars, menu cursors.

export const FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';

export function font(size, weight = 700) { return `${weight} ${size}px ${FONT}`; }

/** Rounded panel with border, inner sheen and drop shadow. */
export function panel(ctx, x, y, w, h, o = {}) {
  const r = o.radius ?? 14;
  ctx.save();
  if (o.shadow !== false) {
    ctx.shadowColor = 'rgba(0,0,0,.55)';
    ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
  }
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  const g = ctx.createLinearGradient(x, y, x, y + h);
  const [c1, c2] = o.colors || ['rgba(24,33,54,.96)', 'rgba(12,18,32,.97)'];
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  ctx.fillStyle = g; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = o.borderWidth ?? 2;
  ctx.strokeStyle = o.border || 'rgba(140,190,240,.35)';
  ctx.stroke();
  // top sheen
  ctx.save();
  ctx.beginPath(); ctx.roundRect(x + 2, y + 2, w - 4, h * 0.42, r - 2); ctx.clip();
  const sg = ctx.createLinearGradient(x, y, x, y + h * 0.45);
  sg.addColorStop(0, 'rgba(255,255,255,.10)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sg; ctx.fillRect(x, y, w, h * 0.45);
  ctx.restore();
  ctx.restore();
}

export function drawText(ctx, text, x, y, o = {}) {
  ctx.save();
  ctx.font = font(o.size ?? 20, o.weight ?? 700);
  ctx.textAlign = o.align ?? 'right';
  ctx.textBaseline = o.baseline ?? 'alphabetic';
  ctx.direction = o.dir ?? 'rtl';
  if (o.shadow !== false) {
    ctx.fillStyle = o.shadowColor ?? 'rgba(0,0,0,.6)';
    ctx.fillText(text, x + (o.shadowX ?? 0), y + (o.shadowY ?? 2));
  }
  if (o.stroke) {
    ctx.lineWidth = o.strokeWidth ?? 4;
    ctx.strokeStyle = o.stroke; ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = o.color ?? '#eef4ff';
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Digits, fractions and stat readouts: forced LTR so bidi cannot reorder
 *  "25 / 33" into "33 / 25" inside an RTL run. */
export function drawNum(ctx, text, x, y, o = {}) {
  drawText(ctx, text, x, y, { ...o, dir: 'ltr' });
}

/** Largest size (down to `min`) at which `text` fits in `maxWidth`. */
export function fitSize(ctx, text, maxWidth, size, min = 13) {
  let s = size;
  while (s > min && measure(ctx, text, s) > maxWidth) s -= 1;
  return s;
}

export function measure(ctx, text, size = 20, weight = 700) {
  ctx.save(); ctx.font = font(size, weight);
  const w = ctx.measureText(text).width;
  ctx.restore();
  return w;
}

/** Greedy word wrap that respects the canvas font metrics. */
export function wrapText(ctx, text, maxWidth, size = 20) {
  ctx.save(); ctx.font = font(size);
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  ctx.restore();
  return lines;
}

export function bar(ctx, x, y, w, h, ratio, o = {}) {
  const r = h / 2;
  ctx.save();
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = o.track ?? 'rgba(6,10,20,.85)'; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.stroke();
  const fw = Math.max(0, Math.min(1, ratio)) * (w - 4);
  if (fw > 1) {
    ctx.beginPath(); ctx.roundRect(x + 2, y + 2, fw, h - 4, Math.max(1, r - 2));
    const g = ctx.createLinearGradient(x, y, x, y + h);
    const [a, b] = o.colors || ['#7ef0a8', '#2ba463'];
    g.addColorStop(0, a); g.addColorStop(1, b);
    ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); ctx.roundRect(x + 3, y + 3, Math.max(0, fw - 2), (h - 6) * 0.42, r - 3);
    ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fill();
  }
  ctx.restore();
}

export function hpColors(ratio) {
  if (ratio > 0.5) return ['#8ef2ae', '#2fa864'];
  if (ratio > 0.2) return ['#f7dc7a', '#d19a1e'];
  return ['#f79a8a', '#c93a35'];
}

/** Selection highlight used by every list menu in the game. */
export function selection(ctx, x, y, w, h, t, accent = '#6fd8e8') {
  const pulse = 0.55 + Math.sin(t * 6) * 0.18;
  ctx.save();
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 10);
  ctx.fillStyle = `rgba(110,200,235,${0.14 + pulse * 0.1})`; ctx.fill();
  ctx.lineWidth = 2.2; ctx.strokeStyle = accent; ctx.globalAlpha = pulse; ctx.stroke();
  ctx.restore();
}

export function chip(ctx, label, x, y, color, o = {}) {
  const size = o.size ?? 14;
  const padX = o.padX ?? 9;
  const w = measure(ctx, label, size) + padX * 2;
  const h = o.h ?? size + 9;
  ctx.save();
  ctx.beginPath(); ctx.roundRect(x - (o.align === 'left' ? 0 : w), y, w, h, h / 2);
  ctx.fillStyle = color; ctx.fill();
  ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.stroke();
  ctx.restore();
  drawText(ctx, label, x - (o.align === 'left' ? -w + padX : padX), y + h / 2 + size * 0.36,
    { size, color: o.textColor ?? '#12161f', align: 'right', shadow: false });
  return w;
}

/** Blinking "press A to continue" arrow. */
export function advanceArrow(ctx, x, y, t) {
  const bob = Math.sin(t * 6) * 3;
  ctx.save();
  ctx.globalAlpha = 0.55 + Math.sin(t * 6) * 0.35;
  ctx.fillStyle = '#8fe8ff';
  ctx.beginPath();
  ctx.moveTo(x - 8, y + bob); ctx.lineTo(x + 8, y + bob); ctx.lineTo(x, y + 9 + bob);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

export function vignette(ctx, w, h, strength = 0.45) {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}
