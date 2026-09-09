// Keyboard + on-screen gamepad, normalised into a tiny action API.
//
//   held('up')      -> true while the key is down
//   pressed('a')    -> true for exactly one frame after the key goes down
//
// `pressed` is consumed by endFrame(), which the game loop calls once per tick.

const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  KeyZ: 'a', Enter: 'a', Space: 'a',
  KeyX: 'b', Escape: 'b',
  ShiftLeft: 'run', ShiftRight: 'run',
  Tab: 'start', KeyM: 'mute',
};

// While the player is typing, letter keys must reach the text field instead of
// firing game actions — otherwise a name like "Max" would mute the game, walk
// left and back out of the screen. Only Enter and Escape stay bound.
const TEXT_MODE_KEYS = { Enter: 'a', Escape: 'b' };

export class Input {
  constructor(target = window) {
    this.down = new Set();
    this.justDown = new Set();
    this.justUp = new Set();
    this.anyKeySince = 0;
    this.textMode = false;

    target.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') e.preventDefault();   // never let focus jump away
      const a = this.textMode ? TEXT_MODE_KEYS[e.code] : KEYMAP[e.code];
      if (!a) return;
      if (!this.textMode) e.preventDefault();
      if (!this.down.has(a)) this.justDown.add(a);
      this.down.add(a);
      this.anyKeySince++;
    });
    target.addEventListener('keyup', (e) => {
      const a = this.textMode ? TEXT_MODE_KEYS[e.code] : KEYMAP[e.code];
      if (!a) return;
      if (!this.textMode) e.preventDefault();
      this.down.delete(a);
      this.justUp.add(a);
    });
    window.addEventListener('blur', () => this.down.clear());

    this._bindTouch();
  }

  _bindTouch() {
    const buttons = document.querySelectorAll('#touch [data-key]');
    for (const btn of buttons) {
      const action = KEYMAP[btn.dataset.key];
      if (!action) continue;
      const press = (e) => {
        e.preventDefault();
        if (!this.down.has(action)) this.justDown.add(action);
        this.down.add(action);
        this.anyKeySince++;
      };
      const release = (e) => {
        e.preventDefault();
        this.down.delete(action);
        this.justUp.add(action);
      };
      btn.addEventListener('touchstart', press, { passive: false });
      btn.addEventListener('touchend', release, { passive: false });
      btn.addEventListener('touchcancel', release, { passive: false });
      btn.addEventListener('mousedown', press);
      btn.addEventListener('mouseup', release);
      btn.addEventListener('mouseleave', release);
    }
  }

  held(a) { return this.down.has(a); }
  pressed(a) { return this.justDown.has(a); }
  released(a) { return this.justUp.has(a); }

  /** First held direction, in a fixed priority order (matches classic RPG feel). */
  direction() {
    if (this.down.has('up')) return 'up';
    if (this.down.has('down')) return 'down';
    if (this.down.has('left')) return 'left';
    if (this.down.has('right')) return 'right';
    return null;
  }

  pressedDirection() {
    for (const d of ['up', 'down', 'left', 'right']) {
      if (this.justDown.has(d)) return d;
    }
    return null;
  }

  endFrame() {
    this.justDown.clear();
    this.justUp.clear();
  }

  clear() {
    this.down.clear();
    this.justDown.clear();
    this.justUp.clear();
  }
}
