// The overworld: grid movement with smooth interpolation, a y-sorted renderer,
// NPC behaviour and everything that can interrupt exploration (encounters,
// warps, trainers who spot you, ledges, pickups).

import { TileMap } from './tilemap.js';
import { TILE, tileInfo } from './tiles.js';
import { buildTerrainArt, groundTile, decoSprite, MATERIALS, FLIPPABLE, ART } from '../gfx/terrain.js';
import { drawActor } from '../gfx/actor.js';
import { Particles } from '../gfx/particles.js';
import { panel, drawText, vignette, measure } from '../gfx/ui.js';
import { getItem } from '../data/items.js';
import { makeWild } from '../game/creature.js';
import { talkToNpc, startTrainerBattle, finishTrainerBattle } from '../game/npcActions.js';
import { clamp, lerp, chance, hsl, easeOutCubic } from '../core/util.js';

const W = 960, H = 640;
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const WALK = 0.19, RUN = 0.115;

function makeEntity(o) {
  return {
    x: o.x, y: o.y, fromX: o.x, fromY: o.y, t: 1,
    dir: o.dir || 'down', look: o.look || 'villager',
    moving: false, dur: WALK, phase: 0, hop: 0,
    ...o,
  };
}

export class Overworld {
  constructor(game) {
    this.game = game;
    this.state = game.state;
    this.audio = game.audio;
    this.P = new Particles();
    this.cam = { x: 0, y: 0 };
    this.t = 0;
    this.banner = 0;
    this.fade = 0;
    this.fadeDir = 0;
    this.pendingWarp = null;
    this.cutscene = null;
    this.stepsSinceEncounter = 0;
    this.encounterCooldown = 0;
    this.busy = false;
    this.player = makeEntity({ x: 0, y: 0, look: this.state.data.player.look });
    buildTerrainArt();
    this.load(this.state.data.player.map, this.state.data.player.x,
              this.state.data.player.y, this.state.data.player.dir);
  }

  // ------------------------------------------------------------- loading --
  load(mapId, x, y, dir) {
    this.map = new TileMap(mapId);
    this.player.x = this.player.fromX = x;
    this.player.y = this.player.fromY = y;
    this.player.t = 1; this.player.moving = false;
    this.player.dir = dir || this.player.dir;
    this.player.look = this.state.data.player.look;
    this.state.data.player.map = mapId;
    this.state.data.player.x = x;
    this.state.data.player.y = y;
    this.state.data.player.dir = this.player.dir;

    this.npcs = (this.map.def.npcs || [])
      .filter((n) => !(n.hidden && this.state.flag(n.flag)))
      .map((n) => makeEntity({ ...n, home: { x: n.x, y: n.y }, cool: Math.random() * 3 }));
    // A guard whose condition is already met steps out of the doorway rather
    // than letting the player walk through them.
    for (const n of this.npcs) {
      if (!n.blockUntil || !this.state.flag(n.blockUntil)) continue;
      const spot = [[n.x - 1, n.y], [n.x + 1, n.y], [n.x, n.y + 1]]
        .find(([x, y]) => !this.map.solid(x, y) && !this.map.warpAt(x, y));
      if (spot) { n.x = n.fromX = spot[0]; n.y = n.fromY = spot[1]; n.home = { x: n.x, y: n.y }; }
    }

    this.items = (this.map.def.items || []).filter((i) => !this.state.flag(i.flag));
    this.banner = 2.6;
    this.P.clear();
    this.snapCamera();
    this.audio.play(this.map.def.music || 'town');
  }

  snapCamera() {
    const p = this.entityPixel(this.player);
    this.cam.x = this.clampCamX(p.x - W / 2);
    this.cam.y = this.clampCamY(p.y - H / 2);
  }
  clampCamX(v) {
    const max = this.map.pixelW - W;
    return max <= 0 ? max / 2 : clamp(v, 0, max);
  }
  clampCamY(v) {
    const max = this.map.pixelH - H;
    return max <= 0 ? max / 2 : clamp(v, 0, max);
  }

