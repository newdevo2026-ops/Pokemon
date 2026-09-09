// Creature instances: stats, experience, status, move slots.
// Formulas are deliberately close to the classic handheld RPG maths so the
// pacing feels familiar.

import { getSpecies } from '../data/species.js';
import { getMove } from '../data/moves.js';
import { clamp, rangeInt, rndInt } from '../core/util.js';

export const STATUS = {
  none: { name: '', short: '', color: null },
  burn: { name: 'כווייה', short: 'כוי', color: '#e8703c' },
  poison: { name: 'הרעלה', short: 'רעל', color: '#b263cf' },
  para: { name: 'שיתוק', short: 'שתק', color: '#e8cc44' },
  sleep: { name: 'שינה', short: 'שנה', color: '#7f92c9' },
  freeze: { name: 'קיפאון', short: 'קפא', color: '#7fdce8' },
};

const GROWTH = {
  fast: (n) => Math.floor((4 * n ** 3) / 5),
  medium: (n) => n ** 3,
  slow: (n) => Math.floor((5 * n ** 3) / 4),
};

export function expForLevel(growth, level) {
  return (GROWTH[growth] || GROWTH.medium)(Math.max(1, level));
}

export function calcStat(base, iv, level, isHp) {
  if (isHp) return Math.floor(((2 * base + iv) * level) / 100) + level + 10;
  return Math.floor(((2 * base + iv) * level) / 100) + 5;
}

export function recomputeStats(c) {
  const sp = getSpecies(c.species);
  const s = {};
  for (const k of ['hp', 'atk', 'def', 'spa', 'spd', 'spe']) {
    s[k] = calcStat(sp.base[k], c.ivs[k], c.level, k === 'hp');
  }
  c.stats = s;
  return s;
}

/** Moves the species knows at or below `level` — the last four learned. */
export function movesAtLevel(speciesId, level) {
  const sp = getSpecies(speciesId);
  const learned = sp.learn.filter(([lv]) => lv <= level).map(([, id]) => id);
  const uniq = [];
  for (const id of learned) if (!uniq.includes(id)) uniq.push(id);
  return uniq.slice(-4);
}

export function makeMoveSlot(id) {
  const m = getMove(id);
  return { id, pp: m.pp, maxPp: m.pp };
}

export function createCreature(speciesId, level, opts = {}) {
  const sp = getSpecies(speciesId);
  if (!sp) throw new Error('unknown species ' + speciesId);
  const c = {
    uid: Math.random().toString(36).slice(2, 10),
    species: speciesId,
    nickname: opts.nickname || null,
    level,
    exp: expForLevel(sp.growth, level),
    ivs: opts.ivs || {
      hp: rndInt(32), atk: rndInt(32), def: rndInt(32),
      spa: rndInt(32), spd: rndInt(32), spe: rndInt(32),
    },
    moves: (opts.moves || movesAtLevel(speciesId, level)).map(makeMoveSlot),
    status: 'none',
    sleepTurns: 0,
    hp: 0,
    stats: null,
    original: opts.original ?? true,
    met: opts.met || null,
    shiny: opts.shiny ?? (rndInt(512) === 0),
  };
  recomputeStats(c);
  c.hp = opts.hp ?? c.stats.hp;
  if (!c.moves.length) c.moves = [makeMoveSlot('tackle')];
  return c;
}

export const displayName = (c) => c.nickname || getSpecies(c.species).name;
export const isFainted = (c) => c.hp <= 0;
export const hpRatio = (c) => clamp(c.hp / c.stats.hp, 0, 1);

export function healFully(c) {
  recomputeStats(c);
  c.hp = c.stats.hp;
  c.status = 'none';
  c.sleepTurns = 0;
  for (const m of c.moves) m.pp = m.maxPp;
}

export function expToNext(c) {
  const sp = getSpecies(c.species);
  const cur = expForLevel(sp.growth, c.level);
  const next = expForLevel(sp.growth, c.level + 1);
  return { cur, next, into: c.exp - cur, span: Math.max(1, next - cur) };
}

/** EXP awarded for defeating `loser`. */
export function expAward(loser, isTrainer) {
  const sp = getSpecies(loser.species);
  return Math.max(1, Math.floor(((sp.baseExp * loser.level) / 7) * (isTrainer ? 1.5 : 1)));
}

/**
 * Adds exp and reports what happened so the battle scene can narrate it.
 * @returns {{levels:number[], learned:string[], pending:{move:string}[], evolve:string|null}}
 */
export function gainExp(c, amount) {
  const sp = getSpecies(c.species);
  const result = { levels: [], learned: [], pending: [], evolve: null, gained: amount };
  c.exp += amount;
  const cap = expForLevel(sp.growth, 100);
  if (c.exp > cap) c.exp = cap;
  while (c.level < 100 && c.exp >= expForLevel(sp.growth, c.level + 1)) {
    c.level++;
    const before = c.stats.hp;
    recomputeStats(c);
    c.hp += c.stats.hp - before;
    result.levels.push(c.level);
    for (const [lv, moveId] of sp.learn) {
      if (lv !== c.level) continue;
      if (c.moves.some((m) => m.id === moveId)) continue;
      if (c.moves.length < 4) { c.moves.push(makeMoveSlot(moveId)); result.learned.push(moveId); }
      else result.pending.push({ move: moveId });
    }
    if (sp.evolve && c.level >= sp.evolve.level) result.evolve = sp.evolve.to;
  }
  return result;
}

export function evolveInto(c, newSpecies) {
  const before = c.stats.hp;
  c.species = newSpecies;
  recomputeStats(c);
  c.hp = clamp(c.hp + (c.stats.hp - before), 1, c.stats.hp);
  const sp = getSpecies(newSpecies);
  for (const [lv, moveId] of sp.learn) {
    if (lv > c.level) continue;
    if (c.moves.some((m) => m.id === moveId)) continue;
    if (c.moves.length < 4) c.moves.push(makeMoveSlot(moveId));
  }
}

/** A wild creature drawn from an encounter-table entry. */
export function makeWild(entry) {
  const level = rangeInt(entry.min, entry.max);
  return createCreature(entry.species, level, { met: 'wild' });
}
