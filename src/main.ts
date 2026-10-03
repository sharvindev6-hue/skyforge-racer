export interface GameLoop {
  dispose(): void;
}

export function startGame(_canvas: HTMLCanvasElement): GameLoop {
  return { dispose() {} };
}
