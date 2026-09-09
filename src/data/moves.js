// Move table.  `fx` picks the battle animation, `eff` the mechanical rider.
//
// cat: physical | special | status
// acc: null == never misses

const M = (id, name, en, type, cat, power, acc, pp, fx, extra = {}) =>
  ({ id, name, en, type, cat, power, acc, pp, fx, priority: 0, ...extra });

export const MOVES = {
  // --- neutral -----------------------------------------------------------
  tackle:     M('tackle', 'נגיחה', 'Tackle', 'neutral', 'physical', 40, 100, 35, 'impact'),
  scratch:    M('scratch', 'שריטה', 'Scratch', 'neutral', 'physical', 40, 100, 35, 'slash'),
  quickjab:   M('quickjab', 'חוד מהיר', 'Quick Jab', 'neutral', 'physical', 40, 100, 30, 'impact', { priority: 1 }),
  slam:       M('slam', 'חבטה', 'Slam', 'neutral', 'physical', 80, 90, 15, 'impact'),
  hypersurge: M('hypersurge', 'גל־על', 'Hyper Surge', 'neutral', 'special', 140, 88, 5, 'beam', { eff: { recharge: true } }),
  swiftstar:  M('swiftstar', 'כוכב זריז', 'Swift Star', 'neutral', 'special', 60, null, 20, 'star'),
  growl:      M('growl', 'נהמה', 'Growl', 'neutral', 'status', 0, 100, 40, 'buff', { eff: { stat: { who: 'foe', stat: 'atk', stages: -1 } } }),
  harden:     M('harden', 'התקשות', 'Harden', 'neutral', 'status', 0, null, 30, 'buff', { eff: { stat: { who: 'self', stat: 'def', stages: 1 } } }),
  focusmind:  M('focusmind', 'ריכוז', 'Focus Mind', 'neutral', 'status', 0, null, 20, 'buff', { eff: { stat: { who: 'self', stat: 'spa', stages: 2 } } }),
  rest:       M('rest', 'תנומה', 'Rest', 'neutral', 'status', 0, null, 10, 'sparkle', { eff: { healSelf: 0.5 } }),
  screech:    M('screech', 'צווחה', 'Screech', 'neutral', 'status', 0, 85, 20, 'buff', { eff: { stat: { who: 'foe', stat: 'def', stages: -2 } } }),

  // --- ember -------------------------------------------------------------
  emberspit:  M('emberspit', 'ניצוץ', 'Ember Spit', 'ember', 'special', 40, 100, 25, 'flame', { eff: { status: 'burn', chance: 0.1 } }),
  flamefang:  M('flamefang', 'ניב לוהט', 'Flame Fang', 'ember', 'physical', 65, 95, 15, 'bite', { eff: { status: 'burn', chance: 0.15, flinch: 0.1 } }),
  firewheel:  M('firewheel', 'גלגל אש', 'Fire Wheel', 'ember', 'physical', 75, 100, 15, 'flame', { eff: { status: 'burn', chance: 0.1 } }),
  infernobeam:M('infernobeam', 'קרן תופת', 'Inferno Beam', 'ember', 'special', 100, 90, 8, 'beam', { eff: { status: 'burn', chance: 0.2 } }),
  sunflare:   M('sunflare', 'התלקחות', 'Sun Flare', 'ember', 'special', 120, 85, 5, 'burst', { eff: { statSelf: { stat: 'spa', stages: -1 } } }),

  // --- aqua --------------------------------------------------------------
  bubblejet:  M('bubblejet', 'סילון בועות', 'Bubble Jet', 'aqua', 'special', 40, 100, 30, 'splash', { eff: { stat: { who: 'foe', stat: 'spe', stages: -1 }, chance: 0.2 } }),
  aquapulse:  M('aquapulse', 'פעימת מים', 'Aqua Pulse', 'aqua', 'special', 65, 100, 20, 'wave', { eff: { confuse: 0.2 } }),
  tidalcrash: M('tidalcrash', 'נחשול', 'Tidal Crash', 'aqua', 'physical', 85, 95, 12, 'wave'),
  hydrolance: M('hydrolance', 'רומח מים', 'Hydro Lance', 'aqua', 'special', 110, 85, 6, 'beam'),
  mistveil:   M('mistveil', 'צעיף ערפל', 'Mist Veil', 'aqua', 'status', 0, null, 20, 'buff', { eff: { stat: { who: 'self', stat: 'spd', stages: 2 } } }),

  // --- verdant -----------------------------------------------------------
  leafcut:    M('leafcut', 'חיתוך עלה', 'Leaf Cut', 'verdant', 'physical', 45, 100, 30, 'leaf', { eff: { critBoost: 1 } }),
  seedvolley: M('seedvolley', 'מטח זרעים', 'Seed Volley', 'verdant', 'physical', 25, 100, 20, 'leaf', { eff: { multi: [2, 5] } }),
  vinelash:   M('vinelash', 'שוט גפן', 'Vine Lash', 'verdant', 'physical', 70, 100, 20, 'slash'),
  siphonroot: M('siphonroot', 'שורש יונק', 'Siphon Root', 'verdant', 'special', 60, 100, 15, 'leaf', { eff: { drain: 0.5 } }),
  bloomstorm: M('bloomstorm', 'סופת פריחה', 'Bloom Storm', 'verdant', 'special', 105, 88, 8, 'burst'),
  sporecloud: M('sporecloud', 'ענן נבגים', 'Spore Cloud', 'verdant', 'status', 0, 75, 12, 'poison', { eff: { status: 'sleep', chance: 1 } }),
  growshield: M('growshield', 'מגן קליפה', 'Bark Shield', 'verdant', 'status', 0, null, 20, 'buff', { eff: { stat: { who: 'self', stat: 'def', stages: 1 }, statSelf2: { stat: 'spd', stages: 1 } } }),

  // --- volt --------------------------------------------------------------
  sparkbite:  M('sparkbite', 'ניצוץ', 'Spark Bite', 'volt', 'physical', 45, 100, 25, 'shock', { eff: { status: 'para', chance: 0.2 } }),
  voltarc:    M('voltarc', 'קשת מתח', 'Volt Arc', 'volt', 'special', 70, 100, 18, 'shock', { eff: { status: 'para', chance: 0.15 } }),
  thunderlash:M('thunderlash', 'שוט רעם', 'Thunder Lash', 'volt', 'special', 105, 85, 8, 'beam', { eff: { status: 'para', chance: 0.25 } }),
  staticfield:M('staticfield', 'שדה סטטי', 'Static Field', 'volt', 'status', 0, 90, 20, 'shock', { eff: { status: 'para', chance: 1 } }),
  chargeup:   M('chargeup', 'טעינה', 'Charge Up', 'volt', 'status', 0, null, 20, 'buff', { eff: { stat: { who: 'self', stat: 'spe', stages: 2 } } }),

  // --- frost -------------------------------------------------------------
  chillbreath:M('chillbreath', 'הבל קפוא', 'Chill Breath', 'frost', 'special', 45, 100, 25, 'ice', { eff: { status: 'freeze', chance: 0.1 } }),
  frostshard: M('frostshard', 'רסיס קרח', 'Frost Shard', 'frost', 'physical', 55, 100, 20, 'ice', { priority: 1 }),
  glacierbeam:M('glacierbeam', 'קרן קרחון', 'Glacier Beam', 'frost', 'special', 95, 90, 8, 'beam', { eff: { status: 'freeze', chance: 0.12 } }),

  // --- stone -------------------------------------------------------------
  pebbletoss: M('pebbletoss', 'זריקת חלוק', 'Pebble Toss', 'stone', 'physical', 45, 95, 25, 'rock'),
  boulderdrop:M('boulderdrop', 'מפולת', 'Boulder Drop', 'stone', 'physical', 85, 85, 10, 'rock', { eff: { flinch: 0.2 } }),
  quakestep:  M('quakestep', 'רעידה', 'Quake Step', 'stone', 'physical', 100, 100, 8, 'quake'),
  sandveil:   M('sandveil', 'מסך חול', 'Sand Veil', 'stone', 'status', 0, 100, 15, 'buff', { eff: { stat: { who: 'foe', stat: 'acc', stages: -1 } } }),

  // --- gale --------------------------------------------------------------
  gustwing:   M('gustwing', 'משב כנף', 'Gust Wing', 'gale', 'special', 45, 100, 30, 'wind'),
  skydive:    M('skydive', 'צלילת שמיים', 'Sky Dive', 'gale', 'physical', 80, 95, 15, 'wind', { eff: { flinch: 0.15 } }),
  cyclone:    M('cyclone', 'ציקלון', 'Cyclone', 'gale', 'special', 100, 85, 8, 'wind', { eff: { confuse: 0.2 } }),

  // --- toxic -------------------------------------------------------------
  venomjab:   M('venomjab', 'דקירת ארס', 'Venom Jab', 'toxic', 'physical', 55, 100, 22, 'poison', { eff: { status: 'poison', chance: 0.3 } }),
  toxicmist:  M('toxicmist', 'ערפל רעיל', 'Toxic Mist', 'toxic', 'status', 0, 85, 12, 'poison', { eff: { status: 'poison', chance: 1 } }),
  sludgewave: M('sludgewave', 'גל רפש', 'Sludge Wave', 'toxic', 'special', 90, 100, 10, 'wave', { eff: { status: 'poison', chance: 0.2 } }),

  // --- umbra -------------------------------------------------------------
  shadownip:  M('shadownip', 'נשיכת צל', 'Shadow Nip', 'umbra', 'physical', 50, 100, 25, 'bite'),
  nightveil:  M('nightveil', 'לוט לילה', 'Night Veil', 'umbra', 'special', 70, 100, 15, 'shadow', { eff: { stat: { who: 'foe', stat: 'spd', stages: -1 }, chance: 0.2 } }),
  voidpulse:  M('voidpulse', 'פעימת תהום', 'Void Pulse', 'umbra', 'special', 95, 90, 8, 'shadow'),
  hex:        M('hex', 'קללה', 'Hex', 'umbra', 'special', 60, 100, 15, 'shadow', { eff: { doubleIfStatus: true } }),

  // --- lumen -------------------------------------------------------------
  lightmote:  M('lightmote', 'נִיצוֹץ אור', 'Light Mote', 'lumen', 'special', 45, 100, 25, 'sparkle'),
  psywave:    M('psywave', 'גל נפש', 'Psy Wave', 'lumen', 'special', 70, 100, 18, 'beam', { eff: { stat: { who: 'foe', stat: 'spd', stages: -1 }, chance: 0.2 } }),
  dazzleray:  M('dazzleray', 'קרן סנוור', 'Dazzle Ray', 'lumen', 'special', 100, 90, 8, 'beam', { eff: { confuse: 0.2 } }),
  lullaby:    M('lullaby', 'שיר ערש', 'Lullaby', 'lumen', 'status', 0, 65, 12, 'sparkle', { eff: { status: 'sleep', chance: 1 } }),
  mendlight:  M('mendlight', 'אור מרפא', 'Mending Light', 'lumen', 'status', 0, null, 8, 'sparkle', { eff: { healSelf: 0.5 } }),

  // --- metal -------------------------------------------------------------
  ironhead:   M('ironhead', 'ראש ברזל', 'Iron Head', 'metal', 'physical', 70, 100, 15, 'impact', { eff: { flinch: 0.25 } }),
  gearblade:  M('gearblade', 'להב גלגלים', 'Gear Blade', 'metal', 'physical', 90, 90, 10, 'slash', { eff: { critBoost: 1 } }),
  platearmor: M('platearmor', 'שריון לוחות', 'Plate Armor', 'metal', 'status', 0, null, 15, 'buff', { eff: { stat: { who: 'self', stat: 'def', stages: 2 } } }),

  // --- bug ---------------------------------------------------------------
  bugbite:    M('bugbite', 'נשיכת חרק', 'Bug Bite', 'bug', 'physical', 60, 100, 20, 'bite'),
  swarmvolley:M('swarmvolley', 'מטח נחיל', 'Swarm Volley', 'bug', 'physical', 25, 95, 20, 'impact', { eff: { multi: [2, 5] } }),
  silkbind:   M('silkbind', 'כבל משי', 'Silk Bind', 'bug', 'status', 0, 95, 20, 'buff', { eff: { stat: { who: 'foe', stat: 'spe', stages: -2 } } }),
  carapace:   M('carapace', 'שריון קשקש', 'Carapace', 'bug', 'status', 0, null, 20, 'buff', { eff: { stat: { who: 'self', stat: 'def', stages: 1 }, statSelf2: { stat: 'spd', stages: 1 } } }),
  hivebeam:   M('hivebeam', 'קרן נחיל', 'Hive Beam', 'bug', 'special', 95, 90, 8, 'beam', { eff: { stat: { who: 'foe', stat: 'spa', stages: -1 }, chance: 0.2 } }),
  pincercrush:M('pincercrush', 'מלתעות', 'Pincer Crush', 'bug', 'physical', 90, 90, 10, 'slash', { eff: { critBoost: 1 } }),

  // --- beast -------------------------------------------------------------
  clawrush:   M('clawrush', 'הסתערות טפרים', 'Claw Rush', 'beast', 'physical', 50, 100, 25, 'slash'),
  bodyblow:   M('bodyblow', 'מהלומה', 'Body Blow', 'beast', 'physical', 80, 95, 15, 'impact'),
  ragefist:   M('ragefist', 'אגרוף זעם', 'Rage Fist', 'beast', 'physical', 110, 80, 8, 'impact', { eff: { recoil: 0.25 } }),
  battlecry:  M('battlecry', 'קריאת קרב', 'Battle Cry', 'beast', 'status', 0, null, 20, 'buff', { eff: { stat: { who: 'self', stat: 'atk', stages: 2 } } }),
};

// Last resort when every move is out of PP.  Not in any learnset — the battle
// engine substitutes it so a creature can never be left unable to act.
MOVES.struggle = M('struggle', 'התאבקות', 'Struggle', 'neutral', 'physical', 50, null, 1, 'impact',
  { eff: { recoil: 0.25 }, ignoreType: true });

export const getMove = (id) => MOVES[id];
export const STRUGGLE = MOVES.struggle;
export const moveIds = Object.keys(MOVES);
