// Pause menu and its sub-screens: party, summary, bag, catalogue, trainer card,
// save, plus the shop.  Everything is a stack of small screen descriptors so
// "back" is always just a pop.

import {
  panel, drawText, drawNum, bar, hpColors, selection, chip, wrapText, measure, fitSize,
} from '../gfx/ui.js';
import { drawMonster, drawMonsterIcon } from '../gfx/monster.js';
import { drawActor } from '../gfx/actor.js';
import { getSpecies, SPECIES, SPECIES_IDS } from '../data/species.js';
import { getMove } from '../data/moves.js';
import { getItem, SHOP_STOCK } from '../data/items.js';
import { typeColor, typeName } from '../data/types.js';
import { displayName, hpRatio, expToNext, STATUS } from '../game/creature.js';
import { clamp } from '../core/util.js';

const W = 960, H = 640;
const ROOT_ITEMS = [
  { id: 'party', label: 'צוות' },
  { id: 'bag', label: 'תיק' },
  { id: 'dex', label: 'קטלוג' },
  { id: 'card', label: 'כרטיס מאמן' },
  { id: 'save', label: 'שמירה' },
  { id: 'close', label: 'סגירה' },
];

export class MenuSystem {
  constructor(game) {
    this.game = game;
    this.state = game.state;
    this.audio = game.audio;
    this.stack = [];
    this.t = 0;
    this.toast = null;
    this.toastT = 0;
  }

  get open() { return this.stack.length > 0; }
  get top() { return this.stack[this.stack.length - 1]; }

  openRoot() {
    this.stack = [{ id: 'root', cursor: 0 }];
    this.audio.sfx('select');
  }
  openShop() {
    this.stack = [{ id: 'shop', cursor: 0, qty: 1, mode: 'buy' }];
    this.audio.sfx('select');
  }
  openParty(onPick) {
    this.stack = [{ id: 'party', cursor: 0, onPick }];
  }
  push(s) { this.stack.push(s); this.audio.sfx('select'); }
  pop() { this.stack.pop(); this.audio.sfx('back'); }
  closeAll() { this.stack = []; }

  say(text) { this.toast = text; this.toastT = 2.2; }

  update(dt, input) {
    this.t += dt;
    if (this.toastT > 0) this.toastT -= dt;
    if (!this.open) return;
    const s = this.top;
    switch (s.id) {
      case 'root': return this.updateRoot(s, input);
      case 'party': return this.updateParty(s, input);
      case 'summary': return this.updateSummary(s, input);
      case 'bag': return this.updateBag(s, input);
      case 'dex': return this.updateDex(s, input);
      case 'card': return this.updateSimple(s, input);
      case 'save': return this.updateSave(s, input);
      case 'shop': return this.updateShop(s, input);
      default: return this.pop();
    }
  }

  nav(s, input, count, cols = 1) {
    const d = input.pressedDirection();
    if (!d || count === 0) return false;
    let n = s.cursor;
    if (cols === 1) {
      if (d === 'up') n--;
      if (d === 'down') n++;
    } else {
      if (d === 'up') n -= cols;
      if (d === 'down') n += cols;
      if (d === 'left') n += 1;
      if (d === 'right') n -= 1;
    }
    n = clamp(n, 0, count - 1);
    if (n !== s.cursor) { s.cursor = n; this.audio.sfx('cursor'); return true; }
    return false;
  }

  // ------------------------------------------------------------- root ----
  updateRoot(s, input) {
    this.nav(s, input, ROOT_ITEMS.length);
    if (input.pressed('b')) { this.closeAll(); this.audio.sfx('back'); return; }
    if (!input.pressed('a')) return;
    const pick = ROOT_ITEMS[s.cursor].id;
    if (pick === 'close') { this.closeAll(); this.audio.sfx('back'); return; }
    if (pick === 'party') this.push({ id: 'party', cursor: 0 });
    else if (pick === 'bag') this.push({ id: 'bag', cursor: 0 });
    else if (pick === 'dex') this.push({ id: 'dex', cursor: 0 });
    else if (pick === 'card') this.push({ id: 'card' });
    else if (pick === 'save') this.push({ id: 'save', cursor: 0 });
  }

