import { describe, expect, it } from 'vitest';
import { Hud, computeBlips, type HudFrame } from '../src/ui/hud';

/** Recording stub of CanvasRenderingContext2D (only what Hud uses). */
function stubCtx() {
  const calls = { fillText: [] as string[], arcs: 0, fillRects: 0, drawImages: 0 };
  const ctx = {
    canvas: { width: 1280, height: 720 },
    fillText: (t: string) => calls.fillText.push(t),
    clearRect: () => {},
    arc: () => calls.arcs++,
    fill: () => {},
    stroke: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    clip: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    drawImage: () => calls.drawImages++,
    fillRect: () => calls.fillRects++,
    createLinearGradient: () => ({ addColorStop: () => {} }),
    set fillStyle(_v: unknown) {},
    get fillStyle() {
      return '';
    },
    set strokeStyle(_v: unknown) {},
    get strokeStyle() {
      return '';
    },
    set lineWidth(_v: number) {},
    set lineCap(_v: unknown) {},
    set font(_v: string) {},
    set textAlign(_v: unknown) {},
    set textBaseline(_v: unknown) {},
    set globalAlpha(_v: number) {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const frame: HudFrame = {
  speedKmh: 128,
  mode: 'fly',
  boostFuel: 0.7,
  money: 5250,
  airborne: true,
  minimap: {
    playerX: 10,
    playerZ: 20,
    playerYaw: 0.6,
    blips: [{ x: 50, z: 60, kind: 'mission' }],
  },
  mission: {
    title: 'Street Race',
    time: 33.2,
    par: 45,
    score: 0,
    isStunt: false,
    checkpoint: 2,
    total: 7,
  },
  fps: 60,
};

describe('Hud', () => {
  it('renders speed, money, mission text without throwing', () => {
    const { ctx, calls } = stubCtx();
    const hud = new Hud(ctx, []);
    expect(() => hud.render(frame)).not.toThrow();
    const text = calls.fillText.join(' | ');
    expect(text).toContain('128');
    expect(text).toContain('JET');
    expect(text).toContain('KM/H');
    expect(text).toContain('STREET RACE');
    expect(text).toContain('CHECKPOINT 3 / 7');
    expect(calls.fillRects).toBeGreaterThan(0);
  });

  it('handles empty blips and no mission', () => {
    const { ctx } = stubCtx();
    const hud = new Hud(ctx, []);
    const empty: HudFrame = {
      ...frame,
      mission: null,
      minimap: { playerX: 0, playerZ: 0, playerYaw: 0, blips: [] },
    };
    expect(() => hud.render(empty)).not.toThrow();
  });

  it('money counter eases toward the target', () => {
    const { ctx, calls } = stubCtx();
    const hud = new Hud(ctx, []);
    // Warm up: converge at 1000.
    for (let i = 0; i < 120; i++) hud.render({ ...frame, money: 1000 });
    calls.fillText.length = 0;
    hud.render({ ...frame, money: 1000 });
    expect(calls.fillText.find((t) => t.startsWith('$ '))).toContain('1,000');
    // Jump: one frame later it is eased partway toward 2000, not there yet.
    calls.fillText.length = 0;
    hud.render({ ...frame, money: 2000 });
    const eased = parseInt((calls.fillText.find((t) => t.startsWith('$ ')) ?? '').replace(/[^0-9]/g, ''), 10);
    expect(eased).toBeGreaterThan(1000);
    expect(eased).toBeLessThan(2000);
    // Converges after enough frames (check the LAST recorded frame).
    calls.fillText.length = 0;
    for (let i = 0; i < 120; i++) hud.render({ ...frame, money: 2000 });
    const last = [...calls.fillText].reverse().find((t) => t.startsWith('$ '));
    expect(last).toContain('2,000');
  });

  it('computeBlips filters by radius and tags kinds', () => {
    const player = { x: 0, z: 0 } as never;
    const blips = computeBlips(
      player,
      [{ x: 30, z: 30 } as never],
      [{ x: 40, z: 40 } as never],
      [{ x: 5000, z: 5000 } as never],
      { x: 10, z: 10 } as never,
    );
    const kinds = blips.map((b) => b.kind);
    expect(kinds).toContain('mission');
    expect(kinds).toContain('traffic');
    expect(kinds).toContain('garage');
    expect(kinds).not.toContain('ring'); // out of radius
  });
});