  entityPixel(e) {
    const k = e.moving ? easeOutCubic(e.t) : 1;
    return {
      x: lerp(e.fromX, e.x, k) * TILE + TILE / 2,
      y: lerp(e.fromY, e.y, k) * TILE + TILE - 6 - (e.hop || 0),
    };
  }

  // ------------------------------------------------------------- update --
  update(dt, input) {
    this.t += dt;
    this.P.update(dt);
    if (this.banner > 0) this.banner -= dt;
    if (this.encounterCooldown > 0) this.encounterCooldown -= dt;
    this.state.data.playtime += dt;

    if (this.fadeDir) {
      this.fade = clamp(this.fade + this.fadeDir * dt * 2.6, 0, 1);
      if (this.fadeDir > 0 && this.fade >= 1) {
        this.fadeDir = -1;
        if (this.pendingWarp) {
          const w = this.pendingWarp; this.pendingWarp = null;
          this.load(w.to, w.tx, w.ty, w.dir);
        } else if (this.afterFade) {
          const f = this.afterFade; this.afterFade = null; f();
        }
      } else if (this.fadeDir < 0 && this.fade <= 0) this.fadeDir = 0;
      this.updateEntities(dt);
      return;
    }

    const dlg = this.game.dialogue;
    const menus = this.game.menus;
    if (dlg.active) { dlg.update(dt, input); this.updateEntities(dt); return; }
    if (menus.open) { menus.update(dt, input); this.updateEntities(dt); return; }
    menus.update(dt, input);

    if (this.cutscene) { this.updateCutscene(dt); this.updateEntities(dt); return; }

    if (input.pressed('start')) { menus.openRoot(); return; }

    this.updatePlayer(dt, input);
    this.updateEntities(dt);
    this.updateSight();
    this.updateCamera(dt);
  }

  updatePlayer(dt, input) {
    const p = this.player;
    if (p.moving) {
      p.t += dt / p.dur;
      p.phase = clamp(p.t, 0, 1);
      if (p.hopTarget) p.hop = Math.sin(clamp(p.t, 0, 1) * Math.PI) * 34;
      if (p.t >= 1) {
        p.t = 1; p.moving = false; p.hop = 0; p.hopTarget = false;
        p.fromX = p.x; p.fromY = p.y;
        this.onStepComplete();
      }
      return;
    }
    if (input.pressed('a')) { this.interact(); return; }

    // A quick tap can start and end inside one frame, so fall back to the
    // just-pressed direction — otherwise short taps get swallowed.
    const d = input.direction() || input.pressedDirection();
    if (!d) { p.phase = 0; return; }
    if (p.dir !== d && !p.turnLock) {
      p.dir = d;
      p.turnLock = 0.07;
      return;
    }
    p.turnLock = 0;
    this.tryStep(d, input.held('run') && this.state.countItem('boots') > 0);
  }

  tryStep(dir, running) {
    const p = this.player;
    const [dx, dy] = DIRS[dir];
    const nx = p.x + dx, ny = p.y + dy;

    // one-way ledge hop
    const ledge = this.map.ledgeAt(nx, ny);
    if (ledge === 'down' && dir === 'down' && !this.blocked(nx, ny + 1)) {
      p.fromX = p.x; p.fromY = p.y;
      p.x = nx; p.y = ny + 1;
      p.moving = true; p.t = 0; p.dur = 0.34; p.hopTarget = true;
      this.audio.sfx('step');
      return;
    }
    if (this.blocked(nx, ny)) {
      if (!this.bumpCool) { this.audio.sfx('bump'); this.bumpCool = 0.3; }
      return;
    }
    p.fromX = p.x; p.fromY = p.y;
    p.x = nx; p.y = ny;
    p.moving = true; p.t = 0; p.dur = running ? RUN : WALK;
  }

  blocked(x, y) {
    if (x < 0 || y < 0 || x >= this.map.w || y >= this.map.h) return true;
    if (this.map.solid(x, y)) return true;
    // Ledges are one-way: the downward hop in tryStep() runs before this check,
    // so from every other direction the tile is a wall.
    if (this.map.ledgeAt(x, y)) return true;
    for (const n of this.npcs) {
      if (n.x === x && n.y === y) {
        if (n.blockUntil && this.state.flag(n.blockUntil)) continue;
        return true;
      }
    }
    return false;
  }

