import { Game } from './core/Game.js';

// Punto de entrada de CITY LIFE (SHOFE GAMES).
const canvas = document.getElementById('game-canvas');
const game = new Game(canvas);
window.__cityLife = game; // útil para depurar desde la consola
game.boot().catch((err) => {
  console.error(err);
  game.ui.showError(`Error al iniciar: ${err.message}`);
});
