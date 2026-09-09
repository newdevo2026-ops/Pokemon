// The single mutable blob that defines a save file.

import { START } from '../data/maps.js';
import { healFully } from './creature.js';

export const SAVE_VERSION = 1;

export function newGame(name = 'ניר', look = 'hero') {
  return {
    version: SAVE_VERSION,
    player: { name, look, map: START.map, x: START.x, y: START.y, dir: START.dir },
    starter: null,
    party: [],
    box: [],
    bag: { ball: 0, potion: 0 },
    money: 3000,
    flags: {},
    dex: { seen: {}, caught: {} },
    respawn: { map: 'home', x: 5, y: 5 },
    playtime: 0,
    steps: 0,
  };
}

export class GameState {
  constructor(data) { this.data = data || newGame(); }

  get player() { return this.data.player; }
  get party() { return this.data.party; }
  get bag() { return this.data.bag; }
  get flags() { return this.data.flags; }

  flag(k) { return !!this.data.flags[k]; }
  setFlag(k, v = true) { this.data.flags[k] = v; }

  addItem(id, n = 1) { this.data.bag[id] = (this.data.bag[id] || 0) + n; }
  countItem(id) { return this.data.bag[id] || 0; }
  removeItem(id, n = 1) {
    const left = (this.data.bag[id] || 0) - n;
    if (left <= 0) delete this.data.bag[id];
    else this.data.bag[id] = left;
  }
  itemList() {
    return Object.entries(this.data.bag)
      .filter(([, n]) => n > 0)
      .map(([id, count]) => ({ id, count }));
  }

  addMoney(n) { this.data.money = Math.max(0, Math.min(999999, this.data.money + n)); }
  get money() { return this.data.money; }

  addToParty(creature) {
    if (this.data.party.length < 6) { this.data.party.push(creature); return 'party'; }
    this.data.box.push(creature);
    return 'box';
  }

  healParty() { for (const c of this.data.party) healFully(c); }

  firstHealthy() { return this.data.party.find((c) => c.hp > 0) || null; }
  partyWiped() { return this.data.party.length > 0 && this.data.party.every((c) => c.hp <= 0); }

  see(species) { this.data.dex.seen[species] = true; }
  catchDex(species) { this.data.dex.seen[species] = true; this.data.dex.caught[species] = true; }
  get seenCount() { return Object.keys(this.data.dex.seen).length; }
  get caughtCount() { return Object.keys(this.data.dex.caught).length; }
}
