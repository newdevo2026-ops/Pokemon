// Tile vocabulary.  Maps are authored as plain strings, one char per tile,
// which keeps the map files readable and diff-friendly.

export const TILE = 64;              // pixels per tile
export const VIEW_TILES_X = 15;      // 960 / 64
export const VIEW_TILES_Y = 10;      // 640 / 64

// ground: which surface is painted underneath
// solid:  blocks movement
// enc:    triggers wild encounters
// ledge:  one-way hop, value = allowed direction
export const TILES = {
  '.': { ground: 'grass' },
  '=': { ground: 'path' },
  's': { ground: 'sand' },
  'b': { ground: 'bridge' },
  'f': { ground: 'wood' },
  't': { ground: 'tilefloor' },
  'c': { ground: 'carpet' },
  '~': { ground: 'water', solid: true, water: true },
  'w': { ground: 'shallow', solid: true, water: true },

  ',': { ground: 'grass', enc: 'grass', tall: true },
  '"': { ground: 'sand', enc: 'sand', tall: true },
  ';': { ground: 'rock', enc: 'cave', dark: true },
  '*': { ground: 'grass', deco: 'flower' },
  '%': { ground: 'grass', deco: 'bush' },

  '#': { ground: 'grass', solid: true, deco: 'tree' },
  'T': { ground: 'grass', solid: true, deco: 'bigtree' },
  '^': { ground: 'rock', solid: true, deco: 'cliff' },
  'o': { ground: 'grass', solid: true, deco: 'boulder', inherit: true },
  'O': { ground: 'rock', solid: true, deco: 'boulder', inherit: true },
  '|': { ground: 'grass', solid: true, deco: 'fence', inherit: true },
  '-': { ground: 'grass', ledge: 'down' },
  'S': { ground: 'grass', solid: true, deco: 'sign', sign: true, inherit: true },
  'C': { ground: 'wood', solid: true, deco: 'counter' },
  'B': { ground: 'wood', solid: true, deco: 'shelf' },
  'M': { ground: 'tilefloor', solid: true, deco: 'machine' },
  'P': { ground: 'wood', solid: true, deco: 'pc' },
  'x': { ground: 'wood', solid: true, deco: 'crate' },
  'X': { ground: 'path', solid: true, deco: 'crate', inherit: true },
  'D': { ground: 'path', door: true },
  'd': { ground: 'wood', door: true },
  'H': { ground: 'grass', solid: true, deco: 'wall', inherit: true },
  'r': { ground: 'rock' },
  'R': { ground: 'rock', solid: true, deco: 'cliff' },
  ' ': { ground: 'void', solid: true, void: true },
};

export function tileInfo(ch) { return TILES[ch] || TILES[' ']; }