  // ------------------------------------------------------------ party ----
  updateParty(s, input) {
    const party = this.state.party;
    this.nav(s, input, party.length, 2);
    if (input.pressed('b')) {
      if (s.onPick) { s.onPick(null); this.closeAll(); }
      else this.pop();
      return;
    }
    if (!input.pressed('a') || !party.length) return;
    if (s.onPick) { const cb = s.onPick; this.closeAll(); cb(s.cursor); return; }
    if (s.swapFrom != null) {
      const a = s.swapFrom, b = s.cursor;
      [party[a], party[b]] = [party[b], party[a]];
      s.swapFrom = null;
      this.audio.sfx('select');
      return;
    }
    this.push({ id: 'summary', cursor: 0, index: s.cursor, page: 0 });
  }

  // ---------------------------------------------------------- summary ----
  updateSummary(s, input) {
    const party = this.state.party;
    if (input.pressed('b')) return this.pop();
    const d = input.pressedDirection();
    if (d === 'up' && s.index > 0) { s.index--; this.audio.sfx('cursor'); }
    if (d === 'down' && s.index < party.length - 1) { s.index++; this.audio.sfx('cursor'); }
    if (input.pressed('a')) { s.page = (s.page + 1) % 2; this.audio.sfx('cursor'); }
  }

  updateSimple(s, input) { if (input.pressed('a') || input.pressed('b')) this.pop(); }

  // -------------------------------------------------------------- bag ----
  updateBag(s, input) {
    const items = this.state.itemList();
    this.nav(s, input, items.length);
    if (input.pressed('b')) return this.pop();
    if (!input.pressed('a') || !items.length) return;
    const it = items[s.cursor];
    const def = getItem(it.id);
    if (!def) return;
    if (def.kind === 'heal' || def.kind === 'cure' || def.kind === 'revive' || def.kind === 'pp') {
      this.push({
        id: 'party', cursor: 0,
        onPick: (idx) => {
          if (idx == null) return;
          this.useItemOn(it.id, this.state.party[idx]);
          this.stack = [{ id: 'root', cursor: 1 }, { id: 'bag', cursor: clamp(s.cursor, 0, 99) }];
        },
      });
    } else {
      this.audio.sfx('bump');
      this.say('אי אפשר להשתמש בזה כאן.');
    }
  }

  useItemOn(itemId, c) {
    const def = getItem(itemId);
    if (!c) return;
    if (def.kind === 'heal') {
      if (c.hp <= 0) { this.say(`${displayName(c)} מעולף — צריך פריט תחייה.`); this.audio.sfx('bump'); return; }
      if (c.hp >= c.stats.hp) { this.say(`${displayName(c)} כבר במלוא הכוח.`); this.audio.sfx('bump'); return; }
      const before = c.hp;
      c.hp = clamp(c.hp + def.hp, 0, c.stats.hp);
      if (def.cure === 'all') { c.status = 'none'; c.sleepTurns = 0; }
      this.state.removeItem(itemId, 1);
      this.audio.sfx('heal');
      this.say(`${displayName(c)} התאושש ב־${c.hp - before} נ"ח.`);
    } else if (def.kind === 'cure') {
      if (c.status !== def.cure) { this.say('לא הייתה לזה השפעה.'); this.audio.sfx('bump'); return; }
      c.status = 'none'; c.sleepTurns = 0;
      this.state.removeItem(itemId, 1);
      this.audio.sfx('heal');
      this.say(`${displayName(c)} החלים.`);
    } else if (def.kind === 'revive') {
      if (c.hp > 0) { this.say('לא הייתה לזה השפעה.'); this.audio.sfx('bump'); return; }
      c.hp = Math.max(1, Math.floor(c.stats.hp * def.ratio));
      this.state.removeItem(itemId, 1);
      this.audio.sfx('heal');
      this.say(`${displayName(c)} חזר להכרה!`);
    } else if (def.kind === 'pp') {
      const slot = c.moves.find((m) => m.pp < m.maxPp);
      if (!slot) { this.say('לא הייתה לזה השפעה.'); this.audio.sfx('bump'); return; }
      slot.pp = Math.min(slot.maxPp, slot.pp + def.pp);
      this.state.removeItem(itemId, 1);
      this.audio.sfx('heal');
      this.say(`${getMove(slot.id).name} התמלא.`);
    }
  }

