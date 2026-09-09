// The 3D overworld: the same maps, NPCs, trainers, items and encounters as the
// 2D game, rendered as a low-poly world you walk around in. Creatures roam in
// the open — you see them coming, walk up, and the fight starts there.

import { Renderer, OrbitCamera } from './core/renderer.js';
import { Stack } from './core/mat4.js';
import { Terrain3D, buildProps, UNIT } from './world/terrain3d.js';
import { ModelRegistry } from './gfx/models.js';
import { buildActorMeshes, buildShadowMesh } from './gfx/actor3d.js';
import { TileMap } from '../src/world/tilemap.js';
import { getSpecies } from '../src/data/species.js';
import { getItem } from '../src/data/items.js';
import { typeName, typeColor } from '../src/data/types.js';
import { makeWild } from '../src/game/creature.js';
import { talkToNpc, startTrainerBattle, finishTrainerBattle } from '../src/game/npcActions.js';
import { panel, drawText, measure } from '../src/gfx/ui.js';
import { pickWeighted, rangeInt, clamp, lerp } from '../src/core/util.js';

const UI_W = 960, UI_H = 640;
const WALK = 9, RUN = 15.5, SWIM = 5.5;
const REACH = 4.6;              // how far you can talk / engage
const MAX_ROAMERS = 18;

export class World3D {
  constructor(game, canvas) {
    this.game = game;
    this.state = game.state;
    this.audio = game.audio;
    this.renderer = new Renderer(canvas);
    this.camera = new OrbitCamera();
    this.stack = new Stack();
    this.t = 0;
    this.banner = 0;
    this.mode = 'walk';
    this.focus = null;           // whatever pressing Z would act on
    this.actorCache = new Map();
    this.models = new ModelRegistry(this.renderer);
    this.models.init();
    this.shadowMesh = this.renderer.mesh(buildShadowMesh(1));
    this.pendingTrainer = null;
    this.bindPointer(canvas);

    const p = this.state.data.player;
    this.load(p.map, p.x, p.y);
  }

  // ------------------------------------------------------------- loading --
  load(mapId, tileX, tileZ) {
    const R = this.renderer;
    this.map = new TileMap(mapId);
    this.terrain = new Terrain3D(this.map);
    this.terrainMesh = R.mesh(this.terrain.build());
    const water = this.terrain.buildWater();
    this.waterMesh = water ? R.mesh(water) : null;
    this.propsMesh = R.mesh(buildProps(this.map, this.terrain));
    this.indoor = !!this.map.def.indoor;

    this.state.data.player.map = mapId;
    this.player = {
      x: tileX * UNIT + UNIT / 2, z: tileZ * UNIT + UNIT / 2,
      y: 0, facing: Math.PI, step: 0, moving: false,
    };
    this.player.y = this.terrain.heightAt(this.player.x, this.player.z);
    // Indoors the camera drops closer and looks further down, so low walls
    // frame the room instead of hiding it.
    this.camera.distance = this.indoor ? 30 : 38;
    this.camera.pitch = this.indoor ? 0.86 : 0.66;
    this.camera.follow = [this.player.x, this.player.y, this.player.z];

    this.npcs = (this.map.def.npcs || [])
      .filter((n) => !(n.hidden && this.state.flag(n.flag)))
      .map((n) => ({
        ...n,
        x: n.x * UNIT + UNIT / 2, z: n.y * UNIT + UNIT / 2,
        home: { x: n.x, z: n.y },
        y: this.terrain.heightAt(n.x * UNIT + UNIT / 2, n.y * UNIT + UNIT / 2),
        facing: { up: Math.PI, down: 0, left: -Math.PI / 2, right: Math.PI / 2 }[n.dir] ?? 0,
        alert: 0,
      }));
    for (const n of this.npcs) {
      if (!n.blockUntil || !this.state.flag(n.blockUntil)) continue;
      const spot = [[-1, 0], [1, 0], [0, 1]]
        .map(([dx, dz]) => ({ tx: n.home.x + dx, tz: n.home.z + dz }))
        .find((s) => !this.map.solid(s.tx, s.tz) && !this.map.warpAt(s.tx, s.tz));
      if (spot) { n.x = spot.tx * UNIT + UNIT / 2; n.z = spot.tz * UNIT + UNIT / 2; }
    }
    for (const n of this.npcs) this.actorMesh(n.look);
    this.actorMesh(this.state.data.player.look);

    this.items = (this.map.def.items || []).filter((i) => !this.state.flag(i.flag));

    this.encounterTable = this.map.def.encounters?.grass || this.map.def.encounters?.cave || [];
    this.roamers = [];
    this.spawnRoamers(MAX_ROAMERS);

    this.banner = 2.8;
    this.audio.play(this.map.def.music || 'town');
  }

