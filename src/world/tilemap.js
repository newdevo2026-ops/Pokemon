// Runtime view over a map definition: collision, warps, encounter lookup and
// the y-sorted draw list the overworld renderer consumes.

import { MAPS } from '../data/maps.js';
import { TILE, tileInfo } from './tiles.js';
import { pickWeighted } from '../core/util.js';

export class TileMap {
  constructor(id) {
    const def = MAPS[id];
    if (!def) throw new Error('unknown map ' + id);
    this.id = id;
    this.def = def;
    this.rows = def.rows;
    this.w = def.rows[0].length;
    this.h = def.rows.length;
    this.name = def.name;
    this.buildings = def.buildings || [];
    this.warps = def.warps || [];
    this.signs = def.signs || [];
  }

  char(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return ' ';
    return this.rows[y][x];
  }

  info(x, y) { return tileInfo(this.char(x, y)); }

  solid(x, y) { return !!this.info(x, y).solid; }

  ledgeAt(x, y) { return this.info(x, y).ledge || null; }

  warpAt(x, y) { return this.warps.find((w) => w.x === x && w.y === y) || null; }

  signAt(x, y) { return this.signs.find((s) => s.x === x && s.y === y) || null; }

  /** Encounter table entry for the tile the player is standing on, if any. */
  rollEncounter(x, y) {
    const kind = this.info(x, y).enc;
    if (!kind) return null;
    const table = this.def.encounters?.[kind];
    if (!table || !table.length) return null;
    return pickWeighted(table);
  }

  get pixelW() { return this.w * TILE; }
  get pixelH() { return this.h * TILE; }
}
