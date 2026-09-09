// Turn resolution.  The engine is pure logic: it mutates creatures and emits a
// flat list of events that the battle scene plays back with animation and
// timing.  Keeping the two apart makes the rules easy to read and to test.

import { getMove, STRUGGLE } from '../data/moves.js';
import { getSpecies } from '../data/species.js';
import { typeMultiplier, effectivenessLabel } from '../data/types.js';
import { getItem } from '../data/items.js';
import { displayName, expAward, gainExp } from '../game/creature.js';
import { clamp, chance, rangeInt, rndInt } from '../core/util.js';

const STAT_KEYS = ['atk', 'def', 'spa', 'spd', 'spe', 'acc', 'eva'];
const STAT_LABEL = {
  atk: 'ההתקפה', def: 'ההגנה', spa: 'ההתקפה המיוחדת',
  spd: 'ההגנה המיוחדת', spe: 'המהירות', acc: 'הדיוק', eva: 'ההתחמקות',
};

const freshStages = () => ({ atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 });
const freshVolatile = () => ({ confusion: 0, flinch: false, recharge: false });

function stageMul(n) { return n >= 0 ? (2 + n) / 2 : 2 / (2 - n); }
function accMul(n) { return n >= 0 ? (3 + n) / 3 : 3 / (3 - n); }

export class Battle {
  /**
   * @param o.party      the player's party array (mutated: hp, exp, levels)
   * @param o.foeParty   array of creatures for a trainer battle, or one wild
   * @param o.kind       'wild' | 'trainer'
   * @param o.trainer    { name, intro, defeat, reward, look }
   */
  constructor(o) {
    this.party = o.party;
    this.foeParty = o.foeParty;
    this.kind = o.kind;
    this.trainer = o.trainer || null;
    this.state = o.state;
    this.canRun = o.kind === 'wild';

    this.pIndex = this.party.findIndex((c) => c.hp > 0);
    this.fIndex = 0;
    this.stages = { player: freshStages(), foe: freshStages() };
    this.volatile = { player: freshVolatile(), foe: freshVolatile() };
    this.runAttempts = 0;
    this.participants = new Set();
    this.over = false;
    this.result = null;
    this.turn = 0;
  }

  get me() { return this.party[this.pIndex]; }
  get foe() { return this.foeParty[this.fIndex]; }
  actor(side) { return side === 'player' ? this.me : this.foe; }
  other(side) { return side === 'player' ? 'foe' : 'player'; }

  markParticipant() { if (this.me) this.participants.add(this.me.uid); }

  // ------------------------------------------------------------ helpers --
  effStat(side, key) {
    const c = this.actor(side);
    let v = c.stats[key] * stageMul(this.stages[side][key]);
    if (key === 'atk' && c.status === 'burn') v *= 0.5;
    if (key === 'spe' && c.status === 'para') v *= 0.5;
    return Math.max(1, Math.floor(v));
  }

  applyStage(side, key, delta, ev) {
    const s = this.stages[side];
    const before = s[key];
    s[key] = clamp(before + delta, -6, 6);
    const name = displayName(this.actor(side));
    const who = side === 'player' ? name : `${name} של היריב`;
    if (s[key] === before) {
      ev.push({ t: 'msg', text: `${STAT_LABEL[key]} של ${who} כבר לא ${delta > 0 ? 'יכולה לעלות' : 'יכולה לרדת'} יותר!` });
      return;
    }
    const word = delta > 0
      ? (delta >= 2 ? 'עלתה בחדות' : 'עלתה')
      : (delta <= -2 ? 'ירדה בחדות' : 'ירדה');
    ev.push({ t: 'stat', side, up: delta > 0 });
    ev.push({ t: 'msg', text: `${STAT_LABEL[key]} של ${who} ${word}!` });
  }

