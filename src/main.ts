import { Engine } from './core/engine';

export interface GameLoop {
  dispose(): void;
}

export function startGame(canvas: HTMLCanvasElement): GameLoop {
  const engine = new Engine(canvas);
  engine.start();
  return {
    dispose: () => engine.dispose(),
  };
}

const canvas = document.getElementById('game') as HTMLCanvasElement | null;
if (canvas) {
  startGame(canvas);
}
