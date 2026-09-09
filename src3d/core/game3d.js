// The 3D game shell.
//
// The 3D world replaces only the overworld: dialogue, menus, the bag, the
// catalogue, saving and the whole battle system are the same modules the 2D
// game uses, drawn onto a 960x640 UI layer composited over the scene. Keeping
// one implementation of the rules is what makes the two versions stay in sync.

import { Input } from '../../src/core/input.js';
import { AudioEngine } from '../../src/core/audio.js';
import { GameState, newGame } from '../../src/game/state.js';
import { saveGame, loadGame } from '../../src/core/save.js';
import { Dialogue } from '../../src/game/dialogue.js';
import { MenuSystem } from '../../src/game/menus.js';
import { BattleScene } from '../../src/battle/scene.js';
import { TitleScreen } from '../../src/game/title.js';
import { World3D } from '../world3d.js';

export const UI_W = 960, UI_H = 640;

export class Game3D {
  constructor(glCanvas, uiCanvas) {
    this.canvas = glCanvas;
    this.uiCanvas = uiCanvas;
    this.uiCtx = uiCanvas.getContext('2d');

    this.input = new Input();
    this.audio = new AudioEngine();
    this.state = new GameState(newGame());
    this.dialogue = new Dialogue(this.audio);
    this.menus = new MenuSystem(this);

    this.battle = null;
    this.world = null;
    this.fade = 0;
    this.fadeDir = 0;
    this.afterFade = null;
    this.viewport = { w: UI_W, h: UI_H, dpr: 1 };

    this.title = new TitleScreen(this);
    this.audio.play('town');

    const unlock = () => this.audio.unlock();
    for (const e of ['keydown', 'pointerdown', 'touchstart']) {
      addEventListener(e, unlock, { once: true });
    }
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !this.input.textMode) {
        this.menus.say(this.audio.toggleMute() ? 'הצליל הושתק' : 'הצליל פועל');
      }
    });
  }

  // ---------------------------------------------------------- new / load --
  newGame(name, look) {
    this.state = new GameState(newGame(name, look));
    this.menus = new MenuSystem(this);
    this.enterWorld(true);
  }

  continueGame() {
    const data = loadGame();
    if (!data) return;
    this.state = new GameState(data);
    this.menus = new MenuSystem(this);
    this.enterWorld(false);
  }

  enterWorld(isNew) {
    this.fadeTo(() => {
      this.title?.destroy?.();
      this.title = null;
      this.world = new World3D(this, this.canvas);
      this.resize();
      if (isNew) {
        this.dialogue.say([
          'היום אתה יוצא למסע.',
          'בחוץ מחכה עולם מלא ביצורים — תראה אותם מסתובבים, תתקרב, ותילחם בהם.',
          'צא מהבית כדי להתחיל.',
        ]);
      }
    });
  }

  save() {
    this.world?.storePlayerPosition();
    return saveGame(this.state.data);
  }

  // ------------------------------------------------------------ battles --
  startBattle(o) {
    this.audio.play('battle');
    this.fadeTo(() => {
      this.battle = new BattleScene({
        game: this,
        party: this.state.party,
        foeParty: o.foeParty,
        kind: o.kind,
        trainer: o.trainer,
        terrain: o.terrain,
        onEnd: (result) => this.endBattle(result),
      });
    });
  }

  endBattle(result) {
    this.fadeTo(() => {
      this.battle = null;
      this.audio.play(this.world.map.def.music || 'town');
      this.world.onBattleEnd(result);
    });
  }

  /** Black out, run `fn`, fade back in. */
  fadeTo(fn) {
    this.afterFade = fn;
    this.fadeDir = 1;
  }

  // ------------------------------------------------------------- update --
  update(dt) {
    if (this.fadeDir) {
      this.fade = Math.max(0, Math.min(1, this.fade + this.fadeDir * dt * 2.8));
      if (this.fadeDir > 0 && this.fade >= 1) {
        this.fadeDir = -1;
        const fn = this.afterFade; this.afterFade = null;
        if (fn) fn();
      } else if (this.fadeDir < 0 && this.fade <= 0) this.fadeDir = 0;
      this.input.endFrame();
      return;
    }
    if (this.battle) this.battle.update(dt, this.input);
    else if (this.world) this.world.update(dt, this.input);
    else this.title.update(dt, this.input);
    this.input.endFrame();
  }

  render() {
    const ctx = this.uiCtx;
    ctx.clearRect(0, 0, UI_W, UI_H);
    const showScene = !!this.world && !this.battle;
    this.canvas.style.visibility = showScene ? 'visible' : 'hidden';
    if (this.battle) {
      ctx.save(); this.battle.draw(ctx); ctx.restore();
    } else if (this.world) {
      this.world.render();
      this.world.drawHud(ctx);
      this.dialogue.draw(ctx);
      this.menus.draw(ctx);
    } else {
      this.title.draw(ctx);
    }
    if (this.fade > 0) {
      ctx.fillStyle = `rgba(0,0,0,${this.fade})`;
      ctx.fillRect(0, 0, UI_W, UI_H);
    }
  }

  /** Letterbox both layers to a 3:2 box so every UI coordinate stays valid. */
  resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const pad = matchMedia('(pointer: coarse)').matches ? 8 : 16;
    const scale = Math.max(0.2, Math.min((innerWidth - pad * 2) / UI_W, (innerHeight - pad * 2) / UI_H));
    const w = Math.floor(UI_W * scale), h = Math.floor(UI_H * scale);
    for (const c of [this.canvas, this.uiCanvas]) {
      c.style.width = w + 'px';
      c.style.height = h + 'px';
      c.style.left = Math.floor((innerWidth - w) / 2) + 'px';
      c.style.top = Math.floor((innerHeight - h) / 2) + 'px';
    }
    this.uiCanvas.width = Math.floor(UI_W * dpr);
    this.uiCanvas.height = Math.floor(UI_H * dpr);
    this.uiCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.viewport = { w: UI_W, h: UI_H, dpr: dpr * scale };
    this.world?.renderer.resize(UI_W, UI_H, this.viewport.dpr);
  }
}