  setStatus(side, status, ev, force = false) {
    const c = this.actor(side);
    if (c.status !== 'none' && !force) return false;
    const sp = getSpecies(c.species);
    // simple immunity: a type resists its own affliction
    const immune = {
      burn: 'ember', freeze: 'frost', para: 'volt', poison: 'toxic',
    }[status];
    if (immune && sp.types.includes(immune)) return false;
    c.status = status;
    if (status === 'sleep') c.sleepTurns = rangeInt(1, 3);
    ev.push({ t: 'status', side, status });
    const name = displayName(c);
    const msg = {
      burn: `${name} נכווה!`, poison: `${name} הורעל!`, para: `${name} שותק!`,
      sleep: `${name} נרדם!`, freeze: `${name} קפא!`,
    }[status];
    ev.push({ t: 'msg', text: msg });
    return true;
  }

  damage(side, amount, ev, opts = {}) {
    const c = this.actor(side);
    const from = c.hp;
    c.hp = clamp(c.hp - Math.max(0, Math.floor(amount)), 0, c.stats.hp);
    ev.push({ t: 'hp', side, from, to: c.hp, max: c.stats.hp, ...opts });
    return from - c.hp;
  }

  heal(side, amount, ev) {
    const c = this.actor(side);
    const from = c.hp;
    c.hp = clamp(c.hp + Math.floor(amount), 0, c.stats.hp);
    if (c.hp !== from) ev.push({ t: 'hp', side, from, to: c.hp, max: c.stats.hp, heal: true });
    return c.hp - from;
  }

  // ------------------------------------------------------- damage maths --
  computeDamage(side, move) {
    const att = this.actor(side);
    const def = this.actor(this.other(side));
    const defTypes = getSpecies(def.species).types;
    const eff = move.ignoreType ? 1 : typeMultiplier(move.type, defTypes);
    if (eff === 0) return { dmg: 0, eff, crit: false };

    const eff2 = move.ignoreType ? 1 : eff;
    const physical = move.cat === 'physical';
    const A = this.effStat(side, physical ? 'atk' : 'spa');
    const D = this.effStat(this.other(side), physical ? 'def' : 'spd');
    let power = move.power;
    if (move.eff?.doubleIfStatus && def.status !== 'none') power *= 2;

    const critRate = 1 / (move.eff?.critBoost ? 8 : 24);
    const crit = chance(critRate);

    let dmg = Math.floor(Math.floor(Math.floor((2 * att.level) / 5 + 2) * power * A / D) / 50) + 2;
    if (crit) dmg *= 2;
    const stab = !move.ignoreType && getSpecies(att.species).types.includes(move.type) ? 1.5 : 1;
    dmg *= stab * eff2;
    dmg *= 0.85 + Math.random() * 0.15;
    return { dmg: Math.max(1, Math.floor(dmg)), eff, crit };
  }

  accuracyCheck(side, move) {
    if (move.acc == null) return true;
    const a = accMul(this.stages[side].acc) / accMul(this.stages[this.other(side)].eva);
    return Math.random() * 100 < move.acc * a;
  }

  // ------------------------------------------------------------- a turn --
  /**
   * @param action {type:'move',index} | {type:'item',id} | {type:'switch',index} | {type:'run'}
   * @returns event list
   */
  takeTurn(action) {
    const ev = [];
    this.turn++;
    this.markParticipant();

    // --- non-move player actions resolve first, then the foe attacks
    if (action.type === 'run') {
      if (this.tryRun(ev)) return ev;
      this.foePhase(ev);
      this.endOfTurn(ev);
      return ev;
    }
    if (action.type === 'item') {
      this.useItem(action, ev);
      if (this.over) return ev;
      this.foePhase(ev);
      this.endOfTurn(ev);
      return ev;
    }
    if (action.type === 'switch') {
      this.switchIn('player', action.index, ev);
      if (this.over) return ev;
      this.foePhase(ev);
      this.endOfTurn(ev);
      return ev;
    }

    // --- both sides picked a move: order by priority then speed
    const myMove = action.index < 0 ? STRUGGLE : getMove(this.me.moves[action.index].id);
    const foeMoveIndex = this.chooseFoeMove();
    const foeMove = foeMoveIndex < 0 ? STRUGGLE : getMove(this.foe.moves[foeMoveIndex].id);

    const mySpeed = this.effStat('player', 'spe');
    const foeSpeed = this.effStat('foe', 'spe');
    const myFirst = myMove.priority !== foeMove.priority
      ? myMove.priority > foeMove.priority
      : mySpeed !== foeSpeed ? mySpeed > foeSpeed : chance(0.5);

    const order = myFirst
      ? [['player', myMove, action.index], ['foe', foeMove, foeMoveIndex]]
      : [['foe', foeMove, foeMoveIndex], ['player', myMove, action.index]];

    for (const [side, move, idx] of order) {
      if (this.over) break;
      if (this.actor(side).hp <= 0) continue;
      this.performMove(side, move, idx, ev);
      this.checkFaints(ev);
    }
    if (!this.over) this.endOfTurn(ev);
    return ev;
  }

