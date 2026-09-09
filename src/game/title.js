// Title screen, new-game setup (name + look) and the save/continue entry point.

import { panel, drawText, selection, vignette } from '../gfx/ui.js';
import { drawMonster } from '../gfx/monster.js';
import { drawActor } from '../gfx/actor.js';
import { SPECIES_IDS } from '../data/species.js';
import { saveSummary } from '../core/save.js';
import { formatTime } from './menus.js';
import { makeRng } from '../core/util.js';

const W = 960, H = 640;
const LEFT = '◀', RIGHT = '▶';
const LOOK_CHOICES = [
  { id: 'hero', label: 'ניר' },
  { id: 'heroine', label: 'מאיה' },
  { id: 'rival', label: 'עדן' },
  { id: 'scholar', label: 'רותם' },
];

export class TitleScreen {
  constructor(game) {
    this.game = game;
    this.audio = game.audio;
    this.t = 0;
    this.page = 'main';       // main | about | look | name
    this.cursor = 0;
    this.lookIndex = 0;
    this.name = '';
    this.summary = saveSummary();
    this.items = this.summary
      ? [{ id: 'continue', label: 'המשך מסע' }, { id: 'new', label: 'משחק חדש' }, { id: 'about', label: 'אודות' }]
      : [{ id: 'new', label: 'משחק חדש' }, { id: 'about', label: 'אודות' }];

    // drifting background creatures
    const rng = makeRng(4242);
    this.drift = [];
    for (let i = 0; i < 7; i++) {
      this.drift.push({
        species: SPECIES_IDS[Math.floor(rng() * SPECIES_IDS.length)],
        x: rng() * W, y: 260 + rng() * 300,
        s: 90 + rng() * 90, sp: 8 + rng() * 22, ph: rng() * 6.28,
      });
    }
    this._onKey = (e) => this.onKey(e);
    window.addEventListener('keydown', this._onKey);
  }

  destroy() { window.removeEventListener('keydown', this._onKey); }

  onKey(e) {
    if (this.page !== 'name') return;
    if (e.key === 'Backspace') { this.name = this.name.slice(0, -1); e.preventDefault(); return; }
    if (e.key.length === 1 && this.name.length < 10 && e.key !== ' ') this.name += e.key;
  }

  update(dt, input) {
    this.t += dt;
    for (const d of this.drift) {
      d.x += d.sp * dt;
      if (d.x > W + 140) d.x = -140;
    }
    const dir = input.pressedDirection();

    if (this.page === 'main') {
      if (dir === 'up') { this.cursor = (this.cursor + this.items.length - 1) % this.items.length; this.audio.sfx('cursor'); }
      if (dir === 'down') { this.cursor = (this.cursor + 1) % this.items.length; this.audio.sfx('cursor'); }
      if (input.pressed('a')) {
        this.audio.sfx('select');
        const id = this.items[this.cursor].id;
        if (id === 'continue') this.game.continueGame();
        else if (id === 'new') { this.page = 'look'; this.lookIndex = 0; }
        else this.page = 'about';
      }
      return;
    }
    if (this.page === 'about') {
      if (input.pressed('a') || input.pressed('b')) { this.audio.sfx('back'); this.page = 'main'; }
      return;
    }
    if (this.page === 'look') {
      if (dir === 'left') { this.lookIndex = (this.lookIndex + 1) % LOOK_CHOICES.length; this.audio.sfx('cursor'); }
      if (dir === 'right') { this.lookIndex = (this.lookIndex + LOOK_CHOICES.length - 1) % LOOK_CHOICES.length; this.audio.sfx('cursor'); }
      if (input.pressed('b')) { this.audio.sfx('back'); this.page = 'main'; }
      if (input.pressed('a')) {
        this.audio.sfx('select');
        this.name = LOOK_CHOICES[this.lookIndex].label;
        this.page = 'name';
      }
      return;
    }
    if (this.page === 'name') {
      if (input.pressed('b')) { this.audio.sfx('back'); this.page = 'look'; return; }
      if (input.pressed('a')) {
        this.audio.sfx('select');
        this.game.newGame(this.name.trim() || LOOK_CHOICES[this.lookIndex].label,
                          LOOK_CHOICES[this.lookIndex].id);
      }
    }
  }

