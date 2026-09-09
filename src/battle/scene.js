// Battle presentation: background, combatants, HUD, menus and the playback of
// the engine's event list.

import { Battle } from './engine.js';
import { createFx } from './fx.js';
import { Particles } from '../gfx/particles.js';
import { drawMonster, drawMonsterIcon } from '../gfx/monster.js';
import {
  panel, drawText, drawNum, wrapText, bar, hpColors, selection, chip, advanceArrow,
  vignette, fitSize,
} from '../gfx/ui.js';
import { getSpecies } from '../data/species.js';
import { getMove, STRUGGLE } from '../data/moves.js';
import { getItem } from '../data/items.js';
import { typeColor, typeName, typeMultiplier } from '../data/types.js';
import {
  displayName, hpRatio, expToNext, STATUS, evolveInto, makeMoveSlot,
} from '../game/creature.js';
import { clamp, lerp, easeOutCubic, easeOutBack, hsl } from '../core/util.js';

const W = 960, H = 640;
const FOE = { x: 700, y: 292, size: 250 };
const ME = { x: 252, y: 474, size: 300 };

export class BattleScene {
  /**
   * @param o { game, party, foeParty, kind, trainer, terrain, onEnd }
   */
  constructor(o) {
    this.game = o.game;
    this.state = o.game.state;
    this.audio = o.game.audio;
    this.terrain = o.terrain || 'grass';
    this.onEnd = o.onEnd;
    this.trainer = o.trainer || null;
    this.kind = o.kind;

    this.battle = new Battle({
      party: o.party, foeParty: o.foeParty, kind: o.kind,
      trainer: o.trainer, state: this.state,
    });

    this.P = new Particles();
    this.fx = [];
    this.t = 0;
    this.shake = 0;
    this.flashAlpha = 0;

    this.queue = [];
    this.current = null;
    this.msg = '';
    this.msgShown = 0;
    this.msgWait = false;
    this.autoAdvance = 0;

    this.menu = null;            // 'main' | 'moves' | 'bag' | 'party' | 'learn'
    this.cursor = 0;
    this.subCursor = 0;
    this.scroll = 0;
    this.forcedSwitch = false;
    this.finished = false;
    this.result = null;

    // animated display values
    this.disp = {
      foeHp: 1, meHp: 1, meExp: 0,
      foeAlpha: 1, meAlpha: 1,
      foeY: 0, meY: 0,
      foeScale: 1, meScale: 1,
      foeFlash: 0, meFlash: 0,
    };
    this.ballAnim = null;
    this.entering = 1;
    // The engine resolves a whole turn up front, so its `me`/`foe` pointers can
    // already be on the *next* creature while we are still playing back the
    // previous one.  These two follow the animation instead.
    this.shownFoe = this.battle.foe;
    this.shownMe = this.battle.me;

    this.buildIntro();
  }

  // ------------------------------------------------------------- setup --
  buildIntro() {
    const foe = this.battle.foe;
    this.state.see(foe.species);
    this.disp.foeHp = hpRatio(foe);
    const me = this.battle.me;
    if (me) {
      this.disp.meHp = hpRatio(me);
      const e = expToNext(me);
      this.disp.meExp = e.into / e.span;
    }
    if (this.kind === 'wild') {
      this.push({ t: 'msg', text: `${displayName(foe)} פראי הופיע!` });
      this.push({ t: 'cry', side: 'foe' });
    } else {
      this.push({ t: 'msg', text: this.trainer.intro });
      this.push({ t: 'msg', text: `${this.trainer.name} שולח את ${displayName(foe)}!` });
      this.push({ t: 'cry', side: 'foe' });
    }
    this.push({ t: 'msg', text: `קדימה, ${displayName(this.battle.me)}!` });
    this.push({ t: 'sendout', side: 'player', creature: this.battle.me });
    this.push({ t: 'menu' });
  }

  push(e) { this.queue.push(e); }
  pushFront(list) { this.queue.unshift(...list); }

  // ------------------------------------------------------------ update --
  update(dt, input) {
    this.t += dt;
    this.entering = Math.max(0, this.entering - dt * 1.6);
    this.P.update(dt);
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.update(dt);
      if (f.shake) this.shake = Math.max(this.shake, f.shake);
      if (f.t >= f.dur) this.fx.splice(i, 1);
    }
    this.shake *= Math.pow(0.02, dt);
    this.flashAlpha = Math.max(0, this.flashAlpha - dt * 3);
    for (const k of ['foeFlash', 'meFlash']) {
      this.disp[k] = Math.max(0, this.disp[k] - dt * 4);
    }
    if (this.ballAnim) this.updateBall(dt);