  /** The foe acts alone (after an item / switch / failed run). */
  foePhase(ev) {
    if (this.over || this.foe.hp <= 0) return;
    const idx = this.chooseFoeMove();
    this.performMove('foe', idx < 0 ? STRUGGLE : getMove(this.foe.moves[idx].id), idx, ev);
    this.checkFaints(ev);
  }

  performMove(side, move, idx, ev) {
    const c = this.actor(side);
    const vol = this.volatile[side];
    const name = displayName(c);
    const label = side === 'player' ? name : `${name} של היריב`;

    if (vol.recharge) {
      vol.recharge = false;
      ev.push({ t: 'msg', text: `${label} מתאושש מהמהלך הקודם…` });
      return;
    }
    // --- pre-move status gates
    if (c.status === 'sleep') {
      if (c.sleepTurns > 0) c.sleepTurns--;
      if (c.sleepTurns <= 0) {
        c.status = 'none';
        ev.push({ t: 'status', side, status: 'none' });
        ev.push({ t: 'msg', text: `${label} התעורר!` });
      } else {
        ev.push({ t: 'msg', text: `${label} ישן עמוק…` });
        return;
      }
    }
    if (c.status === 'freeze') {
      if (chance(0.2)) {
        c.status = 'none';
        ev.push({ t: 'status', side, status: 'none' });
        ev.push({ t: 'msg', text: `${label} הפשיר!` });
      } else {
        ev.push({ t: 'msg', text: `${label} קפוא ולא יכול לזוז!` });
        return;
      }
    }
    if (vol.flinch) {
      vol.flinch = false;
      ev.push({ t: 'msg', text: `${label} נרתע ולא הספיק לפעול!` });
      return;
    }
    if (c.status === 'para' && chance(0.25)) {
      ev.push({ t: 'msg', text: `${label} משותק ולא מסוגל לזוז!` });
      return;
    }
    if (vol.confusion > 0) {
      vol.confusion--;
      if (vol.confusion === 0) {
        ev.push({ t: 'msg', text: `${label} התנקה מהבלבול!` });
      } else {
        ev.push({ t: 'msg', text: `${label} מבולבל…` });
        if (chance(1 / 3)) {
          const self = Math.floor(
            Math.floor(Math.floor((2 * c.level) / 5 + 2) * 40 * this.effStat(side, 'atk') / this.effStat(side, 'def')) / 50) + 2;
          ev.push({ t: 'anim', fx: 'impact', side, type: 'neutral' });
          this.damage(side, self, ev, { self: true });
          ev.push({ t: 'msg', text: `${label} פגע בעצמו בבלבול!` });
          return;
        }
      }
    }

    // --- PP (Struggle, idx < 0, costs nothing)
    if (idx >= 0) {
      const slot = c.moves[idx];
      if (slot.pp <= 0) {
        ev.push({ t: 'msg', text: `${label} ניסה להשתמש במהלך — אבל אין נקודות שימוש!` });
        return;
      }
      slot.pp--;
    }
    ev.push({ t: 'msg', text: `${label} השתמש ב${move.name}!` });

    if (!this.accuracyCheck(side, move)) {
      ev.push({ t: 'msg', text: `${label} החטיא!` });
      return;
    }

    const foeSide = this.other(side);
    const target = this.actor(foeSide);

    // --- status moves
    if (move.cat === 'status') {
      ev.push({ t: 'anim', fx: move.fx, side, type: move.type, status: true });
      this.applyRiders(side, move, 0, ev, true);
      return;
    }

    // --- damaging moves
    const hits = move.eff?.multi ? rangeInt(move.eff.multi[0], move.eff.multi[1]) : 1;
    let total = 0;
    let eff = 1, crit = false;
    for (let i = 0; i < hits; i++) {
      if (target.hp <= 0) break;
      const r = this.computeDamage(side, move);
      eff = r.eff; crit = crit || r.crit;
      if (eff === 0) break;
      ev.push({ t: 'anim', fx: move.fx, side, type: move.type });
      total += this.damage(foeSide, r.dmg, ev, { crit: r.crit, eff: r.eff });
    }
    if (eff === 0) {
      ev.push({ t: 'msg', text: `זה לא משפיע על ${displayName(target)}…` });
      return;
    }
    if (hits > 1) ev.push({ t: 'msg', text: `נחת ${hits} פעמים!` });
    if (crit) ev.push({ t: 'msg', text: 'פגיעה קריטית!' });
    const lbl = effectivenessLabel(eff);
    if (lbl) ev.push({ t: 'msg', text: lbl });

    this.applyRiders(side, move, total, ev, false);
  }

