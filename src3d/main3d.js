// 3D prototype: walk a real map from the 2D game in a low-poly world, with
// creatures roaming in the open that you can approach and engage.
//
// This is the foundation pass — terrain, camera, movement, creature meshes and
// world encounters. Battles, towns and the rest of the systems get ported on
// top of it.

import { Renderer, OrbitCamera } from './core/renderer.js';
import { Stack } from './core/mat4.js';
import { Terrain3D, buildProps, UNIT } from './world/terrain3d.js';
import { buildCreatureMesh, AURA_COLOR, hsl2rgb } from './gfx/creature3d.js';
import { buildActorMeshes, buildShadowMesh } from './gfx/actor3d.js';
import { TileMap } from '../src/world/tilemap.js';
import { getSpecies } from '../src/data/species.js';
import { typeName, typeColor } from '../src/data/types.js';
import { pickWeighted, rangeInt, clamp } from '../src/core/util.js';

const MOVE_SPEED = 9;
const RUN_SPEED = 16;
const SWIM_SPEED = 5;

export class World3D {
  constructor(canvas, overlay, mapId = 'route1') {
    this.canvas = canvas;
    this.overlay = overlay;
    this.ctx2d = overlay.getContext('2d');
    this.renderer = new Renderer(canvas);
    this.camera = new OrbitCamera();
    this.stack = new Stack();
    this.t = 0;
    this.keys = new Set();
    this.mode = 'walk';           // walk | swim
    this.nearby = null;
    this.message = '';
    this.messageT = 0;
    this.bindInput();
    this.load(mapId);
  }

  // ------------------------------------------------------------- loading --
  load(mapId) {
    const R = this.renderer;
    this.map = new TileMap(mapId);
    this.terrain = new Terrain3D(this.map);
    this.terrainMesh = R.mesh(this.terrain.build());
    const water = this.terrain.buildWater();
    this.waterMesh = water ? R.mesh(water) : null;
    this.propsMesh = R.mesh(buildProps(this.map, this.terrain));
    this.shadowMesh = R.mesh(buildShadowMesh(1));

    this.actor = {};
    for (const [k, v] of Object.entries(buildActorMeshes('hero'))) this.actor[k] = R.mesh(v);

    // one mesh per species that can appear here
    this.creatureMeshes = new Map();
    const table = this.map.def.encounters?.grass || this.map.def.encounters?.cave || [];
    this.encounterTable = table;
    for (const e of table) {
      if (!this.creatureMeshes.has(e.species)) {
        this.creatureMeshes.set(e.species, R.mesh(buildCreatureMesh(e.species)));
      }
    }

    // spawn point: first walkable tile near the middle
    const start = this.findSpawn();
    this.player = {
      x: start.x * UNIT + UNIT / 2, z: start.z * UNIT + UNIT / 2,
      y: 0, facing: 0, step: 0, speed: 0,
    };
    this.player.y = this.terrain.heightAt(this.player.x, this.player.z);

    this.creatures = [];
    this.spawnCreatures(16);
    this.spawnNearPlayer(3);
    this.message = this.map.name;
    this.messageT = 3;
  }

