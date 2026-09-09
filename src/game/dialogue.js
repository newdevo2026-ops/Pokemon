// Dialogue box with typewriter text, speaker portrait and inline choices.

import { panel, drawText, wrapText, advanceArrow, selection } from '../gfx/ui.js';
import { drawActorPortrait } from '../gfx/actor.js';

const W = 960, H = 640;

export class Dialogue {
  constructor(audio) {
    this.audio = audio;
    this.active = false;
    this.lines = [];
    this.index = 0;
    this.shown = 0;
    this.speaker = null;
    this.look = null;
    this.choices = null;
    this.choiceIndex = 0;
    this.onDone = null;
    this.onChoice = null;
    this.t = 0;
  }

  say(lines, o = {}) {
    this.active = true;
    this.lines = Array.isArray(lines) ? lines.slice() : [lines];
    this.index = 0;
    this.shown = 0;
    this.speaker = o.speaker ?? null;
    this.look = o.look ?? null;
    this.choices = null;
    this.onDone = o.onDone ?? null;
    this.onChoice = null;
  }

  /** Appends a choice prompt shown after the final line. */
  ask(lines, choices, onChoice, o = {}) {
    this.say(lines, o);
    this.pendingChoices = choices;
    this.onChoice = onChoice;
  }

  close() {
    this.active = false;
    this.choices = null;
    this.pendingChoices = null;
    const cb = this.onDone;
    this.onDone = null;
    if (cb) cb();
  }

  update(dt, input) {
    if (!this.active) return;
    this.t += dt;
    const line = this.lines[this.index] ?? '';

    if (this.choices) {
      const d = input.pressedDirection();
      if (d === 'up') { this.choiceIndex = (this.choiceIndex + this.choices.length - 1) % this.choices.length; this.audio.sfx('cursor'); }
      if (d === 'down') { this.choiceIndex = (this.choiceIndex + 1) % this.choices.length; this.audio.sfx('cursor'); }
      if (input.pressed('a')) {
        this.audio.sfx('select');
        const pick = this.choices[this.choiceIndex];
        const cb = this.onChoice;
        this.active = false; this.choices = null; this.onChoice = null;
        if (cb) cb(pick.value ?? this.choiceIndex, this.choiceIndex);
      } else if (input.pressed('b') && this.choices.some((c) => c.cancel)) {
        this.audio.sfx('back');
        const idx = this.choices.findIndex((c) => c.cancel);
        const cb = this.onChoice;
        this.active = false; this.choices = null; this.onChoice = null;
        if (cb) cb(this.choices?.[idx]?.value ?? idx, idx);
      }
      return;
    }

    this.shown = Math.min(line.length, this.shown + 52 * dt);
    if (input.pressed('a') || input.pressed('b')) {
      if (this.shown < line.length) { this.shown = line.length; return; }
      this.audio.sfx('cursor');
      this.index++;
      this.shown = 0;
      if (this.index >= this.lines.length) {
        if (this.pendingChoices) {
          this.index = this.lines.length - 1;
          this.shown = (this.lines[this.index] ?? '').length;
          this.choices = this.pendingChoices;
          this.pendingChoices = null;
          this.choiceIndex = 0;
        } else this.close();
      }
    }
  }

  draw(ctx) {
    if (!this.active) return;
    const x = 24, y = 470, w = 912, h = 146;
    panel(ctx, x, y, w, h, { radius: 16 });

    let textRight = x + w - 28;
    let textWidth = w - 56;
    if (this.look) {
      drawActorPortrait(ctx, this.look, x + 66, y + h / 2, 96);
      textWidth -= 118;
    }
    if (this.speaker) {
      const nx = textRight;
      panel(ctx, nx - 200, y - 26, 200, 40, {
        radius: 12, shadow: false,
        colors: ['rgba(46,86,140,.96)', 'rgba(24,44,78,.96)'],
        border: 'rgba(160,210,255,.5)',
      });
      drawText(ctx, this.speaker, nx - 16, y + 2, { size: 19, color: '#dff0ff' });
    }

    const line = this.lines[this.index] ?? '';
    const text = line.slice(0, Math.floor(this.shown));
    const rows = wrapText(ctx, text, textWidth, 22);
    rows.slice(0, 3).forEach((ln, i) => {
      drawText(ctx, ln, textRight, y + 46 + i * 34, { size: 22 });
    });

    if (this.choices) {
      // Choices sit on the left so they never cover the speaker's name tag,
      // which hangs off the right (leading) edge in RTL.
      const cw = 300, ch = 20 + this.choices.length * 44;
      const cx = x + 14, cy = y - ch - 12;
      panel(ctx, cx, cy, cw, ch, { radius: 14 });
      this.choices.forEach((c, i) => {
        const by = cy + 10 + i * 44;
        if (i === this.choiceIndex) selection(ctx, cx + 10, by, cw - 20, 40, this.t);
        drawText(ctx, c.label, cx + cw - 24, by + 28, { size: 20, color: i === this.choiceIndex ? '#fff' : '#c8dcf5' });
      });
    } else if (this.shown >= line.length) {
      advanceArrow(ctx, x + 46, y + h - 32, this.t);
    }
  }
}
