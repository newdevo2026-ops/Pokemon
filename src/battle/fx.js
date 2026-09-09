// Move animations.  Each entry returns a short-lived effect object with its own
// update/draw, plus particles emitted into the scene's shared system.

import { typeColor } from '../data/types.js';
import { hsl, lerp, clamp } from '../core/util.js';

function base(dur) { return { t: 0, dur, done: false }; }

const NOOP = { update() {}, draw() {} };

/**
 * @param name  fx id from data/moves.js
 * @param from  {x,y} attacker anchor
 * @param to    {x,y} defender anchor
 * @param P     Particles instance
 * @param type  elemental type id (for colouring)
 */
export function createFx(name, from, to, P, type = 'neutral') {
  const col = typeColor(type);
  const dx = to.x - from.x, dy = to.y - from.y;
  const ang = Math.atan2(dy, dx);

  switch (name) {
    case 'impact': {
      const e = { ...base(0.42) };
      e.update = (dt) => {
        e.t += dt;
        if (e.t < 0.06) return;
        if (!e.fired) {
          e.fired = true;
          P.burst(to.x, to.y, 18, { color: col, speed: 260, ttl: 0.35, size: 5, glow: true });
          P.burst(to.x, to.y, 8, { color: '#fff', speed: 180, ttl: 0.25, size: 3, glow: true });
        }
      };
      e.draw = (ctx) => {
        const k = clamp(e.t / e.dur, 0, 1);
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 6 * (1 - k);
        ctx.beginPath(); ctx.arc(to.x, to.y, 10 + k * 70, 0, 7); ctx.stroke();
        ctx.restore();
      };
      return e;
    }

    case 'slash': {
      const e = { ...base(0.4) };
      e.update = (dt) => {
        e.t += dt;
        if (!e.fired && e.t > 0.1) {
          e.fired = true;
          P.burst(to.x, to.y, 14, { color: col, speed: 220, ttl: 0.3, size: 4, shape: 'line', glow: true });
        }
      };
      e.draw = (ctx) => {
        const k = clamp(e.t / e.dur, 0, 1);
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 3; i++) {
          const kk = clamp((k - i * 0.12) * 3, 0, 1);
          if (kk <= 0) continue;
          ctx.globalAlpha = (1 - kk) * 0.95;
          ctx.strokeStyle = i === 1 ? '#fff' : col;
          ctx.lineWidth = 8 - i * 2; ctx.lineCap = 'round';
          const o = (i - 1) * 24;
          ctx.beginPath();
          ctx.moveTo(to.x - 60 + o, to.y - 55 + o + kk * 20);
          ctx.lineTo(to.x + 55 + o, to.y + 50 + o + kk * 20);
          ctx.stroke();
        }
        ctx.restore();
      };
      return e;
    }

    case 'bite': {
      const e = { ...base(0.45) };
      e.update = (dt) => {
        e.t += dt;
        if (!e.fired && e.t > 0.25) {
          e.fired = true;
          P.burst(to.x, to.y, 14, { color: col, speed: 200, ttl: 0.3, size: 4, glow: true });
        }
      };
      e.draw = (ctx) => {
        const k = clamp(e.t / e.dur, 0, 1);
        const open = k < 0.5 ? 1 - k * 2 : 0;
        ctx.save();
        ctx.globalAlpha = 1 - Math.max(0, (k - 0.6) / 0.4);
        ctx.translate(to.x, to.y);
        ctx.fillStyle = '#fff'; ctx.strokeStyle = col; ctx.lineWidth = 3;
        for (const s of [-1, 1]) {
          ctx.beginPath();
          const off = s * (18 + open * 42);
          for (let i = 0; i < 5; i++) {
            ctx.moveTo(-56 + i * 28, off);
            ctx.lineTo(-42 + i * 28, off + s * 22);
            ctx.lineTo(-28 + i * 28, off);
          }
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        ctx.restore();
      };
      return e;
    }

    case 'flame': {
      const e = { ...base(0.6) };
      e.update = (dt) => {
        e.t += dt;
        const k = clamp(e.t / 0.35, 0, 1);
        const x = lerp(from.x, to.x, k), y = lerp(from.y, to.y, k);
        for (let i = 0; i < 4; i++) {
          P.spawn({
            x: x + (Math.random() - 0.5) * 28, y: y + (Math.random() - 0.5) * 28,
            vx: Math.cos(ang) * 90 + (Math.random() - 0.5) * 90,
            vy: Math.sin(ang) * 90 - 60 - Math.random() * 60,
            ttl: 0.4, size: 12, size2: 1, glow: true,
            color: hsl(10 + Math.random() * 44, 100, 55 + Math.random() * 20),
          });
        }
        if (e.t > 0.35 && !e.fired) {
          e.fired = true;
          P.burst(to.x, to.y, 26, { color: '#ffb347', speed: 300, ttl: 0.5, size: 9, glow: true });
        }
      };
      e.draw = NOOP.draw;
      return e;
    }

    case 'beam': {
      const e = { ...base(0.7) };
      e.update = (dt) => {
        e.t += dt;
        if (e.t > 0.35 && !e.fired) {
          e.fired = true;
          P.burst(to.x, to.y, 28, { color: col, speed: 330, ttl: 0.5, size: 7, glow: true });
        }
      };
      e.draw = (ctx) => {
        const k = clamp(e.t / e.dur, 0, 1);
        const reach = clamp(k * 3.4, 0, 1);
        const ex = lerp(from.x, to.x, reach), ey = lerp(from.y, to.y, reach);
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        ctx.lineCap = 'round';
        for (const [w, c] of [[26, col], [14, '#fff']]) {
          ctx.lineWidth = w * (0.7 + Math.sin(e.t * 40) * 0.15);
          ctx.strokeStyle = c;
          ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(ex, ey); ctx.stroke();
        }
        ctx.restore();
      };
      return e;
    }

    case 'shock': {
      const e = { ...base(0.5) };
      e.bolts = [];
      const makeBolt = () => {
        const pts = [[from.x, from.y]];
        const n = 8;
        for (let i = 1; i <= n; i++) {
          const k = i / n;
          pts.push([
            lerp(from.x, to.x, k) + (Math.random() - 0.5) * 60 * Math.sin(k * Math.PI),
            lerp(from.y, to.y, k) + (Math.random() - 0.5) * 60 * Math.sin(k * Math.PI),
          ]);
        }
        return pts;
      };
      e.update = (dt) => {
        e.t += dt;
        if (Math.random() < 0.7) e.bolts = [makeBolt(), makeBolt()];
        if (!e.fired && e.t > 0.2) {
          e.fired = true;
          P.burst(to.x, to.y, 20, { color: '#fff59a', speed: 320, ttl: 0.4, size: 5, shape: 'line', glow: true });
        }
      };
      e.draw = (ctx) => {
        const k = clamp(e.t / e.dur, 0, 1);
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1 - k;
        for (const b of e.bolts) {
          for (const [w, c] of [[9, col], [3.5, '#ffffff']]) {
            ctx.lineWidth = w; ctx.strokeStyle = c; ctx.lineJoin = 'round';
            ctx.beginPath(); ctx.moveTo(b[0][0], b[0][1]);
            for (let i = 1; i < b.length; i++) ctx.lineTo(b[i][0], b[i][1]);
            ctx.stroke();
          }
        }
        ctx.restore();
      };
      return e;
    }

    case 'splash':
    case 'wave': {
      const e = { ...base(0.65) };
      e.update = (dt) => {
        e.t += dt;
        const k = clamp(e.t / 0.4, 0, 1);
        const x = lerp(from.x, to.x, k), y = lerp(from.y, to.y, k) - Math.sin(k * Math.PI) * 60;
        for (let i = 0; i < 3; i++) {
          P.spawn({
            x, y, vx: (Math.random() - 0.5) * 120, vy: (Math.random() - 0.5) * 120 + 40,
            ay: 260, ttl: 0.5, size: 7, glow: true,
            color: hsl(196 + Math.random() * 20, 85, 60 + Math.random() * 25),
          });
        }
        if (e.t > 0.4 && !e.fired) {
          e.fired = true;
          P.burst(to.x, to.y, 30, { color: '#8fd8ff', speed: 300, ttl: 0.55, size: 8, ay: 300, glow: true });
        }
      };
      e.draw = (ctx) => {
        if (e.t < 0.4) return;
        const k = clamp((e.t - 0.4) / 0.25, 0, 1);
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = '#9fe4ff'; ctx.lineWidth = 6 * (1 - k);
        for (let i = 0; i < 3; i++) {
          ctx.beginPath(); ctx.arc(to.x, to.y, 20 + k * 90 + i * 18, 0, 7); ctx.stroke();
        }
        ctx.restore();
      };
      return e;
    }

    case 'leaf': {
      const e = { ...base(0.6) };
      e.update = (dt) => {
        e.t += dt;
        const k = clamp(e.t / 0.4, 0, 1);
        const x = lerp(from.x, to.x, k), y = lerp(from.y, to.y, k);
        for (let i = 0; i < 2; i++) {
          P.spawn({
            x: x + (Math.random() - 0.5) * 40, y: y + (Math.random() - 0.5) * 40,
            vx: Math.cos(ang) * 140 + (Math.random() - 0.5) * 120,
            vy: Math.sin(ang) * 140 + (Math.random() - 0.5) * 120,
            ttl: 0.55, size: 6, shape: 'leaf', spin: (Math.random() - 0.5) * 14,
            color: hsl(90 + Math.random() * 50, 65, 45 + Math.random() * 20),
          });
        }
        if (e.t > 0.4 && !e.fired) {
          e.fired = true;
          P.burst(to.x, to.y, 22, { color: '#7fd45f', speed: 280, ttl: 0.5, size: 6, shape: 'leaf' });
        }
      };
      e.draw = NOOP.draw;
      return e;
    }

    case 'ice': {
      const e = { ...base(0.55) };
      e.update = (dt) => {
        e.t += dt;
        if (!e.fired && e.t > 0.15) {
          e.fired = true;
          P.burst(to.x, to.y, 24, { color: '#bff3ff', speed: 300, ttl: 0.5, size: 6, shape: 'star', glow: true });
        }
      };
      e.draw = (ctx) => {
        const k = clamp(e.t / e.dur, 0, 1);
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (1 - k) * 0.9;
        ctx.strokeStyle = '#d8f7ff'; ctx.lineWidth = 4;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * 6.28 + k * 2;
          const r = 24 + k * 74;
          ctx.beginPath();
          ctx.moveTo(to.x + Math.cos(a) * r * 0.4, to.y + Math.sin(a) * r * 0.4);
          ctx.lineTo(to.x + Math.cos(a) * r, to.y + Math.sin(a) * r);
          ctx.stroke();
        }
        ctx.restore();
      };
      return e;
    }

    case 'rock': {
      const e = { ...base(0.65) };
      e.rocks = [];
      for (let i = 0; i < 7; i++) {
        e.rocks.push({ d: i * 0.05, s: 10 + Math.random() * 14, o: (Math.random() - 0.5) * 90, r: Math.random() * 6 });
      }
      e.update = (dt) => {
        e.t += dt;
        if (!e.fired && e.t > 0.3) {
          e.fired = true;
          P.burst(to.x, to.y, 22, { color: '#b08b5a', speed: 280, ttl: 0.5, size: 6, shape: 'square', ay: 400 });
        }
      };
      e.draw = (ctx) => {
        ctx.save();
        for (const r of e.rocks) {
          const k = clamp((e.t - r.d) / 0.35, 0, 1);
          if (k <= 0 || k >= 1) continue;
          const x = lerp(from.x, to.x, k) + r.o * (1 - k);
          const y = lerp(from.y, to.y, k) - Math.sin(k * Math.PI) * 70;
          ctx.save(); ctx.translate(x, y); ctx.rotate(r.r + k * 8);
          ctx.fillStyle = '#8a6b45'; ctx.strokeStyle = '#4e3a24'; ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(-r.s, 0); ctx.lineTo(-r.s * 0.4, -r.s); ctx.lineTo(r.s * 0.7, -r.s * 0.5);
          ctx.lineTo(r.s, r.s * 0.4); ctx.lineTo(0, r.s);
          ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.restore();
        }
        ctx.restore();
      };
      return e;
    }

    case 'quake': {
      const e = { ...base(0.8), shake: 14 };
      e.update = (dt) => {
        e.t += dt;
        if (!e.fired && e.t > 0.12) {
          e.fired = true;
          P.burst(to.x, to.y + 30, 30, { color: '#a9835a', speed: 340, ttl: 0.6, size: 8, shape: 'square', ay: 600, angle: -1.57, spread: 2.2 });
        }
      };
      e.draw = (ctx) => {
        const k = clamp(e.t / e.dur, 0, 1);
        ctx.save(); ctx.globalAlpha = (1 - k) * 0.85;
        ctx.strokeStyle = '#3a2a18'; ctx.lineWidth = 5; ctx.lineCap = 'round';
        for (let i = 0; i < 5; i++) {
          const a = -0.4 + i * 0.2;
          ctx.beginPath();
          ctx.moveTo(to.x, to.y + 34);
          let x = to.x, y = to.y + 34;
          for (let s = 0; s < 4; s++) {
            x += Math.cos(a) * 30 * k; y += Math.sin(a) * 18 * k + (Math.random() - 0.5) * 6;
            ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        ctx.restore();
      };
      return e;
    }

    case 'wind': {
      const e = { ...base(0.6) };
      e.update = (dt) => {
        e.t += dt;
        const k = clamp(e.t / 0.4, 0, 1);
        for (let i = 0; i < 3; i++) {
          P.spawn({
            x: lerp(from.x, to.x, k) + (Math.random() - 0.5) * 70,
            y: lerp(from.y, to.y, k) + (Math.random() - 0.5) * 70,
            vx: Math.cos(ang) * 260, vy: Math.sin(ang) * 260 + (Math.random() - 0.5) * 90,
            ttl: 0.35, size: 5, shape: 'line', color: 'rgba(210,240,255,.9)',
          });
        }
      };
      e.draw = (ctx) => {
        const k = clamp(e.t / e.dur, 0, 1);
        ctx.save(); ctx.globalAlpha = (1 - k) * 0.8;
        ctx.strokeStyle = '#cfeaff'; ctx.lineWidth = 4; ctx.lineCap = 'round';
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(to.x, to.y, 30 + i * 26 + k * 40, k * 8, k * 8 + 2.4);
          ctx.stroke();
        }
        ctx.restore();
      };
      return e;
    }

    case 'poison': {
      const e = { ...base(0.65) };
      e.update = (dt) => {
        e.t += dt;
        const k = clamp(e.t / 0.4, 0, 1);
        for (let i = 0; i < 3; i++) {
          P.spawn({
            x: lerp(from.x, to.x, k) + (Math.random() - 0.5) * 60,
            y: lerp(from.y, to.y, k) + (Math.random() - 0.5) * 60,
            vx: (Math.random() - 0.5) * 70, vy: -40 - Math.random() * 60,
            ttl: 0.7, size: 5, size2: 11,
            color: hsl(280 + Math.random() * 30, 65, 50 + Math.random() * 18),
          });
        }
      };
      e.draw = NOOP.draw;
      return e;
    }

    case 'shadow': {
      const e = { ...base(0.65) };
      e.update = (dt) => {
        e.t += dt;
        if (!e.fired && e.t > 0.25) {
          e.fired = true;
          P.burst(to.x, to.y, 24, { color: '#7a5fbf', speed: 260, ttl: 0.55, size: 8, glow: true });
        }
      };
      e.draw = (ctx) => {
        const k = clamp(e.t / e.dur, 0, 1);
        ctx.save();
        ctx.globalAlpha = Math.sin(k * Math.PI) * 0.9;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * 6.28 + k * 3;
          const r = 20 + k * 80;
          ctx.strokeStyle = i % 2 ? '#2a1c46' : col;
          ctx.lineWidth = 10 * (1 - k) + 2;
          ctx.beginPath();
          ctx.moveTo(to.x, to.y);
          ctx.quadraticCurveTo(
            to.x + Math.cos(a) * r * 0.6, to.y + Math.sin(a) * r * 0.6 - 30,
            to.x + Math.cos(a) * r, to.y + Math.sin(a) * r);
          ctx.stroke();
        }
        ctx.restore();
      };
      return e;
    }

    case 'sparkle':
    case 'star': {
      const e = { ...base(0.6) };
      const at = name === 'star' ? to : from;
      e.update = (dt) => {
        e.t += dt;
        for (let i = 0; i < 3; i++) {
          P.spawn({
            x: at.x + (Math.random() - 0.5) * 110, y: at.y + (Math.random() - 0.5) * 110,
            vx: (Math.random() - 0.5) * 60, vy: -60 - Math.random() * 70,
            ttl: 0.6, size: 5, shape: 'star', spin: 5, glow: true,
            color: hsl(name === 'star' ? 48 : 320, 95, 70 + Math.random() * 20),
          });
        }
        if (name === 'star' && !e.fired && e.t > 0.3) {
          e.fired = true;
          P.burst(to.x, to.y, 18, { color: '#ffe9a0', speed: 260, ttl: 0.45, size: 6, shape: 'star', glow: true });
        }
      };
      e.draw = NOOP.draw;
      return e;
    }

    case 'burst': {
      const e = { ...base(0.75), shake: 10 };
      e.update = (dt) => {
        e.t += dt;
        if (!e.fired && e.t > 0.1) {
          e.fired = true;
          P.burst(to.x, to.y, 44, { color: col, speed: 420, ttl: 0.65, size: 10, glow: true });
          P.burst(to.x, to.y, 20, { color: '#fff', speed: 300, ttl: 0.45, size: 6, glow: true });
        }
      };
      e.draw = (ctx) => {
        const k = clamp(e.t / e.dur, 0, 1);
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (1 - k) * 0.9;
        const g = ctx.createRadialGradient(to.x, to.y, 4, to.x, to.y, 40 + k * 140);
        g.addColorStop(0, '#fff'); g.addColorStop(0.4, col); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(to.x, to.y, 40 + k * 140, 0, 7); ctx.fill();
        ctx.restore();
      };
      return e;
    }

    case 'buff': {
      const e = { ...base(0.65) };
      e.update = (dt) => {
        e.t += dt;
        for (let i = 0; i < 2; i++) {
          P.spawn({
            x: from.x + (Math.random() - 0.5) * 100, y: from.y + 40,
            vx: 0, vy: -150 - Math.random() * 90,
            ttl: 0.6, size: 4, glow: true,
            color: hsl(190 + Math.random() * 80, 90, 70),
          });
        }
      };
      e.draw = (ctx) => {
        const k = clamp(e.t / e.dur, 0, 1);
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (1 - k) * 0.8;
        ctx.strokeStyle = col; ctx.lineWidth = 5;
        for (let i = 0; i < 3; i++) {
          const kk = (k + i / 3) % 1;
          ctx.beginPath();
          ctx.ellipse(from.x, from.y + 40 - kk * 130, 60 * (1 - kk * 0.5), 16 * (1 - kk * 0.5), 0, 0, 7);
          ctx.stroke();
        }
        ctx.restore();
      };
      return e;
    }

    default: {
      const e = { ...base(0.3) };
      e.update = (dt) => { e.t += dt; };
      e.draw = NOOP.draw;
      return e;
    }
  }
}