  onStepComplete() {
    const p = this.player;
    this.state.data.steps++;
    this.state.data.player.x = p.x;
    this.state.data.player.y = p.y;
    this.state.data.player.dir = p.dir;

    const info = this.map.info(p.x, p.y);
    if (info.tall) {
      this.P.burst(p.x * TILE + TILE / 2, p.y * TILE + TILE - 10, 6, {
        color: hsl(105, 55, 45), speed: 70, ttl: 0.4, size: 3, shape: 'leaf', ay: 120,
      });
      this.audio.sfx('step');
    }

    // ground pickup
    const item = this.items.find((i) => i.x === p.x && i.y === p.y);
    if (item) return this.pickUp(item);

    // warp
    const warp = this.map.warpAt(p.x, p.y);
    if (warp) {
      this.pendingWarp = warp;
      this.fadeDir = 1;
      this.audio.sfx('select');
      return;
    }

    // wild encounter
    if (this.encounterCooldown <= 0 && info.enc && this.state.party.some((c) => c.hp > 0)) {
      this.stepsSinceEncounter++;
      const p0 = 0.055 + this.stepsSinceEncounter * 0.012;
      if (chance(Math.min(0.26, p0))) {
        this.stepsSinceEncounter = 0;
        this.startWildEncounter();
      }
    }
  }

  pickUp(item) {
    const def = getItem(item.item);
    this.state.addItem(item.item, item.count || 1);
    this.state.setFlag(item.flag);
    this.items = this.items.filter((i) => i !== item);
    this.audio.sfx('levelup');
    this.game.dialogue.say([`מצאת ${def.name}!`], { speaker: null });
  }

  startWildEncounter() {
    const entry = this.map.rollEncounter(this.player.x, this.player.y);
    if (!entry) return;
    const wild = makeWild(entry);
    this.audio.sfx('encounter');
    this.game.startBattle({
      kind: 'wild',
      foeParty: [wild],
      terrain: this.map.def.cave ? 'cave' : 'grass',
    });
  }

  // ------------------------------------------------------------- NPCs ----
  updateEntities(dt) {
    if (this.bumpCool > 0) this.bumpCool -= dt;
    for (const n of this.npcs) {
      if (n.moving) {
        n.t += dt / n.dur;
        n.phase = clamp(n.t, 0, 1);
        if (n.t >= 1) { n.t = 1; n.moving = false; n.fromX = n.x; n.fromY = n.y; }
        continue;
      }
      n.phase = 0;
      if (this.cutscene || this.game.dialogue.active) continue;
      n.cool -= dt;
      if (n.cool > 0) continue;
      n.cool = 1.4 + Math.random() * 2.6;
      if (n.move === 'wander') {
        const dir = ['up', 'down', 'left', 'right'][Math.floor(Math.random() * 4)];
        const [dx, dy] = DIRS[dir];
        n.dir = dir;
        const nx = n.x + dx, ny = n.y + dy;
        if (Math.abs(nx - n.home.x) <= 2 && Math.abs(ny - n.home.y) <= 2 &&
            !this.blocked(nx, ny) && !(this.player.x === nx && this.player.y === ny)) {
          n.fromX = n.x; n.fromY = n.y; n.x = nx; n.y = ny;
          n.moving = true; n.t = 0; n.dur = 0.3;
        }
      } else if (n.move === 'lookaround') {
        n.dir = ['up', 'down', 'left', 'right'][Math.floor(Math.random() * 4)];
      }
    }
  }

  /** Trainers notice you when you walk into the line they are facing. */
  updateSight() {
    if (this.cutscene || this.game.dialogue.active || this.busy) return;
    for (const n of this.npcs) {
      if (!n.trainer || !n.sight) continue;
      if (this.state.flag(n.flag)) continue;
      const [dx, dy] = DIRS[n.dir];
      for (let i = 1; i <= n.sight; i++) {
        const tx = n.x + dx * i, ty = n.y + dy * i;
        if (this.map.solid(tx, ty)) break;
        if (this.player.x === tx && this.player.y === ty && !this.player.moving) {
          this.startTrainerApproach(n, i);
          return;
        }
      }
    }
  }