  actorMesh(look) {
    if (!this.actorCache.has(look)) {
      const parts = buildActorMeshes(look);
      const out = {};
      for (const [k, v] of Object.entries(parts)) out[k] = this.renderer.mesh(v);
      this.actorCache.set(look, out);
    }
    return this.actorCache.get(look);
  }

  /** Warms whatever art this creature will use — imported or generated. */
  prepareCreature(species) { this.models.request(species); }

  storePlayerPosition() {
    const p = this.state.data.player;
    p.map = this.map.id;
    p.x = Math.floor(this.player.x / UNIT);
    p.y = Math.floor(this.player.z / UNIT);
  }

  // ------------------------------------------------------------- roamers --
  spawnRoamers(target) {
    if (!this.encounterTable.length) return;
    let guard = 0;
    while (this.roamers.length < target && guard++ < target * 60) {
      const tx = rangeInt(1, this.map.w - 2), tz = rangeInt(1, this.map.h - 2);
      const info = this.map.info(tx, tz);
      if (!info.enc || info.solid) continue;
      const x = tx * UNIT + UNIT / 2, z = tz * UNIT + UNIT / 2;
      if (this.player && (x - this.player.x) ** 2 + (z - this.player.z) ** 2 < 400) continue;
      const entry = pickWeighted(this.encounterTable);
      this.prepareCreature(entry.species);
      this.roamers.push({
        species: entry.species, level: rangeInt(entry.min, entry.max),
        x, z, y: this.terrain.heightAt(x, z), home: { x, z },
        facing: Math.random() * 6.28, phase: Math.random() * 6.28,
        target: null, cool: Math.random() * 3,
      });
    }
  }