  findSpawn() {
    const cx = Math.floor(this.map.w / 2), cz = Math.floor(this.map.h / 2);
    for (let r = 0; r < Math.max(this.map.w, this.map.h); r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx, z = cz + dz;
        if (x < 1 || z < 1 || x >= this.map.w - 1 || z >= this.map.h - 1) continue;
        const info = this.map.info(x, z);
        if (!info.solid && !info.water) return { x, z };
      }
    }
    return { x: 1, z: 1 };
  }

  spawnCreatures(n) {
    if (!this.encounterTable.length) return;
    let guard = 0;
    while (this.creatures.length < n && guard++ < n * 60) {
      const x = rangeInt(1, this.map.w - 2), z = rangeInt(1, this.map.h - 2);
      const info = this.map.info(x, z);
      if (info.solid || info.water || !info.enc) continue;
      const entry = pickWeighted(this.encounterTable);
      this.creatures.push({
        species: entry.species,
        level: rangeInt(entry.min, entry.max),
        x: x * UNIT + UNIT / 2, z: z * UNIT + UNIT / 2,
        home: { x: x * UNIT + UNIT / 2, z: z * UNIT + UNIT / 2 },
        y: 0, facing: Math.random() * 6.28, phase: Math.random() * 6.28,
        target: null, cool: Math.random() * 3,
      });
    }
    for (const c of this.creatures) c.y = this.terrain.heightAt(c.x, c.z);
  }

  /** Line a set of species up in front of the camera — an art-review mode. */
  showcase(ids) {
    const R = this.renderer;
    this.creatures = [];
    const spacing = 5.5;
    ids.forEach((id, i) => {
      if (!this.creatureMeshes.has(id)) this.creatureMeshes.set(id, R.mesh(buildCreatureMesh(id)));
      const x = this.player.x + (i - (ids.length - 1) / 2) * spacing;
      const z = this.player.z - 9;
      this.creatures.push({
        species: id, level: 20, x, z, home: { x, z },
        y: this.terrain.heightAt(x, z), facing: Math.PI,
        phase: i, target: null, cool: 1e9,
      });
    });
    this.camera.distance = 17;
    this.camera.pitch = 0.30;
    this.showcaseMode = true;
  }

  /** A few guaranteed neighbours, so the world never looks empty on arrival. */
  spawnNearPlayer(n) {
    if (!this.encounterTable.length) return;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.28 + 0.6;
      const r = 9 + i * 3;
      const x = this.player.x + Math.cos(a) * r, z = this.player.z + Math.sin(a) * r;
      if (this.blocked(x, z)) continue;
      const entry = pickWeighted(this.encounterTable);
      this.creatures.push({
        species: entry.species, level: rangeInt(entry.min, entry.max),
        x, z, home: { x, z }, y: this.terrain.heightAt(x, z),
        facing: Math.random() * 6.28, phase: Math.random() * 6.28,
        target: null, cool: Math.random() * 3,
      });
    }
  }

  // --------------------------------------------------------------- input --
  bindInput() {
    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
      if (e.code === 'KeyZ' || e.code === 'Enter') this.interact();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    let dragging = false, lastX = 0;
    this.canvas.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; });
    addEventListener('pointerup', () => { dragging = false; });
    addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.camera.yaw -= (e.clientX - lastX) * 0.008;
      lastX = e.clientX;
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camera.distance = clamp(this.camera.distance + Math.sign(e.deltaY) * 2, 10, 60);
    }, { passive: false });
  }

  interact() {
    if (!this.nearby) return;
    const c = this.nearby;
    const sp = getSpecies(c.species);
    this.message = `${sp.name} (רמה ${c.level}) מוכן לקרב!`;
    this.messageT = 2.5;
    this.onEncounter?.(c);
  }

  // -------------------------------------------------------------- update --
  blocked(wx, wz) {
    const tx = Math.floor(wx / UNIT), tz = Math.floor(wz / UNIT);
    if (tx < 0 || tz < 0 || tx >= this.map.w || tz >= this.map.h) return true;
    const info = this.map.info(tx, tz);
    if (info.void) return true;
    // Water is not a wall — you swim across it.
    return !!info.solid && !info.water;
  }

  update(dt) {
    this.t += dt;
    if (this.messageT > 0) this.messageT -= dt;
    const K = this.keys;
    const { fx, fz, rx, rz } = this.camera.basis();
    let mx = 0, mz = 0;
    if (K.has('KeyW') || K.has('ArrowUp')) { mx += fx; mz += fz; }
    if (K.has('KeyS') || K.has('ArrowDown')) { mx -= fx; mz -= fz; }
    if (K.has('KeyA') || K.has('ArrowLeft')) { mx -= rx; mz -= rz; }
    if (K.has('KeyD') || K.has('ArrowRight')) { mx += rx; mz += rz; }
    if (K.has('KeyQ')) this.camera.yaw += dt * 1.8;
    if (K.has('KeyE')) this.camera.yaw -= dt * 1.8;

    const p = this.player;
    const len = Math.hypot(mx, mz);
    const running = K.has('ShiftLeft') || K.has('ShiftRight');
    const speed = this.mode === 'swim' ? SWIM_SPEED : running ? RUN_SPEED : MOVE_SPEED;
    if (len > 0.01) {
      mx /= len; mz /= len;
      const nx = p.x + mx * speed * dt, nz = p.z + mz * speed * dt;
      if (!this.blocked(nx, p.z)) p.x = nx;
      if (!this.blocked(p.x, nz)) p.z = nz;
      p.facing = Math.atan2(mx, mz);
      p.step += dt * (running ? 11 : 7);
      p.speed = speed;
    } else {
      p.speed = 0;
      p.step += dt * 1.5;
    }
    const tile = this.map.info(Math.floor(p.x / UNIT), Math.floor(p.z / UNIT));
    this.mode = tile.water ? 'swim' : 'walk';
    const ground = this.terrain.heightAt(p.x, p.z);
    p.y += (ground - p.y) * (1 - Math.pow(0.0005, dt));

    // roaming creatures
    let best = null, bestD = 7 * 7;
    for (const c of this.creatures) {
      if (this.showcaseMode) { c.facing = Math.PI; c.y = this.terrain.heightAt(c.x, c.z); continue; }
      c.cool -= dt;
      if (c.cool <= 0) {
        c.cool = 1.5 + Math.random() * 3;
        const a = Math.random() * 6.28, r = 3 + Math.random() * 7;
        c.target = { x: c.home.x + Math.cos(a) * r, z: c.home.z + Math.sin(a) * r };
      }
      if (c.target) {
        const dx = c.target.x - c.x, dz = c.target.z - c.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.4) c.target = null;
        else {
          const step = Math.min(d, 2.6 * dt);
          const nx = c.x + (dx / d) * step, nz = c.z + (dz / d) * step;
          if (!this.blocked(nx, nz)) { c.x = nx; c.z = nz; c.facing = Math.atan2(dx, dz); }
          else c.target = null;
        }
      }
      c.y += (this.terrain.heightAt(c.x, c.z) - c.y) * (1 - Math.pow(0.001, dt));
      const dd = (c.x - p.x) ** 2 + (c.z - p.z) ** 2;
      if (dd < bestD) { bestD = dd; best = c; }
    }
    if (this.showcaseMode) {
      for (const c of this.creatures) {
        const dd = (c.x - p.x) ** 2 + (c.z - p.z) ** 2;
        if (dd < bestD) { bestD = dd; best = c; }
      }
    }
    this.nearby = best;

    this.camera.update(p.x, p.y, p.z, dt);
  }

  // ---------------------------------------------------------------- draw --
  render() {
    const R = this.renderer;
    R.beginFrame(this.camera);
    R.draw(this.terrainMesh, {});
    R.draw(this.propsMesh, {});

    // contact shadows first, flat on the ground
    const shade = (x, y, z, r) =>
      R.draw(this.shadowMesh, { x, y: y + 0.06, z, scale: r, alpha: 0.28, emissive: 1, tint: [0, 0, 0] });

    const p = this.player;
    shade(p.x, p.y, p.z, 0.9);
    for (const c of this.creatures) {
      shade(c.x, c.y, c.z, 0.8 * (getSpecies(c.species).design.size ?? 1));
    }

    this.drawPlayer();

    for (const c of this.creatures) {
      const mesh = this.creatureMeshes.get(c.species);
      if (!mesh) continue;
      const bob = Math.sin(this.t * 2.2 + c.phase) * 0.09;
      const highlight = c === this.nearby;
      R.draw(mesh, {
        x: c.x, y: c.y + bob, z: c.z, rotY: c.facing,
        tint: highlight ? [1.25, 1.25, 1.15] : [1, 1, 1],
      });
    }

    if (this.waterMesh) {
      R.depthWrite(false);
      R.draw(this.waterMesh, { alpha: 0.80, emissive: 0.18 });
      R.depthWrite(true);
    }
    this.drawOverlay();
  }

  drawPlayer() {
    const R = this.renderer, s = this.stack, p = this.player;
    const swim = this.mode === 'swim';
    const bodyY = p.y + (swim ? -0.55 : 0) + Math.abs(Math.sin(p.step)) * (p.speed ? 0.07 : 0);
    const swing = p.speed ? Math.sin(p.step) * 0.8 : Math.sin(this.t * 1.5) * 0.06;

    s.reset();
    s.translate(p.x, bodyY, p.z);
    s.rotateY(p.facing);
    R.drawMatrix(this.actor.body, s.m);

    for (const side of [-1, 1]) {
      s.push();
      s.translate(side * 0.55, 1.78, 0);
      s.rotateX(swing * side);
      R.drawMatrix(this.actor.arm, s.m);
      s.pop();
      s.push();
      s.translate(side * 0.22, 0.92, 0);
      s.rotateX(-swing * side);
      R.drawMatrix(this.actor.leg, s.m);
      s.pop();
    }
  }

  drawOverlay() {
    const ctx = this.ctx2d;
    const W = this.overlay.width, H = this.overlay.height;
    ctx.clearRect(0, 0, W, H);
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';

    const panel = (x, y, w, h) => {
      ctx.fillStyle = 'rgba(10,16,28,.78)';
      ctx.strokeStyle = 'rgba(150,200,255,.35)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.fill(); ctx.stroke();
    };

    // location + mode
    panel(W - 300, 18, 282, 62);
    ctx.fillStyle = '#eaf3ff';
    ctx.font = '700 22px "Trebuchet MS", system-ui, sans-serif';
    ctx.fillText(this.map.name, W - 36, 46);
    ctx.font = '600 15px "Trebuchet MS", system-ui, sans-serif';
    ctx.fillStyle = '#9fc0e4';
    ctx.fillText(this.mode === 'swim' ? 'שחייה' : 'הליכה', W - 36, 68);

    // nearby creature
    if (this.nearby) {
      const sp = getSpecies(this.nearby.species);
      panel(W - 330, 96, 312, 92);
      ctx.fillStyle = '#fff';
      ctx.font = '700 21px "Trebuchet MS", system-ui, sans-serif';
      ctx.fillText(`${sp.name}  ·  רמה ${this.nearby.level}`, W - 36, 126);
      let cx = W - 36;
      ctx.font = '700 13px "Trebuchet MS", system-ui, sans-serif';
      for (const t of sp.types) {
        const label = typeName(t);
        const w = ctx.measureText(label).width + 18;
        ctx.fillStyle = typeColor(t);
        ctx.beginPath(); ctx.roundRect(cx - w, 138, w, 24, 12); ctx.fill();
        ctx.fillStyle = '#12161f';
        ctx.fillText(label, cx - 9, 155);
        cx -= w + 6;
      }
      ctx.fillStyle = '#8fe8ff';
      ctx.font = '600 15px "Trebuchet MS", system-ui, sans-serif';
      ctx.fillText('Z — התקרב והילחם', W - 36, 180);
    }

    if (this.messageT > 0) {
      ctx.globalAlpha = Math.min(1, this.messageT);
      const w = ctx.measureText(this.message).width + 60;
      panel((W - w) / 2, H - 118, w, 52);
      ctx.fillStyle = '#eaf3ff';
      ctx.font = '700 20px "Trebuchet MS", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.message, W / 2, H - 84);
      ctx.textAlign = 'right';
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = 'rgba(190,215,245,.75)';
    ctx.font = '600 14px "Trebuchet MS", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('WASD/חיצים — תנועה · גרירה או Q/E — סיבוב מצלמה · גלגלת — זום · Shift — ריצה · Z — אינטראקציה',
      W / 2, H - 24);
  }

  resize(w, h) {
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.renderer.resize(w, h, dpr);
    this.canvas.style.width = this.overlay.style.width = w + 'px';
    this.canvas.style.height = this.overlay.style.height = h + 'px';
    this.overlay.width = w; this.overlay.height = h;
  }
}