  startTrainerApproach(npc, distance) {
    this.audio.sfx('select');
    npc.alert = 1.2;
    this.cutscene = { npc, phase: 'alert', timer: 0.9, steps: Math.max(0, distance - 1) };
  }

  updateCutscene(dt) {
    const cs = this.cutscene;
    const npc = cs.npc;
    if (npc.alert > 0) npc.alert -= dt;
    if (cs.phase === 'alert') {
      cs.timer -= dt;
      if (cs.timer <= 0) cs.phase = 'walk';
      return;
    }
    if (cs.phase === 'walk') {
      if (npc.moving) return;
      if (cs.steps > 0) {
        const [dx, dy] = DIRS[npc.dir];
        npc.fromX = npc.x; npc.fromY = npc.y;
        npc.x += dx; npc.y += dy;
        npc.moving = true; npc.t = 0; npc.dur = 0.2;
        cs.steps--;
        return;
      }
      cs.phase = 'talk';
      this.player.dir = { up: 'down', down: 'up', left: 'right', right: 'left' }[npc.dir];
      this.game.dialogue.say([npc.trainer.intro], {
        speaker: npc.name, look: npc.look,
        onDone: () => {
          this.cutscene = null;
          this.startTrainerBattle(npc);
        },
      });
    }
  }

  // -------------------------------------------------------- interaction --
  facingTile() {
    const [dx, dy] = DIRS[this.player.dir];
    return { x: this.player.x + dx, y: this.player.y + dy };
  }

  interact() {
    const f = this.facingTile();
    let npc = this.npcs.find((n) => n.x === f.x && n.y === f.y);
    // Clerks and nurses stand behind a counter, so reach one tile further.
    if (!npc && this.map.info(f.x, f.y).deco === 'counter') {
      const [dx, dy] = DIRS[this.player.dir];
      npc = this.npcs.find((n) => n.x === f.x + dx && n.y === f.y + dy);
    }
    if (npc) return this.talkTo(npc);
    const sign = this.map.signAt(f.x, f.y);
    if (sign) {
      this.audio.sfx('cursor');
      return this.game.dialogue.say(sign.text.split('\n'));
    }
    const info = this.map.info(f.x, f.y);
    if (info.deco === 'pc') {
      return this.game.dialogue.say(['המסוף מציג את קטלוג היצורים שלך.',
        `נצפו ${this.state.seenCount} · נלכדו ${this.state.caughtCount}.`]);
    }
    if (info.deco === 'shelf') {
      return this.game.dialogue.say(['ספרים על אילוף יצורים, מסודרים לפי טיפוס.']);
    }
    if (info.water) {
      return this.game.dialogue.say(['המים צלולים ועמוקים מדי כדי לחצות אותם.']);
    }
  }

  talkTo(npc) {
    npc.dir = { up: 'down', down: 'up', left: 'right', right: 'left' }[this.player.dir];
    talkToNpc(this.npcHost(), npc);
  }

  /** Everything the shared NPC rules need to know about this world. */
  npcHost() {
    return {
      state: this.state, audio: this.audio, game: this.game,
      mapId: this.map.id, isCave: !!this.map.def.cave,
      removeNpc: (npc) => { this.npcs = this.npcs.filter((n) => n !== npc); },
      respawnPoint: () => ({ map: this.map.id, x: this.player.x, y: this.player.y }),
      onHeal: () => this.P.burst(W / 2, 200, 40,
        { color: '#8ef0b4', speed: 160, ttl: 1, size: 5, glow: true }),
    };
  }

  startTrainerBattle(npc) {
    this.pendingTrainer = npc;
    startTrainerBattle(this.npcHost(), npc);
  }