  applyRiders(side, move, dealt, ev, isStatus) {
    const e = move.eff;
    if (!e) return;
    const foeSide = this.other(side);
    const roll = e.chance ?? 1;

    if (e.stat && (isStatus || chance(roll))) {
      const who = e.stat.who === 'self' ? side : foeSide;
      if (this.actor(who).hp > 0) this.applyStage(who, e.stat.stat, e.stat.stages, ev);
    }
    if (e.statSelf2) this.applyStage(side, e.statSelf2.stat, e.statSelf2.stages, ev);
    if (e.statSelf) this.applyStage(side, e.statSelf.stat, e.statSelf.stages, ev);

    if (e.status && chance(roll) && this.actor(foeSide).hp > 0) {
      this.setStatus(foeSide, e.status, ev);
    }
    if (e.confuse && chance(e.confuse)) {
      const v = this.volatile[foeSide];
      if (v.confusion === 0 && this.actor(foeSide).hp > 0) {
        v.confusion = rangeInt(2, 5);
        ev.push({ t: 'msg', text: `${displayName(this.actor(foeSide))} התבלבל!` });
      }
    }
    if (e.flinch && chance(e.flinch)) this.volatile[foeSide].flinch = true;
    if (e.drain && dealt > 0) {
      const got = this.heal(side, dealt * e.drain, ev);
      if (got > 0) ev.push({ t: 'msg', text: `${displayName(this.actor(side))} ספג אנרגיה!` });
    }
    if (e.recoil && dealt > 0) {
      this.damage(side, dealt * e.recoil, ev, { self: true });
      ev.push({ t: 'msg', text: `${displayName(this.actor(side))} נפגע מהריקול!` });
    }
    if (e.healSelf) {
      const c = this.actor(side);
      if (c.hp >= c.stats.hp) ev.push({ t: 'msg', text: 'אבל שום דבר לא קרה!' });
      else {
        this.heal(side, c.stats.hp * e.healSelf, ev);
        ev.push({ t: 'msg', text: `${displayName(c)} התאושש!` });
      }
    }
    if (e.recharge) this.volatile[side].recharge = true;
  }

  // ------------------------------------------------------ end of turn ----
  endOfTurn(ev) {
    for (const side of ['player', 'foe']) {
      const c = this.actor(side);
      if (!c || c.hp <= 0) continue;
      const label = side === 'player' ? displayName(c) : `${displayName(c)} של היריב`;
      if (c.status === 'burn') {
        this.damage(side, c.stats.hp / 16, ev, { self: true });
        ev.push({ t: 'msg', text: `${label} נפגע מהכווייה!` });
      } else if (c.status === 'poison') {
        this.damage(side, c.stats.hp / 8, ev, { self: true });
        ev.push({ t: 'msg', text: `${label} נפגע מהרעל!` });
      }
    }
    this.checkFaints(ev);
  }

