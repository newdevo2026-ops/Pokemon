// Entry point for the 3D game.

import { Game3D } from './core/game3d.js';

export function boot(glCanvas, uiCanvas) {
  const game = new Game3D(glCanvas, uiCanvas);
  const fit = () => game.resize();
  addEventListener('resize', fit);
  fit();

  let last = performance.now();
  const loop = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    game.update(dt);
    game.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return game;
}