  // --------------------------------------------------------------- input --
  bindPointer(canvas) {
    let dragging = false, lastX = 0;
    canvas.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; });
    addEventListener('pointerup', () => { dragging = false; });
    addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.camera.yaw -= (e.clientX - lastX) * 0.008;
      lastX = e.clientX;
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camera.distance = clamp(this.camera.distance + Math.sign(e.deltaY) * 2.5, 12, 60);
    }, { passive: false });
  }

  blocked(wx, wz) {
    const tx = Math.floor(wx / UNIT), tz = Math.floor(wz / UNIT);
    if (tx < 0 || tz < 0 || tx >= this.map.w || tz >= this.map.h) return true;
    const info = this.map.info(tx, tz);
    if (info.void) return true;
    if (info.solid && !info.water) return true;
    for (const n of this.npcs) {
      if (n.blockUntil && this.state.flag(n.blockUntil)) continue;
      if ((n.x - wx) ** 2 + (n.z - wz) ** 2 < 3.2) return true;
    }
    return false;
  }

  // -------------------------------------------------------------- update --
  update(dt, input) {
    this.t += dt;
    if (this.banner > 0) this.banner -= dt;
    this.state.data.playtime += dt;

    const D = this.game.dialogue, M = this.game.menus;
    if (D.active) { D.update(dt, input); this.animateNpcs(dt, true); return; }
    if (M.open) { M.update(dt, input); this.animateNpcs(dt, true); return; }
    M.update(dt, input);
    if (input.pressed('start')) { M.openRoot(); return; }
    if (input.pressed('a')) { this.interact(); return; }

    this.movePlayer(dt, input);
    this.animateNpcs(dt, false);
    this.updateRoamers(dt);
    this.updateSight();
    this.camera.update(this.player.x, this.player.y, this.player.z, dt);
  }

  movePlayer(dt, input) {
    const K = input;
    const { fx, fz, rx, rz } = this.camera.basis();
    let mx = 0, mz = 0;
    if (K.held('up')) { mx += fx; mz += fz; }
    if (K.held('down')) { mx -= fx; mz -= fz; }
    if (K.held('left')) { mx -= rx; mz -= rz; }
    if (K.held('right')) { mx += rx; mz += rz; }

    const p = this.player;
    const len = Math.hypot(mx, mz);
    const running = K.held('run') && this.state.countItem('boots') > 0;
    const speed = this.mode === 'swim' ? SWIM : running ? RUN : WALK;
    p.moving = len > 0.01;
    if (p.moving) {
      mx /= len; mz /= len;
      const nx = p.x + mx * speed * dt, nz = p.z + mz * speed * dt;
      if (!this.blocked(nx, p.z)) p.x = nx;
      if (!this.blocked(p.x, nz)) p.z = nz;
      p.facing = Math.atan2(mx, mz);
      p.step += dt * (running ? 11 : 7.5);
      this.state.data.steps += dt * 4;
    } else p.step += dt * 1.2;

    const tile = this.map.info(Math.floor(p.x / UNIT), Math.floor(p.z / UNIT));
    this.mode = tile.water ? 'swim' : 'walk';
    p.y = lerp(p.y, this.terrain.heightAt(p.x, p.z), 1 - Math.pow(0.0004, dt));

    this.checkTileTriggers();
    this.updateFocus();
  }

  checkTileTriggers() {
    const p = this.player;
    const tx = Math.floor(p.x / UNIT), tz = Math.floor(p.z / UNIT);

    const warp = this.map.warpAt(tx, tz);
    if (warp) {
      this.audio.sfx('select');
      this.game.fadeTo(() => this.load(warp.to, warp.tx, warp.ty));
      return;
    }
    const item = this.items.find((i) => i.x === tx && i.y === tz);
    if (item) {
      this.state.addItem(item.item, item.count || 1);
      this.state.setFlag(item.flag);
      this.items = this.items.filter((i) => i !== item);
      this.audio.sfx('levelup');
      this.game.dialogue.say([`מצאת ${getItem(item.item).name}!`]);
      return;
    }
    // walking into a roaming creature starts the fight
    if (this.state.party.some((c) => c.hp > 0)) {
      for (const r of this.roamers) {
        if ((r.x - p.x) ** 2 + (r.z - p.z) ** 2 < 4.4) { this.engage(r); return; }
      }
    }
  }

  updateFocus() {
    const p = this.player;
    let best = null, bestScore = Infinity;
    const consider = (obj, x, z, kind) => {
      const dx = x - p.x, dz = z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > REACH) return;
      // prefer whatever you are facing
      const dot = (dx / d) * Math.sin(p.facing) + (dz / d) * Math.cos(p.facing);
      const score = d - dot * 2.2;
      if (score < bestScore) { bestScore = score; best = { kind, obj }; }
    };
    for (const n of this.npcs) consider(n, n.x, n.z, 'npc');
    for (const r of this.roamers) consider(r, r.x, r.z, 'creature');
    for (const s of this.map.signs) consider(s, s.x * UNIT + UNIT / 2, s.y * UNIT + UNIT / 2, 'sign');
    this.focus = best;
  }

  interact() {
    const f = this.focus;
    if (!f) return;
    if (f.kind === 'sign') {
      this.audio.sfx('cursor');
      return this.game.dialogue.say(f.obj.text.split('\n'));
    }
    if (f.kind === 'creature') return this.engage(f.obj);
    const npc = f.obj;
    npc.facing = Math.atan2(this.player.x - npc.x, this.player.z - npc.z);
    talkToNpc(this.npcHost(), npc);
  }

  engage(roamer) {
    if (!this.state.party.some((c) => c.hp > 0)) {
      this.game.dialogue.say(['אין לך יצור כשיר להילחם בו.']);
      return;
    }
    this.roamers = this.roamers.filter((r) => r !== roamer);
    this.audio.sfx('encounter');
    const wild = makeWild({ species: roamer.species, min: roamer.level, max: roamer.level });
    this.game.startBattle({
      kind: 'wild', foeParty: [wild],
      terrain: this.map.def.cave ? 'cave' : 'grass',
    });
  }

  npcHost() {
    return {
      state: this.state, audio: this.audio, game: this.game,
      mapId: this.map.id, isCave: !!this.map.def.cave,
      removeNpc: (npc) => { this.npcs = this.npcs.filter((n) => n !== npc); },
      respawnPoint: () => ({
        map: this.map.id,
        x: Math.floor(this.player.x / UNIT), y: Math.floor(this.player.z / UNIT),
      }),
    };
  }

  // ----------------------------------------------------------------- npcs --
  animateNpcs(dt, frozen) {
    for (const n of this.npcs) {
      if (n.alert > 0) n.alert -= dt;
      if (frozen || !n.move) continue;
      n.cool = (n.cool ?? 0) - dt;
      if (n.cool > 0) continue;
      n.cool = 1.6 + Math.random() * 3;
      if (n.move === 'lookaround') n.facing = Math.random() * 6.28;
      else if (n.move === 'wander') {
        const a = Math.random() * 6.28;
        const nx = n.x + Math.cos(a) * UNIT, nz = n.z + Math.sin(a) * UNIT;
        const hx = n.home.x * UNIT + UNIT / 2, hz = n.home.z * UNIT + UNIT / 2;
        if (Math.hypot(nx - hx, nz - hz) < UNIT * 2 && !this.blocked(nx, nz)) {
          n.x = nx; n.z = nz; n.facing = a;
          n.y = this.terrain.heightAt(nx, nz);
        }
      }
    }
  }

  updateRoamers(dt) {
    for (const r of this.roamers) {
      r.cool -= dt;
      if (r.cool <= 0) {
        r.cool = 1.6 + Math.random() * 3.4;
        const a = Math.random() * 6.28, dist = 3 + Math.random() * 8;
        r.target = { x: r.home.x + Math.cos(a) * dist, z: r.home.z + Math.sin(a) * dist };
      }
      if (r.target) {
        const dx = r.target.x - r.x, dz = r.target.z - r.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.4) r.target = null;
        else {
          const step = Math.min(d, 2.8 * dt);
          const nx = r.x + (dx / d) * step, nz = r.z + (dz / d) * step;
          if (!this.blocked(nx, nz)) { r.x = nx; r.z = nz; r.facing = Math.atan2(dx, dz); }
          else r.target = null;
        }
      }
      r.y = lerp(r.y, this.terrain.heightAt(r.x, r.z), 1 - Math.pow(0.001, dt));
    }
    if (this.roamers.length < MAX_ROAMERS && Math.random() < dt * 0.25) {
      this.spawnRoamers(this.roamers.length + 1);
    }
  }

  /** Trainers challenge you when you cross the line they are watching. */
  updateSight() {
    if (this.game.dialogue.active) return;
    const p = this.player;
    for (const n of this.npcs) {
      if (!n.trainer || !n.sight || this.state.flag(n.flag)) continue;
      const dx = p.x - n.x, dz = p.z - n.z;
      const d = Math.hypot(dx, dz);
      if (d > n.sight * UNIT) continue;
      const dot = (dx / d) * Math.sin(n.facing) + (dz / d) * Math.cos(n.facing);
      if (dot < 0.86) continue;                       // must be roughly in front
      n.alert = 1.2;
      this.audio.sfx('select');
      this.game.dialogue.say([n.trainer.intro], {
        speaker: n.name, look: n.look,
        onDone: () => { this.pendingTrainer = n; startTrainerBattle(this.npcHost(), n); },
      });
      return;
    }
  }

  onBattleEnd(result) {
    const npc = this.pendingTrainer;
    this.pendingTrainer = null;
    if (result === 'lose') {
      const r = this.state.data.respawn;
      this.state.healParty();
      this.game.fadeTo(() => {
        this.load(r.map, r.x, r.y);
        this.game.dialogue.say(['התעלפת… חזרת למקום מוגן והצוות שלך טופל.']);
      });
      return;
    }
    if (npc && result === 'win') finishTrainerBattle(this.npcHost(), npc);
  }

  // ---------------------------------------------------------------- draw --
  render() {
    const R = this.renderer;
    R.beginFrame(this.camera);
    R.draw(this.terrainMesh, {});
    R.draw(this.propsMesh, {});

    const shade = (x, y, z, r) =>
      R.draw(this.shadowMesh, { x, y: y + 0.07, z, scale: r, alpha: 0.3, emissive: 1, tint: [0, 0, 0] });

    const p = this.player;
    shade(p.x, p.y, p.z, 0.95);
    for (const n of this.npcs) shade(n.x, n.y, n.z, 0.9);
    for (const r of this.roamers) {
      shade(r.x, r.y, r.z, 0.85 * (getSpecies(r.species).design.size ?? 1));
    }

    this.drawActor(this.state.data.player.look, p.x, p.y, p.z, p.facing, p.step,
      p.moving, this.mode === 'swim');
    for (const n of this.npcs) {
      this.drawActor(n.look, n.x, n.y, n.z, n.facing, this.t * 1.2, false, false);
    }
    for (const r of this.roamers) {
      const bob = Math.sin(this.t * 2.3 + r.phase) * 0.09;
      const lit = this.focus?.obj === r;
      this.models.draw(r.species, {
        x: r.x, y: r.y + bob, z: r.z, rotY: r.facing,
        tint: lit ? [1.3, 1.3, 1.18] : [1, 1, 1],
      });
    }
    for (const it of this.items) {
      const x = it.x * UNIT + UNIT / 2, z = it.y * UNIT + UNIT / 2;
      const y = this.terrain.heightAt(x, z) + 0.9 + Math.sin(this.t * 2 + it.x) * 0.15;
      shade(x, y - 0.9, z, 0.5);
      R.draw(this.shadowMesh, { x, y, z, scale: 0.55, rotY: this.t, tint: [1, 0.85, 0.35], emissive: 0.7 });
    }

    if (this.waterMesh) {
      R.depthWrite(false);
      R.draw(this.waterMesh, { alpha: 0.8, emissive: 0.18 });
      R.depthWrite(true);
    }
  }

  drawActor(look, x, y, z, facing, step, moving, swimming) {
    const R = this.renderer, s = this.stack;
    const parts = this.actorMesh(look);
    const swing = moving ? Math.sin(step) * 0.85 : Math.sin(this.t * 1.4) * 0.05;
    const bodyY = y + (swimming ? -0.6 : 0) + (moving ? Math.abs(Math.sin(step)) * 0.08 : 0);
    s.reset();
    s.translate(x, bodyY, z);
    s.rotateY(facing);
    R.drawMatrix(parts.body, s.m);
    for (const side of [-1, 1]) {
      s.push(); s.translate(side * 0.55, 1.78, 0); s.rotateX(swing * side);
      R.drawMatrix(parts.arm, s.m); s.pop();
      s.push(); s.translate(side * 0.22, 0.92, 0); s.rotateX(-swing * side);
      R.drawMatrix(parts.leg, s.m); s.pop();
    }
  }

  // ----------------------------------------------------------------- hud --
  drawHud(ctx) {
    if (this.banner > 0) {
      const a = clamp(this.banner > 2.3 ? (2.8 - this.banner) / 0.5 : Math.min(1, this.banner / 0.6), 0, 1);
      const w = measure(ctx, this.map.name, 24) + 60;
      ctx.save(); ctx.globalAlpha = a;
      panel(ctx, UI_W - w - 22, 20, w, 54, { radius: 14 });
      drawText(ctx, this.map.name, UI_W - 46, 55, { size: 24 });
      ctx.restore();
    }

    // party strip, so you always know what you are walking around with
    const party = this.state.party;
    if (party.length) {
      const h = 30 + party.length * 26;
      panel(ctx, 18, UI_H - h - 18, 208, h, { radius: 12 });
      drawText(ctx, 'הצוות', 208, UI_H - h + 4, { size: 15, color: '#9fc0e4' });
      party.forEach((c, i) => {
        const y = UI_H - h + 28 + i * 26;
        const r = Math.max(0, c.hp / c.stats.hp);
        drawText(ctx, getSpecies(c.species).name, 208, y, { size: 15 });
        drawText(ctx, `Lv.${c.level}`, 118, y, { size: 13, color: '#9fc0e4' });
        ctx.fillStyle = 'rgba(6,10,20,.8)';
        ctx.fillRect(32, y - 11, 78, 8);
        ctx.fillStyle = r > 0.5 ? '#4fd08a' : r > 0.2 ? '#e0c04a' : '#e06a5a';
        ctx.fillRect(32, y - 11, 78 * r, 8);
      });
    }

    if (this.focus && !this.game.dialogue.active && !this.game.menus.open) {
      const f = this.focus;
      if (f.kind === 'creature') {
        const sp = getSpecies(f.obj.species);
        panel(ctx, UI_W - 330, 92, 312, 96, { radius: 12 });
        drawText(ctx, `${sp.name} · רמה ${f.obj.level}`, UI_W - 36, 124, { size: 21 });
        let cx = UI_W - 36;
        for (const t of sp.types) {
          const label = typeName(t);
          const w = measure(ctx, label, 13) + 18;
          ctx.fillStyle = typeColor(t);
          ctx.beginPath(); ctx.roundRect(cx - w, 136, w, 22, 11); ctx.fill();
          drawText(ctx, label, cx - 9, 152, { size: 13, color: '#12161f', shadow: false });
          cx -= w + 6;
        }
        drawText(ctx, 'Z — להילחם', UI_W - 36, 180, { size: 15, color: '#8fe8ff' });
      } else {
        const label = f.kind === 'sign' ? 'Z — לקרוא את השלט' : `Z — לדבר עם ${f.obj.name}`;
        const w = measure(ctx, label, 17) + 44;
        panel(ctx, (UI_W - w) / 2, UI_H - 92, w, 44, { radius: 12 });
        drawText(ctx, label, (UI_W + w) / 2 - 22, UI_H - 62, { size: 17, color: '#8fe8ff' });
      }
    }

    drawText(ctx, 'WASD/חיצים · גרירה — מצלמה · Z — פעולה · Tab — תפריט · Shift — ריצה',
      UI_W / 2 + 250, UI_H - 14, { size: 13, color: 'rgba(190,215,245,.7)' });
  }
}