    if (this.menu) this.updateMenu(dt, input);
    else this.updateEvents(dt, input);
  }

  // --------------------------------------------------- event playback ---
  updateEvents(dt, input) {
    if (!this.current) {
      if (!this.queue.length) {
        if (this.finished) { if (!this.closed) { this.closed = true; this.onEnd(this.result, this.battle); } }
        else this.menu = 'main';
        return;
      }
      this.current = this.queue.shift();
      this.startEvent(this.current);
      if (!this.current) return;
    }
    const e = this.current;
    e.time = (e.time ?? 0) + dt;

    switch (e.t) {
      case 'msg': {
        const speed = 42;
        this.msgShown = Math.min(this.msg.length, this.msgShown + speed * dt);
        if (input.pressed('a') || input.pressed('b')) {
          if (this.msgShown < this.msg.length) this.msgShown = this.msg.length;
          else this.current = null;
        } else if (this.msgShown >= this.msg.length) {
          if (e.time > (e.hold ?? 0.85)) this.current = null;
        }
        break;
      }
      case 'anim':
        if (e.time > (e.dur ?? 0.55)) this.current = null;
        break;
      case 'hp': {
        const k = clamp(e.time / 0.7, 0, 1);
        const key = e.side === 'player' ? 'meHp' : 'foeHp';
        this.disp[key] = lerp(e.fromR, e.toR, easeOutCubic(k));
        if (k >= 1) this.current = null;
        break;
      }
      case 'faint': {
        const k = clamp(e.time / 0.8, 0, 1);
        const side = e.side === 'player' ? 'me' : 'foe';
        this.disp[side + 'Y'] = k * 120;
        this.disp[side + 'Alpha'] = 1 - k;
        if (k >= 1) this.current = null;
        break;
      }
      case 'sendout': {
        const k = clamp(e.time / 0.55, 0, 1);
        const side = e.side === 'player' ? 'me' : 'foe';
        this.disp[side + 'Alpha'] = Math.min(1, k * 2);
        this.disp[side + 'Scale'] = easeOutBack(k);
        this.disp[side + 'Y'] = 0;
        if (k >= 1) { this.disp[side + 'Scale'] = 1; this.current = null; }
        break;
      }
      case 'withdraw': {
        const k = clamp(e.time / 0.35, 0, 1);
        const side = e.side === 'player' ? 'me' : 'foe';
        this.disp[side + 'Scale'] = 1 - k;
        this.disp[side + 'Alpha'] = 1 - k;
        if (k >= 1) this.current = null;
        break;
      }
      case 'expbar': {
        const k = clamp(e.time / 0.8, 0, 1);
        this.disp.meExp = lerp(e.from, e.to, easeOutCubic(k));
        if (k >= 1) this.current = null;
        break;
      }
      case 'ball':
        if (!this.ballAnim) this.current = null;
        break;
      case 'evolveRun': {
        const k = clamp(e.time / 3.0, 0, 1);
        this.evo.t = k;
        if (!e.swapped && k >= 0.55) {
          e.swapped = true;
          evolveInto(this.evo.creature, this.evo.to);
          this.audio.cry(getSpecies(this.evo.to).cry * 7 + 13);
          this.P.burst(W / 2, H / 2 - 30, 60, {
            color: '#ffe9a0', speed: 380, ttl: 0.9, size: 8, glow: true, shape: 'star',
          });
        }
        if (k >= 1) { this.current = null; }
        break;
      }
      case 'wait':
        if (e.time > (e.dur ?? 0.4)) this.current = null;
        break;
      default:
        this.current = null;
    }
  }

  startEvent(e) {
    switch (e.t) {
      case 'msg':
        this.msg = e.text; this.msgShown = 0;
        break;
      case 'cry': {
        const c = this.battle.actor(e.side);
        this.audio.cry(getSpecies(c.species).cry * 7 + 13);
        this.current = null;
        break;
      }
      case 'anim': {
        const from = e.side === 'player' ? this.mePoint() : this.foePoint();
        const to = e.side === 'player' ? this.foePoint() : this.mePoint();
        const move = e.move ? getMove(e.move) : null;
        const fx = createFx(e.fx, from, to, this.P, e.type || move?.type || 'neutral');
        this.fx.push(fx);
        e.dur = Math.min(fx.dur, 0.8);
        if (!e.status) this.audio.sfx('hit');
        break;
      }
      case 'hp': {
        const max = e.max || (e.side === 'player' ? this.shownMe : this.shownFoe).stats.hp;
        e.fromR = clamp(e.from / max, 0, 1);
        e.toR = clamp(e.to / max, 0, 1);
        if (e.to < e.from) {
          this.disp[e.side === 'player' ? 'meFlash' : 'foeFlash'] = 1;
          this.shake = Math.max(this.shake, e.eff > 1 ? 12 : 6);
          if (e.eff > 1) this.audio.sfx('super');
          else if (e.eff < 1 && e.eff > 0) this.audio.sfx('weak');
        } else this.audio.sfx('heal');
        break;
      }
      case 'faint':
        this.audio.sfx('faint');
        break;
      case 'status':
        this.audio.sfx('wobble');
        this.current = null;
        break;
      case 'stat':
        this.P.burst(
          e.side === 'player' ? ME.x : FOE.x,
          (e.side === 'player' ? ME.y : FOE.y) - 40,
          22,
          { color: e.up ? '#8ef0b4' : '#f09a8a', speed: 120, ttl: 0.7, size: 5, glow: true,
            angle: e.up ? -1.57 : 1.57, spread: 1.6 });
        this.audio.sfx(e.up ? 'select' : 'back');
        this.current = null;
        break;
      case 'sendout':
        this.audio.cry(getSpecies(e.creature.species).cry * 7 + 13);
        if (e.side === 'player') this.shownMe = e.creature; else this.shownFoe = e.creature;
        if (e.side === 'foe') this.state.see(e.creature.species);
        if (e.side === 'player') {
          this.disp.meHp = hpRatio(e.creature);
          const x = expToNext(e.creature);
          this.disp.meExp = x.into / x.span;
        } else this.disp.foeHp = hpRatio(e.creature);
        break;
      case 'exp':
        this.handleExp(e);
        this.current = null;
        break;
      case 'ball':
        this.startBall(e);
        break;
      case 'forceSwitch':
        this.forcedSwitch = true;
        this.menu = 'party';
        this.cursor = this.battle.party.findIndex((c) => c.hp > 0);
        this.current = null;
        break;
      case 'menu':
        this.menu = 'main'; this.cursor = 0;
        this.current = null;
        break;
      case 'levelup':
        this.audio.sfx('levelup');
        this.P.burst(ME.x, ME.y - 120, 34, {
          color: '#ffe9a0', speed: 210, ttl: 0.9, size: 6, shape: 'star',
          glow: true, angle: -1.57, spread: 2.4,
        });
        this.disp.meExp = 0;
        this.current = null;
        break;
      case 'learnPrompt':
        this.learnCreature = e.creature;
        this.learnMove = e.move;
        this.cursor = 0;
        this.menu = 'learn';
        this.current = null;
        break;
      case 'evolveStart':
        this.evo = { creature: e.creature, to: e.to, from: e.creature.species, t: 0 };
        this.audio.play('victory');
        this.current = null;
        break;
      case 'evolveEnd':
        this.evo = null;
        this.audio.play(this.kind === 'trainer' ? 'battle' : 'battle');
        this.current = null;
        break;
      case 'end':
        this.finishBattle(e);
        this.current = null;
        break;
      default:
        break;
    }
  }

  handleExp(e) {
    const c = e.creature;
    const inserted = [];
    const x = expToNext(c);
    inserted.push({ t: 'msg', text: `${displayName(c)} קיבל ${e.amount} נקודות ניסיון!`, hold: 0.4 });
    inserted.push({ t: 'expbar', from: this.disp.meExp, to: c === this.battle.me ? x.into / x.span : this.disp.meExp });
    for (const lv of e.result.levels) {
      inserted.push({ t: 'levelup', creature: c, level: lv });
      inserted.push({ t: 'msg', text: `${displayName(c)} עלה לרמה ${lv}!` });
    }
    for (const mv of e.result.learned) {
      inserted.push({ t: 'msg', text: `${displayName(c)} למד ${getMove(mv).name}!` });
    }
    for (const p of e.result.pending) {
      inserted.push({ t: 'msg', text: `${displayName(c)} מנסה ללמוד ${getMove(p.move).name}…` });
      inserted.push({ t: 'msg', text: `אבל הוא כבר יודע ארבעה מהלכים!` });
      inserted.push({ t: 'learnPrompt', creature: c, move: p.move });
    }
    if (e.result.evolve) {
      const toName = getSpecies(e.result.evolve).name;
      inserted.push({ t: 'msg', text: `מה?! ${displayName(c)} משנה צורה!` });
      inserted.push({ t: 'evolveStart', creature: c, to: e.result.evolve });
      inserted.push({ t: 'evolveRun' });
      inserted.push({ t: 'msg', text: `מזל טוב! ${displayName(c)} הפך ל${toName}!` });
      inserted.push({ t: 'evolveEnd' });
    }
    this.pushFront(inserted);
  }

  startBall(e) {
    const item = getItem(e.item);
    this.audio.sfx('ball');
    this.ballAnim = {
      phase: 'throw', t: 0, shakes: e.shakes, caught: e.caught,
      shakeIndex: 0, color: item.color,
    };
  }

  updateBall(dt) {
    const b = this.ballAnim;
    b.t += dt;
    if (b.phase === 'throw' && b.t > 0.55) {
      b.phase = 'suck'; b.t = 0;
      this.disp.foeScale = 1;
    } else if (b.phase === 'suck') {
      this.disp.foeScale = Math.max(0, 1 - b.t / 0.35);
      this.disp.foeAlpha = Math.max(0, 1 - b.t / 0.35);
      if (b.t > 0.45) { b.phase = 'wobble'; b.t = 0; }
    } else if (b.phase === 'wobble') {
      if (b.t > 0.75) {
        b.t = 0;
        b.shakeIndex++;
        if (b.shakeIndex <= b.shakes) this.audio.sfx('wobble');
        if (b.shakeIndex > b.shakes) {
          if (b.caught) { b.phase = 'caught'; this.audio.sfx('caught'); }
          else { b.phase = 'escape'; this.audio.sfx('escape'); }
        }
      }
    } else if (b.phase === 'escape') {
      this.disp.foeScale = Math.min(1, b.t / 0.3);
      this.disp.foeAlpha = Math.min(1, b.t / 0.3);
      if (b.t > 0.4) { this.ballAnim = null; this.disp.foeScale = 1; this.disp.foeAlpha = 1; }
    } else if (b.phase === 'caught') {
      if (b.t > 0.9) this.ballAnim = null;
    }
  }

  // ------------------------------------------------------------- menus --
  updateMenu(dt, input) {
    const A = input.pressed('a'), B = input.pressed('b');
    const dir = input.pressedDirection();
    const move = (n) => { this.cursor = n; this.audio.sfx('cursor'); };

    if (this.menu === 'main') {
      // 2x2: קרב / תיק / צוות / בריחה
      if (dir === 'left') move((this.cursor % 2 === 0) ? this.cursor + 1 : this.cursor - 1);
      if (dir === 'right') move((this.cursor % 2 === 0) ? this.cursor + 1 : this.cursor - 1);
      if (dir === 'up' && this.cursor >= 2) move(this.cursor - 2);
      if (dir === 'down' && this.cursor < 2) move(this.cursor + 2);
      if (A) {
        this.audio.sfx('select');
        if (this.cursor === 0) { this.menu = 'moves'; this.subCursor = 0; }
        else if (this.cursor === 1) { this.menu = 'bag'; this.subCursor = 0; this.scroll = 0; }
        else if (this.cursor === 2) { this.menu = 'party'; this.subCursor = 0; }
        else { this.commit({ type: 'run' }); }
      }
      return;
    }

    if (this.menu === 'moves') {
      const moves = this.battle.me.moves;
      // Out of PP on every move: the only option is Struggle.
      if (moves.every((m) => m.pp <= 0)) {
        if (B) { this.audio.sfx('back'); this.menu = 'main'; return; }
        if (A) { this.audio.sfx('select'); this.commit({ type: 'move', index: -1 }); }
        return;
      }
      if (dir === 'left' || dir === 'right') {
        this.subCursor = this.subCursor % 2 === 0 ? this.subCursor + 1 : this.subCursor - 1;
        this.audio.sfx('cursor');
      }
      if (dir === 'up' && this.subCursor >= 2) { this.subCursor -= 2; this.audio.sfx('cursor'); }
      if (dir === 'down' && this.subCursor < 2) { this.subCursor += 2; this.audio.sfx('cursor'); }
      this.subCursor = clamp(this.subCursor, 0, moves.length - 1);
      if (B) { this.audio.sfx('back'); this.menu = 'main'; return; }
      if (A) {
        const slot = moves[this.subCursor];
        if (!slot || slot.pp <= 0) { this.audio.sfx('bump'); return; }
        this.audio.sfx('select');
        this.commit({ type: 'move', index: this.subCursor });
      }
      return;
    }

    if (this.menu === 'bag') {
      const items = this.state.itemList().filter((i) => {
        const it = getItem(i.id);
        return it && it.kind !== 'key';
      });
      if (dir === 'up') { this.subCursor = Math.max(0, this.subCursor - 1); this.audio.sfx('cursor'); }
      if (dir === 'down') { this.subCursor = Math.min(items.length - 1, this.subCursor + 1); this.audio.sfx('cursor'); }
      if (B) { this.audio.sfx('back'); this.menu = 'main'; return; }
      if (A && items.length) {
        const it = items[this.subCursor];
        const def = getItem(it.id);
        this.audio.sfx('select');
        if (def.kind === 'ball') {
          if (this.kind === 'trainer') {
            this.flashMessage('אסור לגנוב את היצורים של מאמן אחר!');
            return;
          }
          this.commit({ type: 'item', id: it.id });
        } else {
          this.pendingItem = it.id;
          this.menu = 'party';
          this.itemTarget = true;
          this.subCursor = 0;
        }
      }
      return;
    }

    if (this.menu === 'party') {
      const party = this.battle.party;
      if (dir === 'up') { this.cursor = Math.max(0, this.cursor - 1); this.audio.sfx('cursor'); }
      if (dir === 'down') { this.cursor = Math.min(party.length - 1, this.cursor + 1); this.audio.sfx('cursor'); }
      if (B && !this.forcedSwitch) {
        this.audio.sfx('back');
        this.menu = this.itemTarget ? 'bag' : 'main';
        this.itemTarget = false; this.pendingItem = null;
        return;
      }
      if (A) {
        const target = party[this.cursor];
        if (this.itemTarget) {
          this.audio.sfx('select');
          const id = this.pendingItem;
          this.itemTarget = false; this.pendingItem = null;
          this.commit({ type: 'item', id, targetIndex: this.cursor });
          return;
        }
        if (target.hp <= 0) { this.audio.sfx('bump'); this.flashMessage(`${displayName(target)} לא מסוגל להילחם!`); return; }
        if (this.cursor === this.battle.pIndex && !this.forcedSwitch) {
          this.audio.sfx('bump'); this.flashMessage(`${displayName(target)} כבר בזירה!`); return;
        }
        this.audio.sfx('select');
        if (this.forcedSwitch) {
          this.forcedSwitch = false;
          this.menu = null;
          const ev = [];
          this.battle.switchIn('player', this.cursor, ev);
          this.pushFront(this.translate(ev));
          this.push({ t: 'menu' });
        } else {
          this.commit({ type: 'switch', index: this.cursor });
        }
      }
      return;
    }

    if (this.menu === 'learn') {
      const c = this.learnCreature;
      const n = c.moves.length + 1;
      if (dir === 'up') { this.cursor = (this.cursor + n - 1) % n; this.audio.sfx('cursor'); }
      if (dir === 'down') { this.cursor = (this.cursor + 1) % n; this.audio.sfx('cursor'); }
      if (A || B) {
        this.audio.sfx('select');
        const newMove = this.learnMove;
        const idx = this.cursor;
        this.menu = null;
        if (B || idx === c.moves.length) {
          this.pushFront([{ t: 'msg', text: `${displayName(c)} ויתר על לימוד ${getMove(newMove).name}.` }]);
        } else {
          const old = getMove(c.moves[idx].id).name;
          c.moves[idx] = makeMoveSlot(newMove);
          this.pushFront([
            { t: 'msg', text: `1, 2 ו… פוף!` },
            { t: 'msg', text: `${displayName(c)} שכח את ${old} ולמד ${getMove(newMove).name}!` },
          ]);
        }
      }
      return;
    }
  }

  flashMessage(text) {
    this.msg = text; this.msgShown = text.length;
    this.msgFlash = 1.6;
  }

  commit(action) {
    this.menu = null;
    const ev = this.battle.takeTurn(action);
    this.queue = this.translate(ev);
    if (!this.battle.over && !this.queue.some((e) => e.t === 'forceSwitch')) {
      this.queue.push({ t: 'menu' });
    }
  }

  /** Turn engine events into scene events (adds move metadata for the fx). */
  translate(ev) {
    return ev.map((e) => ({ ...e }));
  }

  finishBattle(e) {
    this.finished = true;
    this.result = e.result;
    this.menu = null;
    if (e.result === 'win' || e.result === 'caught') this.audio.play('victory');
    if (e.result === 'win' && this.kind === 'trainer') {
      this.state.addMoney(this.trainer.reward);
    }
    if (e.result === 'caught') {
      const c = e.creature;
      this.state.catchDex(c.species);
      const where = this.state.addToParty(c);
      this.pushFront([
        { t: 'msg', text: where === 'party'
          ? `${displayName(c)} הצטרף לצוות!`
          : `${displayName(c)} נשלח לתיבת האחסון.` },
      ]);
    }
    this.push({ t: 'wait', dur: 0.35 });
  }

  // -------------------------------------------------------------- draw --
  foePoint() { return { x: FOE.x, y: FOE.y - 80 }; }
  mePoint() { return { x: ME.x, y: ME.y - 100 }; }

  draw(ctx) {
    ctx.save();
    if (this.shake > 0.4) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }
    this.drawBackground(ctx);

    // --- combatants
    const foe = this.shownFoe;
    const me = this.shownMe;
    if (foe && this.disp.foeAlpha > 0.01) {
      drawMonster(ctx, foe.species, FOE.x, FOE.y + this.disp.foeY, FOE.size, {
        t: this.t, alpha: this.disp.foeAlpha, scale: this.disp.foeScale,
        flash: this.disp.foeFlash, flashColor: '#ff8a7a',
      });
    }
    if (me && this.disp.meAlpha > 0.01) {
      drawMonster(ctx, me.species, ME.x, ME.y + this.disp.meY, ME.size, {
        t: this.t, back: true, alpha: this.disp.meAlpha, scale: this.disp.meScale,
        flash: this.disp.meFlash, flashColor: '#ff8a7a',
      });
    }

    for (const f of this.fx) f.draw(ctx);
    this.P.draw(ctx);
    if (this.ballAnim) this.drawBall(ctx);

    // --- HUD
    if (foe) this.drawFoePanel(ctx, foe);
    if (me) this.drawMePanel(ctx, me);

    this.drawBottom(ctx);

    if (this.evo) this.drawEvolve(ctx);
    vignette(ctx, W, H, 0.4);
    if (this.entering > 0) {
      ctx.fillStyle = `rgba(0,0,0,${this.entering})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  drawBackground(ctx) {
    const cave = this.terrain === 'cave';
    const g = ctx.createLinearGradient(0, 0, 0, H);
    if (cave) { g.addColorStop(0, '#151a2e'); g.addColorStop(0.6, '#1d2136'); g.addColorStop(1, '#0e1120'); }
    else { g.addColorStop(0, '#63b6e8'); g.addColorStop(0.45, '#a9dcf2'); g.addColorStop(0.55, '#cfe9c8'); g.addColorStop(1, '#5f9b57'); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    if (!cave) {
      // distant hills
      ctx.fillStyle = 'rgba(90,150,110,.55)';
      ctx.beginPath();
      ctx.moveTo(0, 340);
      for (let x = 0; x <= W; x += 40) {
        ctx.lineTo(x, 330 + Math.sin(x * 0.006 + 1.2) * 34 + Math.sin(x * 0.017) * 12);
      }
      ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
      // sun glow
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const sg = ctx.createRadialGradient(180, 90, 10, 180, 90, 220);
      sg.addColorStop(0, 'rgba(255,240,190,.45)'); sg.addColorStop(1, 'rgba(255,240,190,0)');
      ctx.fillStyle = sg; ctx.fillRect(0, 0, 460, 380);
      ctx.restore();
    } else {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 5; i++) {
        const x = 120 + i * 190, y = 90 + Math.sin(i * 2.1) * 40;
        const cg = ctx.createRadialGradient(x, y, 4, x, y, 130);
        cg.addColorStop(0, 'rgba(120,190,230,.16)'); cg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = cg; ctx.fillRect(x - 140, y - 140, 280, 280);
      }
      ctx.restore();
    }

    // platforms
    const plat = (x, y, rx, ry, hue) => {
      const pg = ctx.createRadialGradient(x, y, 4, x, y, rx);
      pg.addColorStop(0, hsl(hue, cave ? 10 : 45, cave ? 34 : 44));
      pg.addColorStop(0.75, hsl(hue, cave ? 10 : 40, cave ? 24 : 34));
      pg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = pg;
      ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(x, y - 3, rx * 0.92, ry * 0.9, 0, 0, 7); ctx.stroke();
    };
    plat(FOE.x, FOE.y + 8, 180, 42, cave ? 220 : 104);
    plat(ME.x, ME.y + 10, 226, 54, cave ? 220 : 104);
  }

  drawFoePanel(ctx, c) {
    const x = 36, y = 40, w = 386, h = 96;
    panel(ctx, x, y, w, h, { radius: 16 });
    const sp = getSpecies(c.species);
    drawText(ctx, displayName(c), x + w - 18, y + 34, { size: 23 });
    drawText(ctx, `Lv.${c.level}`, x + 76, y + 34, { size: 19, color: '#a8c4e8', align: 'left' });
    let cx = x + w - 18;
    for (const t of sp.types) {
      cx -= chip(ctx, typeName(t), cx, y + 44, typeColor(t), { size: 12 }) + 6;
    }
    bar(ctx, x + 18, y + 68, w - 36, 14, this.disp.foeHp, { colors: hpColors(this.disp.foeHp) });
    if (c.status !== 'none') {
      chip(ctx, STATUS[c.status].name, x + 96, y + 12, STATUS[c.status].color, { size: 12 });
    }
    if (this.state.data.dex.caught[c.species]) {
      drawText(ctx, '●', x + 20, y + 30, { size: 18, color: '#8ef0b4', align: 'left' });
    }
  }

  drawMePanel(ctx, c) {
    const x = 538, y = 330, w = 398, h = 122;
    panel(ctx, x, y, w, h, { radius: 16 });
    const sp = getSpecies(c.species);
    drawText(ctx, displayName(c), x + w - 18, y + 34, { size: 23 });
    drawText(ctx, `Lv.${c.level}`, x + 76, y + 34, { size: 19, color: '#a8c4e8', align: 'left' });
    let cx = x + w - 18;
    for (const t of sp.types) {
      cx -= chip(ctx, typeName(t), cx, y + 44, typeColor(t), { size: 12 }) + 6;
    }
    bar(ctx, x + 18, y + 68, w - 36, 14, this.disp.meHp, { colors: hpColors(this.disp.meHp) });
    drawNum(ctx, `${Math.max(0, c.hp)} / ${c.stats.hp}`, x + w - 18, y + 104, { size: 17, color: '#c8dcf5' });
    drawText(ctx, 'ניסיון', x + 20, y + 104, { size: 14, color: '#7f9dc4', align: 'left' });
    bar(ctx, x + 74, y + 92, w - 190, 8, this.disp.meExp, { colors: ['#8fd8ff', '#3a7fc4'] });
    if (c.status !== 'none') {
      chip(ctx, STATUS[c.status].name, x + 96, y + 12, STATUS[c.status].color, { size: 12 });
    }
  }

  drawBottom(ctx) {
    if (this.menu === 'moves') return this.drawMoveMenu(ctx);
    if (this.menu === 'bag') return this.drawBagMenu(ctx);
    if (this.menu === 'party') return this.drawPartyMenu(ctx);
    if (this.menu === 'learn') return this.drawLearnMenu(ctx);

    const showMenu = this.menu === 'main';
    const boxW = showMenu ? 548 : 912;
    panel(ctx, 24, 492, boxW, 124, { radius: 16 });

    if (showMenu) {
      const c = this.shownMe;
      drawText(ctx, `מה ${displayName(c)} יעשה?`, 24 + boxW - 26, 546, { size: 24 });
      const items = ['קרב', 'תיק', 'צוות', 'בריחה'];
      const mx = 572, my = 492, mw = 364, mh = 124;
      panel(ctx, mx, my, mw, mh, { radius: 16 });
      for (let i = 0; i < 4; i++) {
        const col = i % 2, row = (i / 2) | 0;
        const bx = mx + 14 + (1 - col) * (mw / 2 - 12), by = my + 12 + row * 50;
        const bw = mw / 2 - 22, bh = 46;
        if (this.cursor === i) selection(ctx, bx, by, bw, bh, this.t);
        drawText(ctx, items[i], bx + bw - 14, by + 31, { size: 22, color: this.cursor === i ? '#fff' : '#cddcf0' });
      }
    } else {
      const text = this.msg.slice(0, Math.floor(this.msgShown));
      const lines = wrapText(ctx, text, boxW - 56, 23);
      lines.slice(-3).forEach((ln, i) => {
        drawText(ctx, ln, 24 + boxW - 28, 536 + i * 32, { size: 23 });
      });
      if (this.msgShown >= this.msg.length && this.current?.t === 'msg') {
        advanceArrow(ctx, 52, 594, this.t);
      }
    }
  }

  drawMoveMenu(ctx) {
    const x = 24, y = 462, w = 660, h = 154;
    panel(ctx, x, y, w, h, { radius: 16 });
    const moves = this.shownMe.moves;
    if (moves.every((m) => m.pp <= 0)) {
      selection(ctx, x + 16, y + 12, w - 32, 60, this.t);
      drawText(ctx, STRUGGLE.name, x + w - 30, y + 50, { size: 22 });
      drawText(ctx, 'לא נותרו נקודות שימוש — אין ברירה אלא להתאבק.',
        x + w - 30, y + 108, { size: 17, color: '#a8c4e8' });
      const ix0 = 700, iw0 = 236;
      panel(ctx, ix0, y, iw0, h, { radius: 16 });
      drawText(ctx, STRUGGLE.name, ix0 + iw0 - 16, y + 32, { size: 20 });
      drawText(ctx, 'פיזי', ix0 + iw0 - 16, y + 60, { size: 16, color: '#a8c4e8' });
      drawText(ctx, `עוצמה: ${STRUGGLE.power}`, ix0 + iw0 - 16, y + 86, { size: 16, color: '#c8dcf5' });
      drawText(ctx, 'פוגע גם בך', ix0 + iw0 - 16, y + 112, { size: 15, color: '#f0a08a' });
      return;
    }
    for (let i = 0; i < 4; i++) {
      const col = i % 2, row = (i / 2) | 0;
      const bx = x + 16 + (1 - col) * (w / 2 - 14);
      const by = y + 12 + row * 66;
      const bw = w / 2 - 26, bh = 60;
      const slot = moves[i];
      if (!slot) {
        drawText(ctx, '—', bx + bw - 14, by + 38, { size: 22, color: '#43536e' });
        continue;
      }
      const mv = getMove(slot.id);
      if (this.subCursor === i) selection(ctx, bx, by, bw, bh, this.t, typeColor(mv.type));
      drawText(ctx, mv.name, bx + bw - 14, by + 26, { size: 21, color: slot.pp > 0 ? '#fff' : '#8d6a6a' });
      chip(ctx, typeName(mv.type), bx + bw - 14, by + 34, typeColor(mv.type), { size: 11 });
      drawNum(ctx, `${slot.pp}/${slot.maxPp}`, bx + 14, by + 26,
        { size: 16, align: 'left', color: slot.pp > 0 ? '#a8c4e8' : '#e07a6a' });
    }
    // info side
    const ix = 700, iw = 236;
    panel(ctx, ix, y, iw, h, { radius: 16 });
    const slot = moves[this.subCursor];
    if (slot) {
      const mv = getMove(slot.id);
      drawText(ctx, mv.name, ix + iw - 16, y + 32, { size: 20 });
      drawText(ctx, mv.cat === 'physical' ? 'פיזי' : mv.cat === 'special' ? 'מיוחד' : 'סטטוס',
        ix + iw - 16, y + 60, { size: 16, color: '#a8c4e8' });
      drawText(ctx, `עוצמה: ${mv.power || '—'}`, ix + iw - 16, y + 86, { size: 16, color: '#c8dcf5' });
      drawText(ctx, `דיוק: ${mv.acc == null ? '∞' : mv.acc}`, ix + iw - 16, y + 110, { size: 16, color: '#c8dcf5' });
      const eff = this.effHint(mv);
      if (eff) drawText(ctx, eff.text, ix + iw - 16, y + 138, { size: 15, color: eff.color });
    }
  }

  /** Shows effectiveness only for species the player has already caught —
   *  the Tracker Lens reward for filling the catalogue. */
  effHint(mv) {
    if (mv.cat === 'status') return null;
    const foe = this.shownFoe;
    if (!this.state.data.dex.caught[foe.species]) return null;
    const m = typeMultiplier(mv.type, getSpecies(foe.species).types);
    if (m === 0) return { text: 'ללא השפעה', color: '#8d93a6' };
    if (m > 1) return { text: 'סופר־אפקטיבי', color: '#8ef0b4' };
    if (m < 1) return { text: 'לא אפקטיבי', color: '#f0a08a' };
    return { text: 'נזק רגיל', color: '#c8dcf5' };
  }

  drawBagMenu(ctx) {
    const x = 24, y = 380, w = 912, h = 236;
    panel(ctx, x, y, w, h, { radius: 16 });
    drawText(ctx, 'תיק', x + w - 24, y + 36, { size: 24 });
    const items = this.state.itemList().filter((i) => getItem(i.id) && getItem(i.id).kind !== 'key');
    if (!items.length) {
      drawText(ctx, 'התיק ריק.', x + w - 24, y + 100, { size: 20, color: '#9db4d4' });
      return;
    }
    const perPage = 5;
    const start = clamp(this.subCursor - 2, 0, Math.max(0, items.length - perPage));
    for (let i = 0; i < Math.min(perPage, items.length); i++) {
      const idx = start + i;
      const it = items[idx];
      if (!it) break;
      const def = getItem(it.id);
      const by = y + 56 + i * 34;
      if (idx === this.subCursor) selection(ctx, x + 20, by - 22, w - 40, 30, this.t);
      ctx.save(); ctx.fillStyle = def.color;
      ctx.beginPath(); ctx.arc(x + w - 40, by - 7, 8, 0, 7); ctx.fill(); ctx.restore();
      drawText(ctx, def.name, x + w - 60, by, { size: 19 });
      drawText(ctx, `×${it.count}`, x + 40, by, { size: 18, align: 'left', color: '#a8c4e8' });
      if (idx === this.subCursor) {
        drawText(ctx, def.desc, x + w / 2, by + 0, { size: 15, color: '#9db4d4' });
      }
    }
  }

  drawPartyMenu(ctx) {
    const x = 24, y = 180, w = 912, h = 436;
    panel(ctx, x, y, w, h, { radius: 18 });
    drawText(ctx, this.itemTarget ? 'על מי להשתמש?' : this.forcedSwitch ? 'בחר יצור להחלפה' : 'הצוות שלך',
      x + w - 26, y + 40, { size: 24 });
    const party = this.battle.party;
    for (let i = 0; i < party.length; i++) {
      const c = party[i];
      const col = i % 2, row = (i / 2) | 0;
      const bx = x + 22 + (1 - col) * (w / 2 - 12);
      const by = y + 62 + row * 118;
      const bw = w / 2 - 34, bh = 106;
      if (i === this.cursor) selection(ctx, bx, by, bw, bh, this.t);
      panel(ctx, bx, by, bw, bh, {
        radius: 12, shadow: false,
        colors: c.hp > 0 ? ['rgba(30,44,72,.9)', 'rgba(16,24,42,.92)'] : ['rgba(60,30,36,.9)', 'rgba(30,16,20,.92)'],
      });
      drawMonsterIcon(ctx, c.species, bx + bw - 56, by + 52, 74, this.t + i);
      drawText(ctx, displayName(c), bx + bw - 106, by + 34,
        { size: fitSize(ctx, displayName(c), bw - 190, 20) });
      drawText(ctx, `Lv.${c.level}`, bx + 18, by + 34, { size: 17, align: 'left', color: '#a8c4e8' });
      const r = hpRatio(c);
      bar(ctx, bx + 18, by + 48, bw - 130, 12, r, { colors: hpColors(r) });
      drawNum(ctx, `${Math.max(0, c.hp)}/${c.stats.hp}`, bx + bw - 106, by + 82, { size: 16, color: '#c8dcf5' });
      if (c.status !== 'none') chip(ctx, STATUS[c.status].name, bx + 90, by + 68, STATUS[c.status].color, { size: 11 });
      if (i === this.battle.pIndex) {
        drawText(ctx, 'בזירה', bx + 18, by + 90, { size: 14, align: 'left', color: '#8ef0b4' });
      }
    }
  }

  drawLearnMenu(ctx) {
    const c = this.learnCreature;
    const x = 24, y = 330, w = 912, h = 286;
    panel(ctx, x, y, w, h, { radius: 16 });
    drawText(ctx, `איזה מהלך להחליף ב${getMove(this.learnMove).name}?`, x + w - 26, y + 40, { size: 22 });
    const options = [...c.moves.map((m) => getMove(m.id).name), 'לוותר'];
    options.forEach((name, i) => {
      const by = y + 68 + i * 40;
      if (i === this.cursor) selection(ctx, x + 24, by - 26, w - 48, 36, this.t);
      drawText(ctx, name, x + w - 46, by, { size: 20 });
      if (i < c.moves.length) {
        const mv = getMove(c.moves[i].id);
        chip(ctx, typeName(mv.type), x + 140, by - 20, typeColor(mv.type), { size: 11 });
        drawText(ctx, `עוצמה ${mv.power || '—'}`, x + 44, by, { size: 15, align: 'left', color: '#a8c4e8' });
      }
    });
  }

  drawBall(ctx) {
    const b = this.ballAnim;
    let x, y, rot = 0;
    if (b.phase === 'throw') {
      const k = clamp(b.t / 0.55, 0, 1);
      x = lerp(ME.x + 40, FOE.x, k);
      y = lerp(ME.y - 120, FOE.y - 90, k) - Math.sin(k * Math.PI) * 150;
      rot = k * 14;
    } else {
      x = FOE.x; y = FOE.y - 40;
      if (b.phase === 'wobble') {
        const w = Math.sin(b.t * 9) * Math.max(0, 1 - b.t / 0.6);
        rot = w * 0.5;
        y -= Math.abs(Math.sin(b.t * 9)) * 6;
      }
      if (b.phase === 'suck') y -= 20 * (1 - b.t / 0.45);
    }
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot);
    const r = 17;
    ctx.beginPath(); ctx.arc(0, 0, r, Math.PI, 0);
    ctx.fillStyle = b.color; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI);
    ctx.fillStyle = '#f2f4f8'; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 7);
    ctx.lineWidth = 3; ctx.strokeStyle = '#1b2130'; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0);
    ctx.lineWidth = 4; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, 7);
    ctx.fillStyle = '#e9eef7'; ctx.fill(); ctx.lineWidth = 2.6; ctx.stroke();
    ctx.restore();
    if (b.phase === 'caught') {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const k = clamp(b.t / 0.6, 0, 1);
      const g = ctx.createRadialGradient(x, y, 2, x, y, 40 + k * 90);
      g.addColorStop(0, 'rgba(255,240,180,.9)'); g.addColorStop(1, 'rgba(255,240,180,0)');
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 40 + k * 90, 0, 7); ctx.fill();
      ctx.restore();
    }
  }

  drawEvolve(ctx) {
    const k = this.evo.t;
    const cx = W / 2, cy = H / 2 + 40;
    ctx.save();
    ctx.fillStyle = 'rgba(4,8,18,.92)'; ctx.fillRect(0, 0, W, H);
    // radial light rays sweeping faster as the change approaches
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(cx, cy - 60);
    ctx.rotate(this.t * (1 + k * 6));
    for (let i = 0; i < 14; i++) {
      ctx.rotate(6.283 / 14);
      const g = ctx.createLinearGradient(0, 0, 0, -420);
      g.addColorStop(0, `rgba(255,236,170,${0.05 + k * 0.22})`);
      g.addColorStop(1, 'rgba(255,236,170,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(16, 0); ctx.lineTo(0, -420);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    const pulse = Math.abs(Math.sin(k * Math.PI * (3 + k * 14)));
    const species = k < 0.55 ? this.evo.from : this.evo.to;
    const scale = 1 + Math.sin(k * Math.PI) * 0.18;
    drawMonster(ctx, species, cx, cy, 300 * scale, {
      t: this.t, shadow: false,
      flash: k < 0.55 ? pulse : Math.max(0, 1 - (k - 0.55) * 4),
      flashColor: '#ffffff',
    });
    if (k > 0.5 && k < 0.72) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 1 - Math.abs(k - 0.6) / 0.12;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    ctx.restore();
  }
}
