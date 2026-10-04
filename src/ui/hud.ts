import * as THREE from 'three';
import type { RoadSegment } from '../world/city';

export interface HudBlip {
  x: number;
  z: number;
  kind: 'mission' | 'traffic' | 'ring' | 'garage';
}

export interface HudFrame {
  speedKmh: number;
  mode: 'drive' | 'fly' | 'hover';
  boostFuel: number;
  money: number;
  airborne: boolean;
  minimap: {
    playerX: number;
    playerZ: number;
    playerYaw: number;
    blips: HudBlip[];
  };
  mission: {
    title: string;
    /** Seconds left (stunt) or elapsed (race/delivery). */
    time: number;
    /** Par seconds (race/delivery) or target score (stunt). */
    par: number;
    score: number;
    isStunt: boolean;
    checkpoint: number;
    total: number;
  } | null;
  fps: number;
}

const C = {
  bg: 'rgba(10, 14, 26, 0.55)',
  cyan: '#22d3ee',
  cyanDim: 'rgba(34, 211, 238, 0.25)',
  magenta: '#e879f9',
  amber: '#fbbf24',
  green: '#4ade80',
  red: '#f87171',
  text: '#e2e8f0',
  textDim: '#7c8aa0',
};

const MODE_GLYPH: Record<HudFrame['mode'], string> = {
  drive: '⣿ CAR',
  fly: '✈ JET',
  hover: '◎ HOVER',
};

/**
 * Canvas-2D HUD overlay. Synthwave palette, arc speedometer, rotating
 * circular minimap with pre-rendered roads, mission tracker, money counter.
 */
export class Hud {
  private roadsCanvas: HTMLCanvasElement | null = null;
  private roadsBounds = { minX: -400, maxX: 400, minZ: -400, maxZ: 400 };
  private shownMoney = 0;

  constructor(
    private ctx: CanvasRenderingContext2D,
    private roads: RoadSegment[],
  ) {
    this.prerenderRoads();
  }

  /** Pre-render the road grid once to an offscreen canvas (top-down). */
  private prerenderRoads(): void {
    if (typeof document === 'undefined') return;
    const pad = 60;
    const xs = this.roads.flatMap((r) => [r.x1, r.x2]);
    const zs = this.roads.flatMap((r) => [r.z1, r.z2]);
    this.roadsBounds = {
      minX: Math.min(...xs) - pad,
      maxX: Math.max(...xs) + pad,
      minZ: Math.min(...zs) - pad,
      maxZ: Math.max(...zs) + pad,
    };
    const w = 512;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = w;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const spanX = this.roadsBounds.maxX - this.roadsBounds.minX;
    const spanZ = this.roadsBounds.maxZ - this.roadsBounds.minZ;
    const scale = w / Math.max(spanX, spanZ);
    const toPx = (x: number, z: number): [number, number] => [
      (x - this.roadsBounds.minX) * scale,
      (z - this.roadsBounds.minZ) * scale,
    ];
    ctx.fillStyle = 'rgba(10, 14, 26, 0.9)';
    ctx.fillRect(0, 0, w, w);
    ctx.strokeStyle = 'rgba(124, 138, 160, 0.75)';
    ctx.lineWidth = 4;
    for (const r of this.roads) {
      const [x1, z1] = toPx(r.x1, r.z1);
      const [x2, z2] = toPx(r.x2, r.z2);
      ctx.beginPath();
      ctx.moveTo(x1, z1);
      ctx.lineTo(x2, z2);
      ctx.stroke();
    }
    this.roadsCanvas = c;
    this.roadsScale = scale;
  }

  private roadsScale = 1;

  render(frame: HudFrame): void {
    const { ctx } = this;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.save();

    // Money counter: eased count-up.
    const diff = frame.money - this.shownMoney;
    this.shownMoney += Math.abs(diff) < 1 ? diff : diff * 0.12;

    this.drawSpeedo(w, h, frame);
    this.drawMinimap(w, frame);
    this.drawMoney(w, frame);
    this.drawMission(w, frame);
    this.drawFps(h, w, frame);
    ctx.restore();
  }