  // -------------------------------------------------------------- dex ----
  updateDex(s, input) {
    const list = SPECIES_IDS.filter((id) => this.state.data.dex.seen[id]);
    this.nav(s, input, Math.max(1, list.length), 3);
    if (input.pressed('b')) return this.pop();
  }

  // ------------------------------------------------------------- save ----
  updateSave(s, input) {
    const d = input.pressedDirection();
    if (d === 'up' || d === 'down') { s.cursor = 1 - s.cursor; this.audio.sfx('cursor'); }
    if (input.pressed('b')) return this.pop();
    if (input.pressed('a')) {
      if (s.cursor === 0) {
        this.game.save();
        this.audio.sfx('levelup');
        this.say('המסע נשמר ביומן.');
        this.stack = [];
      } else this.pop();
    }
  }

  // ------------------------------------------------------------- shop ----
  updateShop(s, input) {
    const stock = SHOP_STOCK;
    if (s.buying) {
      const d = input.pressedDirection();
      const def = getItem(stock[s.cursor]);
      const maxQty = Math.max(1, Math.min(99, Math.floor(this.state.money / def.price) || 1));
      if (d === 'up') { s.qty = clamp(s.qty + 1, 1, maxQty); this.audio.sfx('cursor'); }
      if (d === 'down') { s.qty = clamp(s.qty - 1, 1, maxQty); this.audio.sfx('cursor'); }
      if (input.pressed('b')) { s.buying = false; this.audio.sfx('back'); return; }
      if (input.pressed('a')) {
        const cost = def.price * s.qty;
        if (cost > this.state.money) { this.audio.sfx('bump'); this.say('אין לך מספיק מטבעות.'); return; }
        this.state.addMoney(-cost);
        this.state.addItem(def.id, s.qty);
        this.audio.sfx('buy');
        this.say(`קנית ${def.name} ×${s.qty}.`);
        s.buying = false; s.qty = 1;
      }
      return;
    }
    this.nav(s, input, stock.length);
    if (input.pressed('b')) { this.closeAll(); this.audio.sfx('back'); return; }
    if (input.pressed('a')) { s.buying = true; s.qty = 1; this.audio.sfx('select'); }
  }

