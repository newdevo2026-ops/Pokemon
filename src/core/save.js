// localStorage persistence.  Saves are plain JSON — easy to inspect, easy to
// migrate, and small enough that three slots cost nothing.

const KEY = 'aurelia.save.v1';

export function hasSave() {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}

export function saveGame(data, meta = {}) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...data, savedAt: Date.now(), meta }));
    return true;
  } catch (e) {
    console.warn('save failed', e);
    return false;
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('load failed', e);
    return null;
  }
}

export function deleteSave() {
  try { localStorage.removeItem(KEY); } catch {}
}

export function saveSummary() {
  const d = loadGame();
  if (!d) return null;
  return {
    name: d.player?.name ?? '—',
    map: d.player?.map ?? '—',
    party: d.party?.length ?? 0,
    caught: Object.keys(d.dex?.caught || {}).length,
    money: d.money ?? 0,
    playtime: d.playtime ?? 0,
    savedAt: d.savedAt,
  };
}
