// NPC interaction rules, shared by the 2D overworld and the 3D world.
//
// Everything here is about *what happens* when you talk to someone — who gives
// what, who battles, who heals — with no knowledge of how the world is drawn.
// The caller passes a small host describing the bits that differ.
//
// host: {
//   state, audio, game,                  // game exposes dialogue, menus, save, startBattle
//   mapId: string, isCave: boolean,
//   removeNpc(npc), respawnPoint(),      // {map, x, y} to return to after a blackout
//   onHeal?()                            // optional visual flourish
// }

import { createCreature } from './creature.js';
import { getSpecies, STARTERS } from '../data/species.js';
import { typeName } from '../data/types.js';
import { getItem } from '../data/items.js';

export function talkToNpc(host, npc) {
  const { state, audio, game } = host;
  const D = game.dialogue;
  audio.sfx('cursor');
  const done = npc.flag && state.flag(npc.flag);
  const after = npc.afterFlag && state.flag(npc.afterFlag);

  if (npc.blockUntil) {
    const opened = state.flag(npc.blockUntil);
    return D.say(opened ? npc.linesAfter : npc.lines, { speaker: npc.name, look: npc.look });
  }
  if (npc.starter && !state.flag('gotStarter')) return starterScene(host, npc);
  if (npc.heal) return healScene(host, npc);
  if (npc.save) {
    return D.ask(npc.lines, [{ label: 'כן' }, { label: 'לא', cancel: true }], (v) => {
      if (v === 0) { game.save(); audio.sfx('levelup'); D.say(['המסע נשמר ביומן.']); }
    }, { speaker: npc.name, look: npc.look });
  }
  if (npc.shop) {
    return D.say(npc.lines, {
      speaker: npc.name, look: npc.look,
      onDone: () => game.menus.openShop(),
    });
  }
  if (npc.staticBattle && !state.flag(npc.flag)) {
    return D.say(npc.lines, {
      speaker: null,
      onDone: () => {
        const c = createCreature(npc.staticBattle.species, npc.staticBattle.level);
        state.setFlag(npc.flag);
        host.removeNpc(npc);
        audio.sfx('encounter');
        game.startBattle({ kind: 'wild', foeParty: [c], terrain: host.isCave ? 'cave' : 'grass' });
      },
    });
  }
  if (npc.trainer && !done) {
    if (npc.needs && !state.flag(npc.needs)) {
      return D.say(npc.lines, { speaker: npc.name, look: npc.look });
    }
    return D.say([...(npc.lines || []), npc.trainer.intro], {
      speaker: npc.name, look: npc.look,
      onDone: () => startTrainerBattle(host, npc),
    });
  }
  if (npc.give && !state.flag(npc.giveFlag) &&
      (!npc.giveNeeds || state.flag(npc.giveNeeds))) {
    const def = getItem(npc.give.item);
    state.addItem(npc.give.item, npc.give.count);
    state.setFlag(npc.giveFlag);
    audio.sfx('levelup');
    return D.say([...(npc.linesGive || npc.lines), `קיבלת ${def.name} ×${npc.give.count}!`],
      { speaker: npc.name, look: npc.look });
  }
  if (npc.healParty && after) {
    state.healParty();
    audio.sfx('heal');
    return D.say([...(npc.linesAfter || npc.lines), 'הצוות שלך התרענן במלואו.'],
      { speaker: npc.name, look: npc.look });
  }
  const lines = (done || after) ? (npc.linesAfter || npc.lines) : npc.lines;
  return D.say(lines, { speaker: npc.name, look: npc.look });
}

export function starterScene(host, npc) {
  const { state, audio, game } = host;
  const D = game.dialogue;
  D.ask(npc.lines, STARTERS.map((id) => {
    const sp = getSpecies(id);
    return { label: `${sp.name} · ${sp.types.map(typeName).join(' / ')}`, value: id };
  }), (id) => {
    const sp = getSpecies(id);
    D.ask([`${sp.name}? ${sp.flavor}`, 'זו הבחירה שלך?'],
      [{ label: 'כן, זה שלי!' }, { label: 'רגע, אחשוב שוב', cancel: true }], (yes) => {
        if (yes !== 0) return starterScene(host, npc);
        const c = createCreature(id, 5, { met: 'starter' });
        state.addToParty(c);
        state.catchDex(id);
        state.setFlag('gotStarter');
        state.data.starter = id;
        audio.sfx('caught');
        audio.cry(sp.cry * 7 + 13);
        D.say([`${sp.name} הצטרף אליך!`, 'המסע שלך מתחיל עכשיו.'],
          { speaker: npc.name, look: npc.look });
      }, { speaker: npc.name, look: npc.look });
  }, { speaker: npc.name, look: npc.look });
}

export function healScene(host, npc) {
  const { state, audio, game } = host;
  const D = game.dialogue;
  D.ask(npc.lines, [{ label: 'כן, בבקשה' }, { label: 'לא, תודה', cancel: true }], (v) => {
    if (v !== 0) return;
    state.healParty();
    state.data.respawn = host.respawnPoint();
    audio.sfx('heal');
    host.onHeal?.();
    D.say(['הצוות שלך במיטבו. מסע בטוח!'], { speaker: npc.name, look: npc.look });
  }, { speaker: npc.name, look: npc.look });
}

/** Builds the opposing team (resolving dynamic ones) and opens the battle. */
export function startTrainerBattle(host, npc) {
  const { state, game } = host;
  const t = npc.trainer;
  let team = t.team;
  if (t.dynamicTeam === 'rivalStarter') {
    // The rival always picks the starter that answers yours.
    const mine = state.data.starter || 'bytec';
    const counter = { bytec: 'cookiz', pingui: 'bytec', cookiz: 'pingui' }[mine] || 'keyvi';
    team = [{ species: 'keyvi', level: 5 }, { species: counter, level: 6 }];
  }
  const foeParty = team.map((m) => createCreature(m.species, m.level, { met: 'trainer' }));
  game.startBattle({
    kind: 'trainer',
    foeParty,
    trainer: { name: npc.name, intro: t.intro, defeat: t.defeat, reward: t.reward, look: npc.look },
    terrain: host.isCave ? 'cave' : 'grass',
  });
}

/** Flags, rewards and closing lines after beating a trainer. */
export function finishTrainerBattle(host, npc) {
  const { state, game } = host;
  state.setFlag(npc.flag);
  const lines = [npc.trainer.defeat];
  if (npc.award) {
    state.setFlag(npc.award.flag);
    if (npc.award.item) {
      state.addItem(npc.award.item, npc.award.count || 1);
      lines.push(`קיבלת ${getItem(npc.award.item).name} ×${npc.award.count || 1}!`);
    }
    lines.push('סמל המבחן שלך נחקק ביומן המסע.');
  }
  if (npc.linesAfter) lines.push(...npc.linesAfter);
  game.dialogue.say(lines, { speaker: npc.name, look: npc.look });
}
