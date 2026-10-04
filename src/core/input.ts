/**
 * Input abstraction: keyboard + gamepad -> a single InputFrame each poll.
 * Axes are -1..1; "Pressed" fields are rising-edge only (true on the poll
 * where the key went down, false afterwards).
 */
export interface InputFrame {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  boost: boolean;
  toggleModePressed: boolean;
  pitch: number;
  roll: number;
  yaw: number;
  cameraPressed: boolean;
  pausePressed: boolean;
  resetPressed: boolean;
}

export function keyToAxis(keys: Record<string, boolean>, neg: string, pos: string): number {
  return (keys[pos] ? 1 : 0) - (keys[neg] ? 1 : 0);
}

function idleFrame(): InputFrame {
  return {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    boost: false,
    toggleModePressed: false,
    pitch: 0,
    roll: 0,
    yaw: 0,
    cameraPressed: false,
    pausePressed: false,
    resetPressed: false,
  };
}

export class Input {
  readonly frame: InputFrame = idleFrame();
  private keys: Record<string, boolean> = {};
  private prev = { mode: false, cam: false, pause: false, reset: false };
  private touches = new Map<
    number,
    { side: 'l' | 'r'; x0: number; y0: number; x: number; y: number }
  >();
  private readonly onKey = (e: KeyboardEvent): void => {
    this.keys[e.code] = e.type === 'keydown';
  };

  private readonly onTouchStart = (e: TouchEvent): void => {
    const target = e.target as Element | null;
    for (const t of Array.from(e.changedTouches)) {
      if (target?.closest?.('[data-vkey]')) continue; // virtual buttons handle themselves
      this.touches.set(t.identifier, {
        side: t.clientX < window.innerWidth / 2 ? 'l' : 'r',
        x0: t.clientX,
        y0: t.clientY,
        x: t.clientX,
        y: t.clientY,
      });
    }
  };

  private readonly onTouchMove = (e: TouchEvent): void => {
    for (const t of Array.from(e.changedTouches)) {
      const rec = this.touches.get(t.identifier);
      if (rec) {
        rec.x = t.clientX;
        rec.y = t.clientY;
      }
    }
  };

  private readonly onTouchEnd = (e: TouchEvent): void => {
    for (const t of Array.from(e.changedTouches)) this.touches.delete(t.identifier);
  };

  constructor() {
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    window.addEventListener('touchstart', this.onTouchStart, { passive: true });
    window.addEventListener('touchmove', this.onTouchMove, { passive: true });
    window.addEventListener('touchend', this.onTouchEnd);
    window.addEventListener('touchcancel', this.onTouchEnd);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('touchstart', this.onTouchStart);
    window.removeEventListener('touchmove', this.onTouchMove);
    window.removeEventListener('touchend', this.onTouchEnd);
    window.removeEventListener('touchcancel', this.onTouchEnd);
  }

  /** Synthetic key state for on-screen touch buttons (data-vkey elements). */
  virtualDown(code: string): void {
    this.keys[code] = true;
  }

  virtualUp(code: string): void {
    this.keys[code] = false;
  }

  poll(): void {
    const k = this.keys;
    const f = this.frame;

    // Driving: W/Up = throttle, S/Down = brake. Flight reuses W/S as pitch.
    const fwd = keyToAxis(k, 'ArrowDown', 'ArrowUp') || keyToAxis(k, 'KeyS', 'KeyW');
    const back = keyToAxis(k, 'ArrowUp', 'ArrowDown') || keyToAxis(k, 'KeyW', 'KeyS');
    f.throttle = Math.max(fwd, 0);
    f.brake = Math.max(back, 0);
    f.pitch = fwd - back > 0 ? 1 : fwd - back < 0 ? -1 : 0; // W = pitch down/nose, S = pitch up

    f.steer = keyToAxis(k, 'KeyA', 'KeyD') || keyToAxis(k, 'ArrowLeft', 'ArrowRight');
    f.roll = f.steer;
    f.yaw = f.steer;

    f.handbrake = !!k['Space'];
    f.boost = !!k['ShiftLeft'] || !!k['ShiftRight'];

    // Edge-detected one-shot buttons.
    const mode = !!k['KeyG'];
    const cam = !!k['KeyC'];
    const pause = !!k['Escape'];
    const reset = !!k['KeyR'];
    f.toggleModePressed = mode && !this.prev.mode;
    f.cameraPressed = cam && !this.prev.cam;
    f.pausePressed = pause && !this.prev.pause;
    f.resetPressed = reset && !this.prev.reset;
    this.prev = { mode, cam, pause, reset };

    // Gamepad merge (first connected pad wins where it has input).
    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (!pad) continue;
      const lx = pad.axes[0] ?? 0;
      if (Math.abs(lx) > 0.12) {
        f.steer = lx;
        f.roll = lx;
        f.yaw = lx;
      }
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      if (rt > 0.05) f.throttle = rt;
      if (lt > 0.05) f.brake = lt;
      if (pad.buttons[0]?.pressed) f.handbrake = true; // A
      if (pad.buttons[2]?.pressed) f.boost = true; // X
      const rb = pad.buttons[5]?.pressed ?? false;
      if (rb && !this.prevPadMode) f.toggleModePressed = true;
      this.prevPadMode = rb;
      break;
    }

    // Touch: left half = virtual steer stick, right half = throttle/brake drag.
    let touchSteer = 0;
    let touchThrottle = 0;
    let touchBrake = 0;
    for (const rec of this.touches.values()) {
      if (rec.side === 'l') {
        const dx = rec.x - rec.x0;
        if (Math.abs(dx) > 8) touchSteer = Math.max(-1, Math.min(1, dx / 70));
      } else {
        const dy = rec.y - rec.y0;
        if (dy < -8) touchThrottle = Math.min(1, -dy / 70);
        else if (dy > 8) touchBrake = Math.min(1, dy / 70);
      }
    }
    if (touchSteer !== 0) {
      f.steer = touchSteer;
      f.roll = touchSteer;
      f.yaw = touchSteer;
    }
    if (touchThrottle > 0) {
      f.throttle = touchThrottle;
      f.pitch = 1;
    }
    if (touchBrake > 0) {
      f.brake = touchBrake;
      f.pitch = -1;
    }
  }

  private prevPadMode = false;
}