  draw(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#101a33'); g.addColorStop(0.45, '#1d3355'); g.addColorStop(1, '#3f6a72');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    ctx.save();
    for (let i = 0; i < 90; i++) {
      const x = (i * 137.5) % W, y = (i * 71.3) % (H * 0.6);
      ctx.globalAlpha = 0.25 + 0.35 * Math.abs(Math.sin(this.t * 1.4 + i));
      ctx.fillStyle = '#dfeaff';
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.restore();

    ctx.save(); ctx.globalAlpha = 0.22;
    for (const d of this.drift) {
      drawMonster(ctx, d.species, d.x, d.y + Math.sin(this.t + d.ph) * 12, d.s, { t: this.t, shadow: false });
    }
    ctx.restore();

    ctx.fillStyle = 'rgba(20,40,44,.85)';
    ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 30) ctx.lineTo(x, H - 130 - Math.sin(x * 0.005) * 46 - Math.sin(x * 0.017) * 16);
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();

    if (this.page === 'main' || this.page === 'about') this.drawLogo(ctx);

    if (this.page === 'main') {
      const w = 320, h = this.items.length * 60 + 24;
      const x = W / 2 - w / 2, y = 360;
      panel(ctx, x, y, w, h, { radius: 16 });
      this.items.forEach((it, i) => {
        const by = y + 12 + i * 60;
        if (i === this.cursor) selection(ctx, x + 12, by, w - 24, 52, this.t);
        drawText(ctx, it.label, x + w - 28, by + 34, { size: 23, color: i === this.cursor ? '#fff' : '#c8dcf5' });
      });
      if (this.summary) {
        panel(ctx, W / 2 - 240, y + h + 16, 480, 66, { radius: 12 });
        drawText(ctx,
          `${this.summary.name} · ${this.summary.party} בצוות · ${this.summary.caught} נלכדו · ${formatTime(this.summary.playtime)}`,
          W / 2 + 220, y + h + 58, { size: 17, color: '#a8c4e8' });
      }
      drawText(ctx, 'Z / Enter — אישור · X — חזרה · Tab — תפריט · Shift — ריצה',
        W / 2 + 300, H - 24, { size: 14, color: '#7f9dc4' });
    }

    if (this.page === 'about') {
      panel(ctx, 140, 300, 680, 280, { radius: 18 });
      const lines = [
        'AURELIA — Monster Quest',
        'הרפתקת RPG בסגנון הקלאסיקות של אספנות מפלצות,',
        'עם עולם משובץ, קרבות תורות, לכידה, אימון והתפתחות —',
        'וגרפיקה מחודשת שנוצרת כולה בקוד, ללא קובצי תמונה.',
        '',
        'כל היצורים, הסוגים והמהלכים הם מקוריים.',
      ];
      lines.forEach((ln, i) => drawText(ctx, ln, 780, 350 + i * 36,
        { size: i === 0 ? 22 : 18, color: i === 0 ? '#fff' : '#c8dcf5' }));
      drawText(ctx, 'לחץ על כל מקש כדי לחזור', 780, 556, { size: 14, color: '#7f9dc4' });
    }

    if (this.page === 'look' || this.page === 'name') {
      panel(ctx, 200, 120, 560, 420, { radius: 20 });
      drawText(ctx, this.page === 'look' ? 'מי אתה?' : 'איך קוראים לך?', 720, 176, { size: 26 });
      const look = LOOK_CHOICES[this.lookIndex];
      drawActor(ctx, look.id, 480, 400, 'down', (this.t * 2) % 1, 4);
      if (this.page === 'look') {
        drawText(ctx, LEFT, 620, 340, { size: 34, color: '#8fd8ff' });
        drawText(ctx, RIGHT, 340, 340, { size: 34, color: '#8fd8ff' });
        drawText(ctx, look.label, 720, 470, { size: 24 });
        drawText(ctx, `${LEFT} ${RIGHT} להחלפה · Z לאישור`, 720, 508, { size: 15, color: '#7f9dc4' });
      } else {
        const boxW = 360;
        panel(ctx, 480 - boxW / 2, 440, boxW, 56, {
          radius: 12, shadow: false, colors: ['rgba(12,20,36,.95)', 'rgba(8,14,26,.96)'],
        });
        const shown = this.name + (Math.floor(this.t * 2) % 2 ? '|' : '');
        drawText(ctx, shown.trim() ? shown : 'הקלד שם…', 480 + boxW / 2 - 20, 478,
          { size: 24, color: this.name ? '#fff' : '#5b76a0' });
        drawText(ctx, 'הקלד · Enter לאישור · X לחזרה', 720, 522, { size: 15, color: '#7f9dc4' });
      }
    }

    vignette(ctx, W, H, 0.55);
  }

  drawLogo(ctx) {
    const cx = W / 2, cy = 190;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '800 92px "Trebuchet MS", system-ui, sans-serif';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(120,220,255,.65)';
    ctx.shadowBlur = 18 + Math.sin(this.t * 2) * 6;
    ctx.lineWidth = 12; ctx.strokeStyle = '#0d1a2c';
    ctx.strokeText('AURELIA', cx, cy);
    const g = ctx.createLinearGradient(0, cy - 50, 0, cy + 50);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, '#8fd8ff'); g.addColorStop(1, '#2c6ea8');
    ctx.shadowBlur = 0;
    ctx.fillStyle = g; ctx.fillText('AURELIA', cx, cy);
    ctx.font = '700 22px "Trebuchet MS", system-ui, sans-serif';
    ctx.fillStyle = '#a9cbe8';
    ctx.fillText('M O N S T E R   Q U E S T', cx, cy + 68);
    ctx.restore();
  }
}
