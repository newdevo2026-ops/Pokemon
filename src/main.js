// Entry point: canvas setup, the fixed-step loop and the scene switchboard.

import { Input } from './core/input.js';
import { AudioEngine } from './core/audio.js';
import { GameState, newGame } from './game/state.js';
import { saveGame, loadGame } from './core/save.js';
import { Dialogue } from './game/dialogue.js';
import { MenuSystem } from './game/menus.js';
import { TitleScreen } from './game/title.js';
import { Overworld } from './world/overworld.js';
import { BattleScene } from './battle/scene.js';
import { clamp, hsl } from './core/util.js';

const W = 960, H = 640;

class Transition {
  constructor(kind, onMid, onEnd) {
    this.kind = kind;
    this.t = 0;
    this.dur = kind === 'battle' ? 1.05 : 0.7;
    this.mid = kind === 'battle' ? 0.52 : 0.5;
    this.onMid = onMid;
    this.onEnd = onEnd;
    this.switched = false;
    this.done = false;
  }
  update(dt) {
    this.t += dt;
    const k = this.t / this.dur;
    if (!this.switched && k >= this.mid) { this.switched = true; this.onMid?.(); }
    if (k >= 1 && !this.done) { this.done = true; this.onEnd?.(); }
  }
  draw(ctx) {
    const k = clamp(this.t / this.dur, 0, 1);
    if (this.kind === 'fade') {
      const a = k < 0.5 ? k * 2 : (1 - k) * 2;
      ctx.fillStyle = `rgba(0,0,0,${a})`;
      ctx.fillRect(0, 0, W, H);
      return;
    }
    // battle: rotating wedges close in, flash, then open up
    const closing = k < this.mid;
    const p = closing ? k / this.mid : 1 - (k - this.mid) / (1 - this.mid);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(this.t * 3.2);
    const R = 760;
    const wedges = 12;
    for (let i = 0; i < wedges; i++) {
      const a0 = (i / wedges) * Math.PI * 2;
      const a1 = a0 + (Math.PI * 2 / wedges) * clamp(p * 1.25, 0, 1);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R, a0, a1);
      ctx.closePath();
      ctx.fillStyle = i % 2 ? '#0b1020' : hsl(206, 60, 12 + (i % 3) * 4);
      ctx.fill();
    }
    ctx.restore();
    if (p > 0.92) {
      ctx.fillStyle = '#05070e'; ctx.fillRect(0, 0, W, H);
    }
    if (Math.abs(k - this.mid) < 0.06) {
      ctx.fillStyle = `rgba(255,255,255,${1 - Math.abs(k - this.mid) / 0.06})`;
      ctx.fillRect(0, 0, W, H);
    }
  }
}

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.input = new Input();
    this.audio = new AudioEngine();
    this.state = new GameState(newGame());
    this.dialogue = new Dialogue(this.audio);
    this.menus = new MenuSystem(this);
    this.scene = null;
    this.overworld = null;
    this.battle = null;
    this.transition = null;
    this.last = performance.now();
    this.acc = 0;

    this.title = new TitleScreen(this);
    this.scene = this.title;
    this.audio.play('town');

    this.fit();
    window.addEventListener('resize', () => this.fit());
    const unlock = () => this.audio.unlock();
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') {
        const muted = this.audio.toggleMute();
        this.menus.say(muted ? 'הצליל הושתק' : 'הצליל פועל');
      }
    });

    // Debug handle: lets you poke at state from the console (and lets the
    // browser tests drive the game directly).
    window.__game = this;
    requestAnimationFrame(() => this.loop());
  }

  fit() {
    const pad = 20;
    const availW = window.innerWidth - pad;
    const availH = window.innerHeight - pad - (window.matchMedia('(pointer: coarse)').matches ? 170 : 0);
    const scale = Math.max(0.3, Math.min(availW / W, availH / H));
    this.canvas.style.width = `${Math.floor(W * scale)}px`;
    this.canvas.style.height = `${Math.floor(H * scale)}px`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvas.width !== W * dpr) {
      this.canvas.width = W * dpr;
      this.canvas.height = H * dpr;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ------------------------------------------------------------ flow ----
  newGame(name, look) {
    this.state = new GameState(newGame(name, look));
    this.menus = new MenuSystem(this);
    this.startWorld(true);
  }

  continueGame() {
    const data = loadGame();
    if (!data) return;
    this.state = new GameState(data);
    this.menus = new MenuSystem(this);
    this.startWorld(false);
  }

  startWorld(isNew) {
    this.transition = new Transition('fade', () => {
      this.title?.destroy?.();
      this.title = null;
      this.overworld = new Overworld(this);
      this.scene = this.overworld;
      if (isNew) {
        this.dialogue.say([
          'היום אתה יוצא למסע.',
          'בחוץ מחכה עולם מלא ביצורים — תפוס אותם, אמן אותם, וגלה מה מסתתר בפסגה.',
          'רדת במדרגות וצא מהבית כדי להתחיל.',
        ]);
      }
    }, () => { this.transition = null; });
  }

  save() {
    const p = this.overworld;
    if (p) {
      this.state.data.player.map = p.map.id;
      this.state.data.player.x = p.player.x;
      this.state.data.player.y = p.player.y;
      this.state.data.player.dir = p.player.dir;
    }
    return saveGame(this.state.data);
  }

  startBattle(o) {
    const music = o.kind === 'trainer' ? 'battle' : 'battle';
    this.transition = new Transition('battle', () => {
      this.audio.play(music);
      this.battle = new BattleScene({
        game: this,
        party: this.state.party,
        foeParty: o.foeParty,
        kind: o.kind,
        trainer: o.trainer,
        terrain: o.terrain,
        onEnd: (result) => this.endBattle(result),
      });
      this.scene = this.battle;
    }, () => { this.transition = null; });
  }

  endBattle(result) {
    this.transition = new Transition('fade', () => {
      this.battle = null;
      this.scene = this.overworld;
      this.audio.play(this.overworld.map.def.music || 'town');
      this.overworld.onBattleEnd(result);
    }, () => { this.transition = null; });
  }

  // ------------------------------------------------------------ loop ----
  loop() {
    const now = performance.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.1) dt = 0.1;

    if (this.transition) this.transition.update(dt);
    // Input is frozen while a transition covers the screen, so a stray press
    // can't leak into the scene that is about to appear.
    if (!this.transition) this.scene.update(dt, this.input);
    else if (this.scene.update.length >= 2) this.scene.update(dt, FROZEN_INPUT);

    const ctx = this.ctx;
    ctx.save();
    this.scene.draw(ctx);
    ctx.restore();
    if (this.transition) this.transition.draw(ctx);

    this.input.endFrame();
    requestAnimationFrame(() => this.loop());
  }
}

const FROZEN_INPUT = {
  held: () => false, pressed: () => false, released: () => false,
  direction: () => null, pressedDirection: () => null, endFrame() {}, clear() {},
};

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('game');
  const boot = document.getElementById('boot');
  try {
    new Game(canvas);
    setTimeout(() => {
      boot.classList.add('hidden');
      setTimeout(() => boot.remove(), 600);
    }, 260);
  } catch (err) {
    console.error(err);
    boot.querySelector('.boot-hint').textContent = 'שגיאה בטעינה: ' + err.message;
  }
});