  /** Called by the game once a battle finishes. */
  onBattleEnd(result) {
    const npc = this.pendingTrainer;
    this.pendingTrainer = null;
    this.encounterCooldown = 1.2;
    if (result === 'lose') {
      const r = this.state.data.respawn;
      this.state.healParty();
      this.afterFade = () => {
        this.load(r.map, r.x, r.y, 'down');
        this.game.dialogue.say(['התעלפת… חזרת למקום מוגן והצוות שלך טופל.']);
      };
      this.fadeDir = 1;
      return;
    }
    if (npc && result === 'win') finishTrainerBattle(this.npcHost(), npc);
  }

  updateCamera(dt) {
    const p = this.entityPixel(this.player);
    const tx = this.clampCamX(p.x - W / 2);
    const ty = this.clampCamY(p.y - H / 2);
    const k = 1 - Math.pow(0.0006, dt);
    this.cam.x = lerp(this.cam.x, tx, k);
    this.cam.y = lerp(this.cam.y, ty, k);
  }

  // -------------------------------------------------------------- draw --
  draw(ctx) {
    const cx = Math.round(this.cam.x), cy = Math.round(this.cam.y);
    const x0 = Math.max(0, Math.floor(cx / TILE) - 1);
    const y0 = Math.max(0, Math.floor(cy / TILE) - 1);
    const x1 = Math.min(this.map.w - 1, Math.ceil((cx + W) / TILE));
    const y1 = Math.min(this.map.h - 1, Math.ceil((cy + H) / TILE));

    ctx.fillStyle = this.map.def.cave ? '#0a0d16' : '#25415e';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(-cx, -cy);

    // --- ground pass
    const waterFrame = Math.floor(this.t * 9);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const mat = this.groundAt(x, y);
        const img = groundTile(mat, x, y, waterFrame);
        if (!img) continue;
        const flip = FLIPPABLE.has(mat) ? (x * 7 + y * 13) % 4 : 0;
        if (!flip) { ctx.drawImage(img, x * TILE, y * TILE); continue; }
        ctx.save();
        ctx.translate(x * TILE + TILE / 2, y * TILE + TILE / 2);
        ctx.scale(flip & 1 ? -1 : 1, flip & 2 ? -1 : 1);
        ctx.drawImage(img, -TILE / 2, -TILE / 2);
        ctx.restore();
      }
    }
    // --- soft material edges
    this.drawEdges(ctx, x0, y0, x1, y1);

    // --- flat decorations
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const info = this.map.info(x, y);
        if (info.deco === 'flower') {
          const s = decoSprite('flower', x, y);
          if (s) ctx.drawImage(s, x * TILE, y * TILE);
        } else if (info.tall) {
          ctx.fillStyle = 'rgba(18,46,20,.26)';
          ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
        }
      }
    }

    // --- y-sorted layer
    const draws = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const ch = this.map.char(x, y);
        const info = tileInfo(ch);
        if (info.tall) {
          draws.push({ y: y * TILE + TILE - 2, kind: 'grass', x, ty: y });
        } else if (info.deco === 'cliff') {
          const below = this.map.info(x, y + 1).deco === 'cliff';
          draws.push({ y: y * TILE + TILE, kind: 'deco', name: below ? 'cliffbody' : 'cliff', x, ty: y });
        } else if (info.deco && info.deco !== 'flower') {
          draws.push({ y: y * TILE + TILE, kind: 'deco', name: info.deco, x, ty: y });
        }
      }
    }
    for (const b of this.map.buildings) draws.push({ y: (b.y + b.h) * TILE, kind: 'building', b });
    for (const it of this.items) draws.push({ y: it.y * TILE + TILE, kind: 'item', it });
    for (const n of this.npcs) {
      const p = this.entityPixel(n);
      draws.push({ y: p.y, kind: 'npc', n, p });
    }
    const pp = this.entityPixel(this.player);
    draws.push({ y: pp.y, kind: 'player', p: pp });

    draws.sort((a, b) => a.y - b.y);
    for (const d of draws) this.drawSorted(ctx, d);

    // --- front blades over the tile the player is standing in, so they are
    //     waist-deep in the grass rather than on top of it
    if (this.map.info(this.player.x, this.player.y).tall && !this.player.moving) {
      const gx = this.player.x, gy = this.player.y;
      ctx.save();
      ctx.beginPath();
      ctx.rect(gx * TILE, gy * TILE + TILE * 0.42, TILE, TILE * 0.62);
      ctx.clip();
      const frame = Math.floor((this.t * 4 + gx * 0.7 + gy * 0.4) % 8);
      const img = ART.deco.tallgrass[frame];
      ctx.drawImage(img, gx * TILE, gy * TILE + TILE - img.height);
      ctx.restore();
    }

    this.P.draw(ctx);
    ctx.restore();

    if (this.map.def.cave) this.drawCaveLight(ctx, pp, cx, cy);
    vignette(ctx, W, H, this.map.def.cave ? 0.5 : 0.34);
    this.drawHud(ctx);

    if (this.fade > 0) {
      ctx.fillStyle = `rgba(0,0,0,${this.fade})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  drawSorted(ctx, d) {
    switch (d.kind) {
      case 'grass': {
        const frame = Math.floor((this.t * 4 + d.x * 0.7 + d.ty * 0.4) % 8);
        const img = ART.deco.tallgrass[frame];
        ctx.drawImage(img, d.x * TILE, d.ty * TILE + TILE - img.height);
        break;
      }
      case 'deco': {
        const s = decoSprite(d.name, d.x, d.ty);
        if (!s) break;
        ctx.drawImage(s, d.x * TILE + (TILE - s.width) / 2, d.ty * TILE + TILE - s.height);
        break;
      }
      case 'building': this.drawBuilding(ctx, d.b); break;
      case 'item': this.drawGroundItem(ctx, d.it); break;
      case 'npc': {
        if (d.n.orb) this.drawOrb(ctx, d.p.x, d.p.y - 34);
        else drawActor(ctx, d.n.look, d.p.x, d.p.y, d.n.dir, d.n.phase, 1);
        if (d.n.alert > 0) this.drawAlert(ctx, d.p.x, d.p.y - 74);
        break;
      }
      case 'player':
        drawActor(ctx, this.state.data.player.look, d.p.x, d.p.y, this.player.dir, this.player.phase, 1);
        break;
      default: break;
    }
  }

  /** Surface painted under a tile.  Free-standing props (signs, boulders,
   *  fences) borrow the surface around them so they never sit on a stray
   *  square of dirt. */
  groundAt(x, y) {
    const info = this.map.info(x, y);
    if (info.inherit) {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1], [0, -1]]) {
        const n = this.map.info(x + dx, y + dy);
        if (!n.inherit && !n.void && !n.water) return n.ground;
      }
    }
    if (info.ground === 'void') return this.map.def.cave ? 'rock' : 'grass';
    return info.ground;
  }

  drawEdges(ctx, x0, y0, x1, y1) {
    ctx.save();
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const me = this.groundAt(x, y);
        const mm = MATERIALS[me];
        if (!mm) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const other = this.groundAt(x + dx, y + dy);
          const om = MATERIALS[other];
          if (!om || om.pri <= mm.pri) continue;
          const px = x * TILE, py = y * TILE;
          const g = dx
            ? ctx.createLinearGradient(px + (dx > 0 ? TILE : 0), 0, px + (dx > 0 ? TILE - 18 : 18), 0)
            : ctx.createLinearGradient(0, py + (dy > 0 ? TILE : 0), 0, py + (dy > 0 ? TILE - 18 : 18));
          g.addColorStop(0, om.avg + 'cc');
          g.addColorStop(1, om.avg + '00');
          ctx.fillStyle = g;
          ctx.fillRect(px, py, TILE, TILE);
        }
        // shoreline: a pale band inside water wherever it meets land, and a
        // touch of depth where it does not
        if (me === 'water') {
          let open = 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (this.groundAt(x + dx, y + dy) !== 'water') open++;
          }
          if (open === 0) {
            ctx.fillStyle = 'rgba(6,26,54,.22)';
            ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
          }
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (this.groundAt(x + dx, y + dy) === 'water') continue;
            const px = x * TILE, py = y * TILE;
            const g = dx
              ? ctx.createLinearGradient(px + (dx > 0 ? TILE : 0), 0, px + (dx > 0 ? TILE - 22 : 22), 0)
              : ctx.createLinearGradient(0, py + (dy > 0 ? TILE : 0), 0, py + (dy > 0 ? TILE - 22 : 22));
            g.addColorStop(0, 'rgba(190,235,250,.55)');
            g.addColorStop(1, 'rgba(190,235,250,0)');
            ctx.fillStyle = g;
            ctx.fillRect(px, py, TILE, TILE);
          }
        }
      }
    }
    ctx.restore();
  }

  drawBuilding(ctx, b) {
    const x = b.x * TILE, y = b.y * TILE;
    const w = b.w * TILE, h = b.h * TILE;
    const roofH = TILE * 1.15;
    const wallTop = y - roofH * 0.1;

    // wall
    const wg = ctx.createLinearGradient(x, wallTop, x, y + h);
    wg.addColorStop(0, hsl(b.wall > 50 ? 40 : b.wall, 18, 82));
    wg.addColorStop(1, hsl(b.wall > 50 ? 40 : b.wall, 16, 60));
    ctx.fillStyle = wg;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(30,24,20,.55)'; ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);

    // windows
    ctx.save();
    const cols = Math.max(1, b.w - 2);
    for (let i = 0; i < cols; i++) {
      const wx = x + TILE * 0.6 + i * ((w - TILE * 1.2) / Math.max(1, cols - 1 || 1));
      if (b.door != null && Math.abs(wx - (b.door * TILE + TILE / 2)) < TILE * 0.6) continue;
      const wy = y + h - TILE * 1.55;
      const g = ctx.createLinearGradient(wx - 16, wy, wx + 16, wy + 34);
      g.addColorStop(0, '#9ed8f0'); g.addColorStop(0.5, '#4f8fc0'); g.addColorStop(1, '#2c5c88');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(wx - 17, wy, 34, 34, 5); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = '#4a3a2c'; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx, wy + 34);
      ctx.moveTo(wx - 17, wy + 17); ctx.lineTo(wx + 17, wy + 17);
      ctx.lineWidth = 2.4; ctx.stroke();
    }
    ctx.restore();

    // door
    if (b.door != null) {
      const dx = b.door * TILE, dy = y + h - TILE;
      const dg = ctx.createLinearGradient(dx, dy, dx + TILE, dy + TILE);
      dg.addColorStop(0, hsl(26, 45, 40)); dg.addColorStop(1, hsl(24, 42, 26));
      ctx.fillStyle = dg;
      ctx.beginPath(); ctx.roundRect(dx + 6, dy + 2, TILE - 12, TILE - 2, [8, 8, 0, 0]); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = '#2c1f14'; ctx.stroke();
      ctx.fillStyle = '#e8c86a';
      ctx.beginPath(); ctx.arc(dx + TILE - 18, dy + TILE / 2, 3.6, 0, 7); ctx.fill();
    }

    // roof
    const overhang = TILE * 0.4;
    ctx.beginPath();
    ctx.moveTo(x - overhang, y + 6);
    ctx.lineTo(x + w / 2, y - roofH);
    ctx.lineTo(x + w + overhang, y + 6);
    ctx.closePath();
    const rg = ctx.createLinearGradient(x, y - roofH, x + w, y + 6);
    rg.addColorStop(0, hsl(b.roof, 45, 52));
    rg.addColorStop(0.5, hsl(b.roof, 48, 40));
    rg.addColorStop(1, hsl(b.roof, 42, 30));
    ctx.fillStyle = rg; ctx.fill();
    ctx.lineWidth = 3.4; ctx.strokeStyle = 'rgba(20,16,14,.6)'; ctx.stroke();
    // shingle lines
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x - overhang, y + 6); ctx.lineTo(x + w / 2, y - roofH);
    ctx.lineTo(x + w + overhang, y + 6); ctx.closePath(); ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,.16)'; ctx.lineWidth = 2;
    for (let i = 1; i < 7; i++) {
      const yy = y + 6 - (i / 7) * roofH;
      ctx.beginPath(); ctx.moveTo(x - overhang, yy); ctx.lineTo(x + w + overhang, yy); ctx.stroke();
    }
    ctx.restore();

    // Sign board hung on the wall, just under the eaves — keeping it inside the
    // building means it is on screen whenever the building is.
    if (b.label) {
      const tw = measure(ctx, b.label, 16) + 28;
      const ly = y + 10;
      panel(ctx, x + w / 2 - tw / 2, ly, tw, 32, {
        radius: 8, shadow: false,
        colors: ['rgba(20,30,50,.94)', 'rgba(12,20,36,.96)'],
        border: 'rgba(190,220,255,.35)',
      });
      drawText(ctx, b.label, x + w / 2 + tw / 2 - 14, ly + 23, { size: 16 });
    }
  }

  drawGroundItem(ctx, it) {
    const x = it.x * TILE + TILE / 2;
    const y = it.y * TILE + TILE - 20 + Math.sin(this.t * 3 + it.x) * 3;
    ctx.save();
    ctx.globalAlpha = 0.3; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(x, it.y * TILE + TILE - 6, 12, 5, 0, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
    const g = ctx.createLinearGradient(x - 12, y - 12, x + 12, y + 12);
    g.addColorStop(0, '#f6e3a2'); g.addColorStop(1, '#c9962f');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(x - 13, y - 11, 26, 22, 5); ctx.fill();
    ctx.lineWidth = 2.6; ctx.strokeStyle = '#6b4a12'; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - 11); ctx.lineTo(x, y + 11);
    ctx.moveTo(x - 13, y); ctx.lineTo(x + 13, y);
    ctx.lineWidth = 2.2; ctx.stroke();
    ctx.restore();
  }

  /** A hovering light — the apex creature before you approach it. */
  drawOrb(ctx, x, y) {
    const bob = Math.sin(this.t * 1.6) * 8;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const r = 26 + i * 22 + Math.sin(this.t * 2 + i) * 5;
      const g = ctx.createRadialGradient(x, y + bob, 2, x, y + bob, r);
      g.addColorStop(0, `rgba(255,248,208,${0.5 - i * 0.14})`);
      g.addColorStop(1, 'rgba(255,230,150,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y + bob, r, 0, 7); ctx.fill();
    }
    ctx.fillStyle = '#fffdf0';
    ctx.beginPath(); ctx.arc(x, y + bob, 9, 0, 7); ctx.fill();
    for (let i = 0; i < 6; i++) {
      const a = this.t * 1.3 + (i / 6) * 6.28;
      const rr = 30 + Math.sin(this.t * 3 + i) * 6;
      ctx.fillStyle = 'rgba(255,244,190,.75)';
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * rr, y + bob + Math.sin(a) * rr * 0.6, 2.6, 0, 7);
      ctx.fill();
    }
    ctx.restore();
  }

  drawAlert(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath(); ctx.roundRect(-13, -30, 26, 32, 8);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#1d2434'; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-6, 2); ctx.lineTo(6, 2); ctx.lineTo(0, 12); ctx.closePath();
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e0483f';
    ctx.fillRect(-3, -25, 6, 15);
    ctx.beginPath(); ctx.arc(0, -6, 3.4, 0, 7); ctx.fill();
    ctx.restore();
  }

  drawCaveLight(ctx, pp, cx, cy) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    const px = pp.x - cx, py = pp.y - cy - 30;
    const g = ctx.createRadialGradient(px, py, 40, px, py, 300);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.5, '#8f9ab4');
    g.addColorStop(1, '#38405c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  drawHud(ctx) {
    if (this.banner > 0) {
      const a = clamp(this.banner > 2.1 ? (2.6 - this.banner) / 0.5 : Math.min(1, this.banner / 0.6), 0, 1);
      const label = this.map.name;
      const w = measure(ctx, label, 24) + 64;
      ctx.save(); ctx.globalAlpha = a;
      panel(ctx, W - w - 26, 24, w, 56, { radius: 14 });
      drawText(ctx, label, W - 52, 60, { size: 24 });
      ctx.restore();
    }
    this.game.dialogue.draw(ctx);
    this.game.menus.draw(ctx);
  }
}