  // ------------------------------------------------------------- draw ----
  draw(ctx) {
    if (!this.open) { this.drawToast(ctx); return; }
    ctx.save();
    ctx.fillStyle = 'rgba(6,10,20,.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    for (let i = 0; i < this.stack.length; i++) {
      const s = this.stack[i];
      const isTop = i === this.stack.length - 1;
      if (!isTop) continue;
      switch (s.id) {
        case 'root': this.drawRoot(ctx, s, true); break;
        case 'party': this.drawParty(ctx, s); break;
        case 'summary': this.drawSummary(ctx, s); break;
        case 'bag': this.drawBag(ctx, s); break;
        case 'dex': this.drawDex(ctx, s); break;
        case 'card': this.drawCard(ctx, s); break;
        case 'save': this.drawSave(ctx, s); break;
        case 'shop': this.drawShop(ctx, s); break;
        default: break;
      }
    }
    this.drawToast(ctx);
  }

  drawToast(ctx) {
    if (this.toastT <= 0 || !this.toast) return;
    const w = measure(ctx, this.toast, 20) + 56;
    const a = clamp(this.toastT, 0, 1);
    ctx.save(); ctx.globalAlpha = a;
    panel(ctx, (W - w) / 2, 60, w, 52, { radius: 26 });
    drawText(ctx, this.toast, (W + w) / 2 - 28, 94, { size: 20 });
    ctx.restore();
  }

  drawRoot(ctx, s, isTop) {
    const w = 260, h = ROOT_ITEMS.length * 56 + 26;
    const x = W - w - 26, y = 26;
    panel(ctx, x, y, w, h, { radius: 16 });
    ROOT_ITEMS.forEach((it, i) => {
      const by = y + 14 + i * 56;
      if (isTop && i === s.cursor) selection(ctx, x + 12, by, w - 24, 48, this.t);
      drawText(ctx, it.label, x + w - 26, by + 32, { size: 22, color: isTop && i === s.cursor ? '#fff' : '#c8dcf5' });
    });
    // money strip
    panel(ctx, x, y + h + 12, w, 52, { radius: 14 });
    drawText(ctx, 'מטבעות', x + w - 22, y + h + 46, { size: 18, color: '#a8c4e8' });
    drawText(ctx, `${this.state.money}`, x + 24, y + h + 46, { size: 20, align: 'left', color: '#ffd97a' });
  }

  drawParty(ctx, s) {
    const x = 26, y = 26, w = 660, h = 588;
    panel(ctx, x, y, w, h, { radius: 18 });
    drawText(ctx, s.onPick ? 'בחר יצור' : 'הצוות שלך', x + w - 26, y + 44, { size: 26 });
    const party = this.state.party;
    if (!party.length) {
      drawText(ctx, 'אין לך עדיין יצורים.', x + w - 26, y + 100, { size: 20, color: '#9db4d4' });
      return;
    }
    party.forEach((c, i) => {
      const col = i % 2, row = (i / 2) | 0;
      const bx = x + 22 + (1 - col) * (w / 2 - 12);
      const by = y + 62 + row * 170;
      const bw = w / 2 - 34, bh = 158;
      if (i === s.cursor) selection(ctx, bx, by, bw, bh, this.t);
      panel(ctx, bx, by, bw, bh, {
        radius: 14, shadow: false,
        colors: c.hp > 0 ? ['rgba(30,44,72,.92)', 'rgba(16,24,42,.94)'] : ['rgba(64,30,36,.92)', 'rgba(32,16,20,.94)'],
      });
      drawMonsterIcon(ctx, c.species, bx + bw - 60, by + 60, 90, this.t + i);
      drawText(ctx, displayName(c), bx + bw - 118, by + 40,
        { size: fitSize(ctx, displayName(c), bw - 200, 21) });
      drawText(ctx, `Lv.${c.level}`, bx + 18, by + 40, { size: 18, align: 'left', color: '#a8c4e8' });
      const r = hpRatio(c);
      bar(ctx, bx + 18, by + 58, bw - 140, 12, r, { colors: hpColors(r) });
      drawNum(ctx, `${Math.max(0, c.hp)} / ${c.stats.hp}`, bx + bw - 118, by + 92, { size: 17, color: '#c8dcf5' });
      let cx = bx + bw - 118;
      for (const t of getSpecies(c.species).types) {
        cx -= chip(ctx, typeName(t), cx, by + 104, typeColor(t), { size: 11 }) + 6;
      }
      if (c.status !== 'none') chip(ctx, STATUS[c.status].name, bx + 96, by + 104, STATUS[c.status].color, { size: 11 });
      const e = expToNext(c);
      bar(ctx, bx + 18, by + 138, bw - 36, 7, e.into / e.span, { colors: ['#8fd8ff', '#3a7fc4'] });
    });
    // detail strip
    const c = party[s.cursor];
    if (c) {
      const dx = x + w + 16, dw = W - dx - 26;
      panel(ctx, dx, y, dw, h, { radius: 18 });
      ctx.save();
      ctx.beginPath(); ctx.roundRect(dx + 4, y + 4, dw - 8, 282, 16); ctx.clip();
      drawMonster(ctx, c.species, dx + dw / 2, y + 262, 165, { t: this.t });
      ctx.restore();
      drawText(ctx, displayName(c), dx + dw - 24, y + 300,
        { size: fitSize(ctx, displayName(c), dw - 48, 24) });
      wrapText(ctx, getSpecies(c.species).flavor, dw - 48, 15)
        .forEach((ln, i) => drawText(ctx, ln, dx + dw - 24, y + 336 + i * 22, { size: 15, color: '#9db4d4' }));
      c.moves.forEach((m, i) => {
        const mv = getMove(m.id);
        const my = y + 430 + i * 42;
        panel(ctx, dx + 16, my, dw - 32, 36, { radius: 10, shadow: false, colors: ['rgba(28,40,64,.9)', 'rgba(16,24,40,.9)'] });
        drawText(ctx, mv.name, dx + dw - 30, my + 25, { size: 17 });
        drawNum(ctx, `${m.pp}/${m.maxPp}`, dx + 30, my + 25, { size: 15, align: 'left', color: '#a8c4e8' });
      });
    }
  }

  drawSummary(ctx, s) {
    const c = this.state.party[s.index];
    if (!c) return;
    const sp = getSpecies(c.species);
    panel(ctx, 26, 26, W - 52, H - 52, { radius: 18 });
    drawMonster(ctx, c.species, 220, 330, 320, { t: this.t });
    drawText(ctx, displayName(c), W - 60, 90, { size: 32 });
    drawText(ctx, `#${String(sp.dex).padStart(3, '0')}  ${sp.en}`, W - 60, 124, { size: 17, color: '#9db4d4' });
    let cx = W - 60;
    for (const t of sp.types) cx -= chip(ctx, typeName(t), cx, 140, typeColor(t), { size: 13 }) + 8;

    if (s.page === 0) {
      const stats = [
        ['נ"ח', 'hp'], ['התקפה', 'atk'], ['הגנה', 'def'],
        ['התקפה מיוחדת', 'spa'], ['הגנה מיוחדת', 'spd'], ['מהירות', 'spe'],
      ];
      stats.forEach(([label, key], i) => {
        const y = 220 + i * 48;
        drawText(ctx, label, W - 60, y, { size: 18, color: '#c8dcf5' });
        drawNum(ctx, `${c.stats[key]}`, 752, y, { size: 18, color: '#fff' });
        bar(ctx, 440, y - 15, 240, 14, clamp(c.stats[key] / 200, 0, 1), {
          colors: ['#8fd8ff', '#3a7fc4'],
        });
      });
      const e = expToNext(c);
      drawText(ctx, `רמה ${c.level}`, W - 60, 176, { size: 20, color: '#ffd97a' });
      drawText(ctx, `ניסיון לרמה הבאה: ${Math.max(0, e.next - c.exp)}`, 720, 176, { size: 16, color: '#9db4d4' });
      drawText(ctx, 'התקדמות לרמה הבאה', W - 60, 506, { size: 15, color: '#7f9dc4' });
      bar(ctx, 440, 520, 400, 12, e.into / e.span, { colors: ['#8fd8ff', '#3a7fc4'] });
      drawText(ctx, 'A — מהלכים · B — חזרה', W - 60, 570, { size: 15, color: '#7f9dc4' });
    } else {
      c.moves.forEach((m, i) => {
        const mv = getMove(m.id);
        const y = 200 + i * 84;
        panel(ctx, 450, y, 460, 72, { radius: 12, shadow: false, colors: ['rgba(28,40,64,.9)', 'rgba(16,24,40,.9)'] });
        drawText(ctx, mv.name, 890, y + 30, { size: 21 });
        chip(ctx, typeName(mv.type), 700, y + 12, typeColor(mv.type), { size: 12 });
        drawNum(ctx, `${m.pp}/${m.maxPp}`, 470, y + 30, { size: 16, align: 'left', color: '#a8c4e8' });
        drawText(ctx, `${mv.cat === 'physical' ? 'פיזי' : mv.cat === 'special' ? 'מיוחד' : 'סטטוס'} · דיוק ${mv.acc ?? '∞'} · עוצמה ${mv.power || '—'}`,
          890, y + 58, { size: 15, color: '#9db4d4' });
      });
      drawText(ctx, 'A — נתונים · B — חזרה', W - 60, 570, { size: 15, color: '#7f9dc4' });
    }
  }

  drawBag(ctx, s) {
    panel(ctx, 26, 26, W - 52, H - 52, { radius: 18 });
    drawText(ctx, 'תיק', W - 60, 80, { size: 28 });
    drawText(ctx, `${this.state.money} מטבעות`, 60, 80, { size: 20, align: 'left', color: '#ffd97a' });
    const items = this.state.itemList();
    if (!items.length) {
      drawText(ctx, 'התיק ריק.', W - 60, 160, { size: 20, color: '#9db4d4' });
      return;
    }
    const perPage = 9;
    const start = clamp(s.cursor - 4, 0, Math.max(0, items.length - perPage));
    for (let i = 0; i < Math.min(perPage, items.length - start); i++) {
      const idx = start + i;
      const it = items[idx];
      const def = getItem(it.id);
      const y = 130 + i * 46;
      if (idx === s.cursor) selection(ctx, 50, y - 30, W - 100, 40, this.t);
      ctx.save(); ctx.fillStyle = def.color;
      ctx.beginPath(); ctx.roundRect(W - 96, y - 24, 26, 26, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
      drawText(ctx, def.name, W - 110, y, { size: 20 });
      drawText(ctx, `×${it.count}`, 70, y, { size: 18, align: 'left', color: '#a8c4e8' });
    }
    const cur = items[clamp(s.cursor, 0, items.length - 1)];
    if (cur) {
      panel(ctx, 50, H - 130, W - 100, 76, { radius: 12, shadow: false, colors: ['rgba(28,40,64,.9)', 'rgba(16,24,40,.9)'] });
      drawText(ctx, getItem(cur.id).desc, W - 74, H - 86, { size: 18, color: '#c8dcf5' });
    }
  }

  drawDex(ctx, s) {
    panel(ctx, 26, 26, W - 52, H - 52, { radius: 18 });
    drawText(ctx, 'קטלוג היצורים', W - 60, 78, { size: 28 });
    drawText(ctx, `נצפו ${this.state.seenCount} · נלכדו ${this.state.caughtCount} מתוך ${SPECIES_IDS.length}`,
      60, 78, { size: 17, align: 'left', color: '#9db4d4' });
    const list = SPECIES_IDS.filter((id) => this.state.data.dex.seen[id]);
    if (!list.length) {
      drawText(ctx, 'עוד לא פגשת אף יצור.', W - 60, 160, { size: 20, color: '#9db4d4' });
      return;
    }
    const cols = 3, rows = 4, perPage = cols * rows;
    const page = Math.floor(s.cursor / perPage);
    for (let i = 0; i < perPage; i++) {
      const idx = page * perPage + i;
      if (idx >= list.length) break;
      const id = list[idx];
      const sp = SPECIES[id];
      const col = i % cols, row = (i / cols) | 0;
      const bw = 268, bh = 104;
      const bx = W - 60 - (col + 1) * (bw + 14) + 14;
      const by = 110 + row * (bh + 12);
      if (idx === s.cursor) selection(ctx, bx, by, bw, bh, this.t);
      panel(ctx, bx, by, bw, bh, { radius: 12, shadow: false, colors: ['rgba(28,40,64,.9)', 'rgba(16,24,40,.9)'] });
      const caught = this.state.data.dex.caught[id];
      drawMonsterIcon(ctx, id, bx + bw - 52, by + 52, 76, caught ? this.t + idx : 0, !caught);
      drawText(ctx, `#${String(sp.dex).padStart(3, '0')}`, bx + 16, by + 34, { size: 15, align: 'left', color: '#7f9dc4' });
      drawText(ctx, sp.name, bx + bw - 106, by + 40, { size: 19, color: caught ? '#fff' : '#93a6c2' });
      let cx = bx + bw - 106;
      for (const t of sp.types) cx -= chip(ctx, typeName(t), cx, by + 54, typeColor(t), { size: 10 }) + 5;
      if (caught) drawText(ctx, '●', bx + 16, by + 62, { size: 16, align: 'left', color: '#8ef0b4' });
    }
    drawText(ctx, `עמוד ${page + 1}/${Math.ceil(list.length / perPage)}`, W / 2, H - 66, { size: 16, color: '#7f9dc4' });
  }

  drawCard(ctx) {
    const d = this.state.data;
    panel(ctx, 140, 90, 680, 460, { radius: 22 });
    drawText(ctx, 'כרטיס מאמן', 780, 154, { size: 28 });
    drawActor(ctx, d.player.look, 260, 400, 'down', 0, 3.2);
    const rows = [
      ['שם', d.player.name],
      ['מטבעות', `${d.money}`],
      ['יצורים בצוות', `${d.party.length}`],
      ['נלכדו', `${this.state.caughtCount}`],
      ['נצפו', `${this.state.seenCount}`],
      ['צעדים', `${d.steps}`],
      ['זמן משחק', formatTime(d.playtime)],
    ];
    rows.forEach(([k, v], i) => {
      const y = 210 + i * 44;
      drawText(ctx, k, 780, y, { size: 19, color: '#a8c4e8' });
      drawText(ctx, v, 430, y, { size: 19, align: 'left', color: '#fff' });
    });
    drawText(ctx, 'לחץ על כל מקש כדי לחזור', 780, 520, { size: 15, color: '#7f9dc4' });
  }

  drawSave(ctx, s) {
    panel(ctx, 280, 210, 400, 220, { radius: 18 });
    drawText(ctx, 'לשמור את המסע?', 640, 270, { size: 24 });
    ['כן, שמור', 'לא עכשיו'].forEach((label, i) => {
      const y = 310 + i * 56;
      if (i === s.cursor) selection(ctx, 306, y, 348, 46, this.t);
      drawText(ctx, label, 630, y + 31, { size: 21, color: i === s.cursor ? '#fff' : '#c8dcf5' });
    });
  }

  drawShop(ctx, s) {
    panel(ctx, 26, 26, W - 52, H - 52, { radius: 18 });
    drawText(ctx, 'חנות המאמנים', W - 60, 78, { size: 28 });
    drawText(ctx, `${this.state.money} מטבעות`, 60, 78, { size: 20, align: 'left', color: '#ffd97a' });
    SHOP_STOCK.forEach((id, i) => {
      const def = getItem(id);
      const y = 128 + i * 42;
      if (i === s.cursor) selection(ctx, 50, y - 28, W - 100, 38, this.t);
      ctx.save(); ctx.fillStyle = def.color;
      ctx.beginPath(); ctx.roundRect(W - 96, y - 24, 26, 26, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
      drawText(ctx, def.name, W - 110, y, { size: 20 });
      drawText(ctx, `${def.price}`, 70, y, { size: 18, align: 'left', color: '#ffd97a' });
      drawText(ctx, `יש לך ${this.state.countItem(id)}`, 200, y, { size: 15, align: 'left', color: '#7f9dc4' });
    });
    const cur = getItem(SHOP_STOCK[s.cursor]);
    panel(ctx, 50, H - 136, W - 100, 82, { radius: 12, shadow: false, colors: ['rgba(28,40,64,.9)', 'rgba(16,24,40,.9)'] });
    drawText(ctx, cur.desc, W - 74, H - 100, { size: 18, color: '#c8dcf5' });
    drawText(ctx, 'B — יציאה', 74, H - 100, { size: 15, align: 'left', color: '#7f9dc4' });

    if (s.buying) {
      panel(ctx, 320, 230, 320, 180, { radius: 16 });
      drawText(ctx, cur.name, 610, 280, { size: 22 });
      drawText(ctx, `כמות: ${s.qty}`, 610, 322, { size: 20, color: '#c8dcf5' });
      drawText(ctx, `סה"כ: ${cur.price * s.qty}`, 610, 360, { size: 20, color: '#ffd97a' });
      drawText(ctx, '↑↓ כמות · A אישור · B ביטול', 610, 394, { size: 14, color: '#7f9dc4' });
    }
  }
}

export function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}