  checkFaints(ev) {
    if (this.over) return;
    if (this.foe.hp <= 0) {
      ev.push({ t: 'faint', side: 'foe' });
      ev.push({ t: 'msg', text: `${displayName(this.foe)} של היריב התעלף!` });
      this.awardExp(ev);
      const next = this.foeParty.findIndex((c) => c.hp > 0);
      if (next === -1) {
        this.finishWin(ev);
      } else {
        this.fIndex = next;
        this.stages.foe = freshStages();
        this.volatile.foe = freshVolatile();
        ev.push({ t: 'msg', text: `${this.trainer?.name || 'היריב'} שולח את ${displayName(this.foe)}!` });
        ev.push({ t: 'sendout', side: 'foe', creature: this.foe });
      }
      return;
    }
    if (this.me.hp <= 0) {
      ev.push({ t: 'faint', side: 'player' });
      ev.push({ t: 'msg', text: `${displayName(this.me)} התעלף!` });
      const alive = this.party.some((c) => c.hp > 0);
      if (!alive) {
        this.over = true;
        this.result = 'lose';
        ev.push({ t: 'msg', text: 'אין לך עוד יצורים כשירים…' });
        ev.push({ t: 'end', result: 'lose' });
      } else {
        ev.push({ t: 'forceSwitch' });
      }
    }
  }

  finishWin(ev) {
    this.over = true;
    this.result = 'win';
    if (this.kind === 'trainer') {
      ev.push({ t: 'msg', text: this.trainer.defeat });
      ev.push({ t: 'msg', text: `קיבלת ${this.trainer.reward} מטבעות!` });
    }
    ev.push({ t: 'end', result: 'win' });
  }

  awardExp(ev) {
    const fainted = this.foe;
    const share = [...this.participants]
      .map((uid) => this.party.find((c) => c.uid === uid))
      .filter((c) => c && c.hp > 0);
    if (!share.length && this.me.hp > 0) share.push(this.me);
    const base = expAward(fainted, this.kind === 'trainer');
    const each = Math.max(1, Math.floor(base / Math.max(1, share.length)));
    for (const c of share) {
      const before = c.level;
      const res = gainExp(c, each);
      ev.push({ t: 'exp', creature: c, amount: each, result: res, fromLevel: before });
    }
  }

  // ----------------------------------------------------------- actions ---
  switchIn(side, index, ev) {
    if (side === 'player') {
      const out = this.me;
      if (out && out.hp > 0) ev.push({ t: 'msg', text: `חזור, ${displayName(out)}!` });
      ev.push({ t: 'withdraw', side: 'player' });
      this.pIndex = index;
      this.stages.player = freshStages();
      this.volatile.player = freshVolatile();
      ev.push({ t: 'msg', text: `קדימה, ${displayName(this.me)}!` });
      ev.push({ t: 'sendout', side: 'player', creature: this.me });
      this.markParticipant();
    }
  }

  useItem(action, ev) {
    const item = getItem(action.id);
    const target = action.targetIndex != null ? this.party[action.targetIndex] : this.me;
    ev.push({ t: 'msg', text: `השתמשת ב${item.name}.` });

    if (item.kind === 'ball') {
      this.throwBall(item, ev);
      return;
    }
    if (item.kind === 'heal') {
      const before = target.hp;
      target.hp = clamp(target.hp + item.hp, 0, target.stats.hp);
      if (target === this.me) ev.push({ t: 'hp', side: 'player', from: before, to: target.hp, heal: true });
      ev.push({ t: 'msg', text: `${displayName(target)} התאושש ב־${target.hp - before} נקודות חיים.` });
      if (item.cure === 'all') { target.status = 'none'; target.sleepTurns = 0; }
    } else if (item.kind === 'cure') {
      if (target.status === item.cure) {
        target.status = 'none'; target.sleepTurns = 0;
        ev.push({ t: 'msg', text: `${displayName(target)} החלים.` });
      } else ev.push({ t: 'msg', text: 'לא הייתה לזה שום השפעה…' });
    } else if (item.kind === 'revive') {
      if (target.hp <= 0) {
        target.hp = Math.max(1, Math.floor(target.stats.hp * item.ratio));
        ev.push({ t: 'msg', text: `${displayName(target)} חזר להכרה!` });
      } else ev.push({ t: 'msg', text: 'לא הייתה לזה שום השפעה…' });
    } else if (item.kind === 'pp') {
      const slot = target.moves.find((m) => m.pp < m.maxPp);
      if (slot) {
        slot.pp = Math.min(slot.maxPp, slot.pp + item.pp);
        ev.push({ t: 'msg', text: `נקודות השימוש של ${getMove(slot.id).name} התמלאו.` });
      } else ev.push({ t: 'msg', text: 'לא הייתה לזה שום השפעה…' });
    }
    this.state?.removeItem(action.id, 1);
  }

