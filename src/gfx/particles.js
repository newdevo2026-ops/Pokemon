// A tiny pooled particle system shared by the overworld and battle scenes.

import { clamp } from '../core/util.js';

export class Particles {
  constructor(max = 420) {
    this.pool = [];
    this.max = max;
  }

  spawn(o) {
    if (this.pool.length >= this.max) this.pool.shift();
    this.pool.push({
      x: o.x, y: o.y,
      vx: o.vx ?? 0, vy: o.vy ?? 0,
      ax: o.ax ?? 0, ay: o.ay ?? 0,
      life: 0, ttl: o.ttl ?? 0.6,
      size: o.size ?? 4, size2: o.size2 ?? 0,
      color: o.color ?? '#fff',
      shape: o.shape ?? 'circle',
      rot: o.rot ?? 0, spin: o.spin ?? 0,
      glow: o.glow ?? false,
      fade: o.fade ?? true,
    });
  }

  burst(x, y, n, o = {}) {
    for (let i = 0; i < n; i++) {
      const a = o.angle != null ? o.angle + (Math.random() - 0.5) * (o.spread ?? 6.28) : Math.random() * 6.28;
      const sp = (o.speed ?? 120) * (0.4 + Math.random() * 0.9);
      this.spawn({
        ...o, x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        rot: Math.random() * 6.28,
        spin: (Math.random() - 0.5) * 8,
        ttl: (o.ttl ?? 0.6) * (0.7 + Math.random() * 0.6),
        size: (o.size ?? 4) * (0.6 + Math.random() * 0.8),
      });
    }
  }

  update(dt) {
    for (let i = this.pool.length - 1; i >= 0; i--) {
      const p = this.pool[i];
      p.life += dt;
      if (p.life >= p.ttl) { this.pool.splice(i, 1); continue; }
      p.vx += p.ax * dt; p.vy += p.ay * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }
  }

  draw(ctx, ox = 0, oy = 0) {
    ctx.save();
    for (const p of this.pool) {
      const k = p.life / p.ttl;
      ctx.globalAlpha = p.fade ? clamp(1 - k, 0, 1) : 1;
      if (p.glow) ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;
      const s = p.size + (p.size2 - p.size) * k;
      const x = p.x - ox, y = p.y - oy;
      switch (p.shape) {
        case 'square':
          ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot);
          ctx.fillRect(-s / 2, -s / 2, s, s); ctx.restore(); break;
        case 'leaf':
          ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot);
          ctx.beginPath(); ctx.ellipse(0, 0, s * 1.6, s * 0.7, 0, 0, 7); ctx.fill();
          ctx.restore(); break;
        case 'star': {
          ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot);
          ctx.beginPath();
          for (let i = 0; i < 5; i++) {
            const a1 = (i / 5) * 6.28 - 1.57, a2 = a1 + 0.628;
            ctx.lineTo(Math.cos(a1) * s * 1.6, Math.sin(a1) * s * 1.6);
            ctx.lineTo(Math.cos(a2) * s * 0.7, Math.sin(a2) * s * 0.7);
          }
          ctx.closePath(); ctx.fill(); ctx.restore(); break;
        }
        case 'line':
          ctx.lineWidth = Math.max(1, s * 0.5); ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - p.vx * 0.03, y - p.vy * 0.03);
          ctx.stroke(); break;
        case 'ring':
          ctx.lineWidth = Math.max(1, s * 0.25);
          ctx.beginPath(); ctx.arc(x, y, s * 2, 0, 7); ctx.stroke(); break;
        default:
          ctx.beginPath(); ctx.arc(x, y, s, 0, 7); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }

  clear() { this.pool.length = 0; }
}
