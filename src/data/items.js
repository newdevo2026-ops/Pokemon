// Bag items.  `use` describes what happens when the item is applied to a
// creature; balls carry a capture rate instead.

export const ITEMS = {
  ball: {
    id: 'ball', name: 'ספֵרה', en: 'Sphere', kind: 'ball', rate: 1.0, price: 200,
    desc: 'כדור לכידה סטנדרטי.', color: '#e8503f',
  },
  greatball: {
    id: 'greatball', name: 'ספֵרה כפולה', en: 'Twin Sphere', kind: 'ball', rate: 1.5, price: 600,
    desc: 'סיכויי לכידה טובים יותר.', color: '#3f7fe8',
  },
  ultraball: {
    id: 'ultraball', name: 'ספֵרת עילית', en: 'Prime Sphere', kind: 'ball', rate: 2.0, price: 1200,
    desc: 'ביצועי לכידה מעולים.', color: '#e8c23f',
  },
  potion: {
    id: 'potion', name: 'שיקוי', en: 'Potion', kind: 'heal', hp: 30, price: 200,
    desc: 'מחזיר 30 נקודות חיים.', color: '#7fd6a8',
  },
  superpotion: {
    id: 'superpotion', name: 'שיקוי־על', en: 'Super Potion', kind: 'heal', hp: 70, price: 500,
    desc: 'מחזיר 70 נקודות חיים.', color: '#5fc0e0',
  },
  hyperpotion: {
    id: 'hyperpotion', name: 'שיקוי היפר', en: 'Hyper Potion', kind: 'heal', hp: 150, price: 1100,
    desc: 'מחזיר 150 נקודות חיים.', color: '#c48ce8',
  },
  fullrestore: {
    id: 'fullrestore', name: 'שיקום מלא', en: 'Full Restore', kind: 'heal', hp: 9999, cure: 'all', price: 2500,
    desc: 'מחזיר את כל החיים ומנקה כל מצב.', color: '#f0e08a',
  },
  antidote: {
    id: 'antidote', name: 'נוגדן', en: 'Antidote', kind: 'cure', cure: 'poison', price: 100,
    desc: 'מרפא הרעלה.', color: '#a970d8',
  },
  burnsalve: {
    id: 'burnsalve', name: 'משחת כווייה', en: 'Burn Salve', kind: 'cure', cure: 'burn', price: 100,
    desc: 'מרפא כווייה.', color: '#e88a5a',
  },
  awakener: {
    id: 'awakener', name: 'מעורר', en: 'Awakener', kind: 'cure', cure: 'sleep', price: 100,
    desc: 'מעיר יצור ישן.', color: '#8ab6f0',
  },
  sparkfree: {
    id: 'sparkfree', name: 'מנטרל שיתוק', en: 'Spark-Free', kind: 'cure', cure: 'para', price: 100,
    desc: 'מרפא שיתוק.', color: '#efd463',
  },
  thawdrop: {
    id: 'thawdrop', name: 'טיפת הפשרה', en: 'Thaw Drop', kind: 'cure', cure: 'freeze', price: 100,
    desc: 'מפשיר יצור קפוא.', color: '#8fe6ea',
  },
  revive: {
    id: 'revive', name: 'תחייה', en: 'Revive', kind: 'revive', ratio: 0.5, price: 1500,
    desc: 'מחזיר יצור מעולף עם חצי חיים.', color: '#f2c56b',
  },
  ether: {
    id: 'ether', name: 'אתר', en: 'Ether', kind: 'pp', pp: 10, price: 800,
    desc: 'ממלא 10 נקודות שימוש למהלך.', color: '#9ad4f0',
  },
  boots: {
    id: 'boots', name: 'מגפי ריצה', en: 'Runner Boots', kind: 'key', price: 0,
    desc: 'החזק Shift כדי לרוץ.', color: '#e0a06a',
  },
};

export const getItem = (id) => ITEMS[id];

export const SHOP_STOCK = ['ball', 'greatball', 'potion', 'superpotion', 'antidote',
  'burnsalve', 'awakener', 'sparkfree', 'revive'];