  private drawSpeedo(w: number, h: number, f: HudFrame): void {
    const { ctx } = this;
    const cx = w - 130;
    const cy = h - 110;
    const r = 88;

    // Backing disc.
    ctx.beginPath();
    ctx.arc(cx, cy, r + 14, 0, Math.PI * 2);
    ctx.fillStyle = C.bg;
    ctx.fill();

    // Arc track: from 135deg to 405deg (270deg sweep).
    const start = Math.PI * 0.75;
    const end = Math.PI * 2.25;
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, end);
    ctx.strokeStyle = C.cyanDim;
    ctx.stroke();

    // Speed fill.
    const speed01 = Math.min(f.speedKmh / 250, 1);
    const grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
    grad.addColorStop(0, C.cyan);
    grad.addColorStop(1, speed01 > 0.8 ? C.red : C.magenta);
    ctx.strokeStyle = grad as unknown as CanvasGradient;
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, start + (end - start) * speed01);
    ctx.stroke();

    // Boost ring (inner).
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 16, start, start + (end - start) * Math.max(0, Math.min(f.boostFuel, 1)));
    ctx.strokeStyle = f.boostFuel > 0.25 ? C.amber : 'rgba(251, 191, 36, 0.3)';
    ctx.stroke();

    // Digital speed + mode.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = C.text;
    ctx.font = 'bold 40px Inter, system-ui, sans-serif';
    ctx.fillText(String(Math.round(f.speedKmh)), cx, cy - 6);
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.fillStyle = C.textDim;
    ctx.fillText('KM/H', cx, cy + 20);
    ctx.fillStyle = f.mode === 'drive' ? C.cyan : f.mode === 'fly' ? C.magenta : C.amber;
    ctx.font = 'bold 13px Inter, system-ui, sans-serif';
    ctx.fillText(MODE_GLYPH[f.mode], cx, cy + 42);
  }

  private drawMinimap(w: number, f: HudFrame): void {
    const { ctx } = this;
    const size = 176;
    const cx = 20 + size / 2;
    const cy = 20 + size / 2;
    const r = size / 2;
    const view = 480; // world meters shown across the minimap

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10, 14, 26, 0.7)';
    ctx.fill();
    ctx.clip();

    const scale = size / view;
    ctx.translate(cx, cy);
    ctx.rotate(-f.minimap.playerYaw); // rotate world to player heading
    ctx.translate(
      -((f.minimap.playerX - this.roadsBounds.minX) * this.roadsScale),
      -((f.minimap.playerZ - this.roadsBounds.minZ) * this.roadsScale),
    );
    ctx.scale(scale / this.roadsScale, scale / this.roadsScale);

    if (this.roadsCanvas) {
      ctx.drawImage(this.roadsCanvas, 0, 0);
    }

    ctx.restore();

    // Blips (screen-space, rotated with the map).
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    for (const b of f.minimap.blips) {
      const dx = (b.x - f.minimap.playerX) * scale;
      const dz = (b.z - f.minimap.playerZ) * scale;
      const cos = Math.cos(-f.minimap.playerYaw);
      const sin = Math.sin(-f.minimap.playerYaw);
      const sx = cx + dx * cos - dz * sin;
      const sy = cy + dx * sin + dz * cos;
      ctx.beginPath();
      ctx.arc(sx, sy, 4, 0, Math.PI * 2);
      ctx.fillStyle =
        b.kind === 'mission' ? C.magenta : b.kind === 'ring' ? C.cyan : b.kind === 'garage' ? C.amber : 'rgba(148,163,184,0.8)';
      ctx.fill();
    }
    ctx.restore();

    // Player arrow + ring border.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = C.cyanDim;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Compass N.
    ctx.fillStyle = C.textDim;
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const nx = cx + Math.sin(-f.minimap.playerYaw) * (r - 12);
    const ny = cy - Math.cos(-f.minimap.playerYaw) * (r - 12);
    ctx.fillText('N', nx, ny);
  }

  private drawMoney(w: number, _f: HudFrame): void {
    const { ctx } = this;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.font = 'bold 26px Inter, system-ui, sans-serif';
    ctx.fillStyle = C.amber;
    ctx.fillText(`$ ${Math.round(this.shownMoney).toLocaleString('en-US')}`, w - 24, 22);
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.fillStyle = C.textDim;
    ctx.fillText('BALANCE', w - 24, 52);
  }

  private drawMission(w: number, f: HudFrame): void {
    const { ctx } = this;
    const m = f.mission;
    if (!m) return;
    const cx = w / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    ctx.font = 'bold 17px Inter, system-ui, sans-serif';
    ctx.fillStyle = C.magenta;
    ctx.fillText(m.title.toUpperCase(), cx, 18);

    ctx.font = 'bold 30px Inter, system-ui, sans-serif';
    const timeText = m.isStunt
      ? `${Math.max(0, Math.ceil(m.time))}s`
      : `${m.time.toFixed(1)}s / ${m.par}s`;
    ctx.fillStyle = m.isStunt ? C.cyan : m.time > m.par ? C.red : C.text;
    ctx.fillText(timeText, cx, 44);

    // Timer bar.
    const bw = 220;
    const frac = m.isStunt ? Math.max(0, m.time / Math.max(m.par, 1)) * 0 : 0;
    void frac;
    if (!m.isStunt) {
      const p = Math.min(m.time / m.par, 1);
      ctx.fillStyle = 'rgba(124, 138, 160, 0.3)';
      ctx.fillRect(cx - bw / 2, 82, bw, 5);
      ctx.fillStyle = p > 0.85 ? C.red : C.cyan;
      ctx.fillRect(cx - bw / 2, 82, bw * p, 5);
    } else {
      const p = Math.min(m.score / m.par, 1);
      ctx.fillStyle = 'rgba(124, 138, 160, 0.3)';
      ctx.fillRect(cx - bw / 2, 82, bw, 5);
      ctx.fillStyle = C.green;
      ctx.fillRect(cx - bw / 2, 82, bw * p, 5);
      ctx.font = 'bold 14px Inter, system-ui, sans-serif';
      ctx.fillStyle = C.green;
      ctx.fillText(`${m.score} / ${m.par} PTS`, cx, 92);
    }

    if (!m.isStunt && m.total > 0) {
      ctx.font = '12px Inter, system-ui, sans-serif';
      ctx.fillStyle = C.textDim;
      ctx.fillText(`CHECKPOINT ${Math.min(m.checkpoint + 1, m.total)} / ${m.total}`, cx, 94);
    }
  }

  private drawFps(h: number, _w: number, f: HudFrame): void {
    const { ctx } = this;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.fillStyle = f.fps >= 50 ? C.textDim : f.fps >= 30 ? C.amber : C.red;
    ctx.fillText(`${f.fps} FPS`, 24, h - 20);
  }
}

/** Blips for nearby world entities, computed from 3D positions. */
export function computeBlips(
  player: THREE.Vector3,
  missionGates: THREE.Vector3[],
  traffic: THREE.Vector3[],
  rings: THREE.Vector3[],
  garagePos: THREE.Vector3 | null,
): HudBlip[] {
  const blips: HudBlip[] = [];
  const add = (v: THREE.Vector3, kind: HudBlip['kind']): void => {
    if (Math.hypot(v.x - player.x, v.z - player.z) < 460) blips.push({ x: v.x, z: v.z, kind });
  };
  missionGates.forEach((g) => add(g, 'mission'));
  traffic.forEach((t) => add(t, 'traffic'));
  rings.forEach((r) => add(r, 'ring'));
  if (garagePos) add(garagePos, 'garage');
  return blips;
}
