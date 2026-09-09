// Elemental types. Original set — same spirit as the classics, own names/colours.

export const TYPES = {
  neutral: { name: 'ניטרלי',  en: 'Neutral', hue: 42,  color: '#b6ae9a' },
  ember:   { name: 'להבה',    en: 'Ember',   hue: 14,  color: '#f0653c' },
  aqua:    { name: 'מים',     en: 'Aqua',    hue: 205, color: '#4aa7f0' },
  verdant: { name: 'צומח',    en: 'Verdant', hue: 120, color: '#5cc25c' },
  volt:    { name: 'חשמל',    en: 'Volt',    hue: 50,  color: '#f5d040' },
  frost:   { name: 'כפור',    en: 'Frost',   hue: 186, color: '#84e0e6' },
  stone:   { name: 'סלע',     en: 'Stone',   hue: 28,  color: '#b98a54' },
  gale:    { name: 'רוח',     en: 'Gale',    hue: 195, color: '#a8cfe8' },
  toxic:   { name: 'רעל',     en: 'Toxic',   hue: 285, color: '#b263cf' },
  umbra:   { name: 'צל',      en: 'Umbra',   hue: 260, color: '#6b5a9e' },
  lumen:   { name: 'אור',     en: 'Lumen',   hue: 320, color: '#f28ab8' },
  metal:   { name: 'מתכת',    en: 'Metal',   hue: 210, color: '#9aa8b8' },
  beast:   { name: 'חיה',     en: 'Beast',   hue: 8,   color: '#c9603f' },
};

export const TYPE_IDS = Object.keys(TYPES);

// attacker -> { defender: multiplier }.  Anything omitted is 1x.
const X = {
  ember:   { verdant: 2, frost: 2, metal: 2, aqua: .5, stone: .5, ember: .5 },
  aqua:    { ember: 2, stone: 2, aqua: .5, verdant: .5, volt: .5 },
  verdant: { aqua: 2, stone: 2, verdant: .5, ember: .5, toxic: .5, gale: .5, metal: .5 },
  volt:    { aqua: 2, gale: 2, verdant: .5, volt: .5, stone: 0 },
  frost:   { verdant: 2, gale: 2, beast: 2, ember: .5, aqua: .5, frost: .5, metal: .5 },
  stone:   { ember: 2, volt: 2, toxic: 2, metal: 2, verdant: .5, aqua: .5 },
  gale:    { verdant: 2, beast: 2, volt: .5, stone: .5, metal: .5 },
  toxic:   { verdant: 2, lumen: 2, stone: .5, toxic: .5, metal: 0 },
  umbra:   { lumen: 2, umbra: 2, beast: .5, metal: .5 },
  lumen:   { toxic: 2, beast: 2, umbra: .5, metal: .5, lumen: .5 },
  metal:   { frost: 2, stone: 2, lumen: 2, ember: .5, aqua: .5, volt: .5, metal: .5 },
  beast:   { neutral: 2, frost: 2, stone: 2, metal: 2, umbra: 2, gale: .5, toxic: .5, lumen: 0 },
  neutral: { stone: .5, metal: .5, umbra: .5 },
};

export function typeMultiplier(attackType, defenderTypes) {
  const row = X[attackType] || {};
  let m = 1;
  for (const d of defenderTypes) m *= row[d] ?? 1;
  return m;
}

export function effectivenessLabel(m) {
  if (m === 0) return 'אין לזה שום השפעה…';
  if (m >= 4) return 'פגיעה הרסנית!';
  if (m > 1) return 'זה סופר-אפקטיבי!';
  if (m < 1) return 'זה לא ממש אפקטיבי…';
  return null;
}

export const typeColor = (t) => TYPES[t]?.color ?? '#999';
export const typeName = (t) => TYPES[t]?.name ?? t;