  throwBall(item, ev) {
    this.state?.removeItem(item.id, 1);
    if (this.kind === 'trainer') {
      ev.push({ t: 'msg', text: 'אסור לגנוב את היצורים של מאמן אחר!' });
      return;
    }
    const c = this.foe;
    const sp = getSpecies(c.species);
    const statusBonus = ['sleep', 'freeze'].includes(c.status) ? 2
      : ['para', 'poison', 'burn'].includes(c.status) ? 1.5 : 1;
    const a = ((3 * c.stats.hp - 2 * c.hp) * sp.catchRate * item.rate * statusBonus) / (3 * c.stats.hp);
    const shakesNeeded = 4;
    let shakes = 0;
    if (a >= 255) shakes = shakesNeeded;
    else {
      const b = 1048560 / Math.sqrt(Math.sqrt(16711680 / Math.max(1, a)));
      for (let i = 0; i < shakesNeeded; i++) {
        if (rndInt(65536) < b) shakes++; else break;
      }
    }
    const caught = shakes >= shakesNeeded;
    ev.push({ t: 'ball', item: item.id, shakes, caught });
    if (caught) {
      this.over = true;
      this.result = 'caught';
      ev.push({ t: 'msg', text: `${displayName(c)} נלכד!` });
      ev.push({ t: 'end', result: 'caught', creature: c });
    } else {
      const msg = shakes === 0 ? 'הוא השתחרר מיד!'
        : shakes === 1 ? 'כמעט… אבל הוא נמלט.'
        : shakes === 2 ? 'כל כך קרוב!'
        : 'עוד רגע והוא היה נתפס!';
      ev.push({ t: 'msg', text: msg });
    }
  }

  tryRun(ev) {
    if (this.kind === 'trainer') {
      ev.push({ t: 'msg', text: 'אי אפשר לברוח מקרב מאמנים!' });
      return false;
    }
    this.runAttempts++;
    const A = this.effStat('player', 'spe');
    const B = this.effStat('foe', 'spe');
    const F = B <= 0 ? 999 : ((A * 32) / Math.max(1, Math.floor(B / 4) % 256)) + 30 * this.runAttempts;
    if (rndInt(256) < F) {
      this.over = true;
      this.result = 'run';
      ev.push({ t: 'msg', text: 'ברחת בשלום!' });
      ev.push({ t: 'end', result: 'run' });
      return true;
    }
    ev.push({ t: 'msg', text: 'לא הצלחת לברוח!' });
    return false;
  }

  // ---------------------------------------------------------------- AI ---
  chooseFoeMove() {
    const c = this.foe;
    const usable = c.moves.map((m, i) => ({ i, m, def: getMove(m.id) })).filter((x) => x.m.pp > 0);
    if (!usable.length) return -1;   // out of PP -> Struggle

    const scored = usable.map((x) => {
      const mv = x.def;
      let score = 10;
      if (mv.cat === 'status') {
        score = 18;
        const e = mv.eff || {};
        if (e.status && this.me.status !== 'none') score = 2;
        if (e.healSelf && c.hp > c.stats.hp * 0.6) score = 2;
        if (e.stat?.who === 'self' && this.turn > 4) score = 8;
      } else {
        const eff = typeMultiplier(mv.type, getSpecies(this.me.species).types);
        const stab = getSpecies(c.species).types.includes(mv.type) ? 1.5 : 1;
        score = (mv.power || 40) * eff * stab / 10;
        if (eff === 0) score = 0;
        // finish the job when a KO is on the table
        const est = this.computeDamage('foe', mv).dmg;
        if (est >= this.me.hp) score += 40;
      }
      return { ...x, score: score * (0.85 + Math.random() * 0.3) };
    });
    scored.sort((a, b) => b.score - a.score);
    // a little imperfection keeps fights from feeling scripted
    if (scored.length > 1 && chance(0.12)) return scored[1].i;
    return scored[0].i;
  }
}
