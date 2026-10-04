import { CARS, type CarSpec } from '../vehicles/physics';
import { UPGRADES, upgradeCost, effectiveStats } from '../game/economy';
import type { GameStore } from '../game/state';
import type { AudioEngine } from '../core/audio';

export interface MenuHooks {
  onStart(): void;
  onEquip(spec: CarSpec): void;
  onBuy(spec: CarSpec): void;
  onUpgrade(upgradeId: string): void;
  onQuality(q: 'low' | 'med' | 'high'): void;
  onResume(): void;
  onRespawn(): void;
  onNewWorld(): void;
}

const CSS = `
.sf-overlay {
  position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
  z-index: 30; font-family: Inter, system-ui, sans-serif; color: #e2e8f0;
  background: radial-gradient(ellipse at 50% 30%, rgba(34, 211, 238, 0.08), transparent 60%),
              rgba(5, 8, 16, 0.72);
  backdrop-filter: blur(6px);
  opacity: 1; transition: opacity 0.25s ease;
}
.sf-overlay.hidden { opacity: 0; pointer-events: none; }
.sf-panel {
  background: linear-gradient(160deg, rgba(17, 24, 39, 0.92), rgba(10, 14, 26, 0.94));
  border: 1px solid rgba(34, 211, 238, 0.22);
  border-radius: 18px; padding: 36px 44px; min-width: 420px; max-width: min(760px, 92vw);
  max-height: 86vh; overflow-y: auto; box-shadow: 0 24px 80px rgba(0,0,0,0.6);
  transform: translateY(0) scale(1); transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}
.sf-overlay.hidden .sf-panel { transform: translateY(16px) scale(0.98); }
.sf-title {
  font-size: 44px; font-weight: 900; letter-spacing: -0.03em; margin: 0 0 4px;
  background: linear-gradient(90deg, #22d3ee, #e879f9);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.sf-sub { color: #7c8aa0; font-size: 13px; margin-bottom: 28px; letter-spacing: 0.14em; text-transform: uppercase; }
.sf-btn {
  display: inline-block; cursor: pointer; border: 1px solid rgba(34, 211, 238, 0.4);
  background: rgba(34, 211, 238, 0.1); color: #a5f3fc; font-weight: 700; font-size: 15px;
  padding: 12px 28px; border-radius: 10px; transition: all 0.15s ease; font-family: inherit;
}
.sf-btn:hover { background: rgba(34, 211, 238, 0.22); transform: translateY(-1px); }
.sf-btn.primary { background: linear-gradient(90deg, rgba(34,211,238,0.85), rgba(232,121,249,0.85)); color: #060a12; border: none; }
.sf-btn.primary:hover { filter: brightness(1.12); }
.sf-btn.small { padding: 7px 14px; font-size: 12px; border-radius: 7px; }
.sf-btn:disabled { opacity: 0.4; cursor: default; transform: none; }
.sf-hint { margin-top: 26px; color: #556377; font-size: 12px; line-height: 1.9; }
.sf-hint b { color: #7c8aa0; font-weight: 700; }
.sf-key {
  display: inline-block; border: 1px solid #334155; border-bottom-width: 2px; border-radius: 5px;
  padding: 1px 7px; font-size: 11px; font-weight: 700; color: #94a3b8; margin: 0 2px;
  background: rgba(30, 41, 59, 0.6);
}
.sf-card {
  border: 1px solid rgba(51, 65, 85, 0.7); border-radius: 14px; padding: 18px 20px;
  margin-bottom: 14px; display: flex; gap: 18px; align-items: center; transition: border-color 0.15s;
  background: rgba(15, 23, 42, 0.5);
}
.sf-card.equipped { border-color: rgba(34, 211, 238, 0.65); box-shadow: 0 0 24px rgba(34, 211, 238, 0.12) inset; }
.sf-swatch { width: 52px; height: 52px; border-radius: 10px; flex-shrink: 0; box-shadow: 0 4px 14px rgba(0,0,0,0.5); }
.sf-card h3 { margin: 0 0 2px; font-size: 17px; }
.sf-stat { display: flex; align-items: center; gap: 8px; font-size: 11px; color: #7c8aa0; margin-top: 3px; }
.sf-bar { width: 110px; height: 4px; border-radius: 2px; background: rgba(51, 65, 85, 0.8); overflow: hidden; }
.sf-bar > div { height: 100%; border-radius: 2px; background: linear-gradient(90deg, #22d3ee, #e879f9); }
.sf-price { font-weight: 800; color: #fbbf24; font-size: 14px; }
.sf-badge {
  font-size: 10px; font-weight: 800; letter-spacing: 0.1em; padding: 3px 8px; border-radius: 5px;
}
.sf-badge.owned { background: rgba(74, 222, 128, 0.15); color: #4ade80; }
.sf-badge.equipped { background: rgba(34, 211, 238, 0.18); color: #22d3ee; }
.sf-row { display: flex; gap: 10px; align-items: center; justify-content: space-between; margin-top: 18px; }
.sf-toggle { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid rgba(51,65,85,0.4); }
`;

type Screen = 'title' | 'garage' | 'pause' | 'settings' | null;

/**
 * DOM overlay menus: title, garage (car cards + upgrades), pause, settings.
 * All state rendering is pulled from GameStore on each open/refresh.
 */
export class Menus {
  visible: Screen = null;
  private style: HTMLStyleElement;
  private overlay: HTMLDivElement;
  private panel: HTMLDivElement;

  constructor(
    private parent: HTMLElement,
    private store: GameStore,
    private audio: AudioEngine,
    private hooks: MenuHooks,
  ) {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);

    this.overlay = document.createElement('div');
    this.overlay.className = 'sf-overlay hidden';
    this.panel = document.createElement('div');
    this.panel.className = 'sf-panel';
    this.overlay.appendChild(this.panel);
    parent.appendChild(this.overlay);
  }

  private show(screen: Screen): void {
    this.visible = screen;
    if (!screen) {
      this.overlay.classList.add('hidden');
      return;
    }
    this.overlay.classList.remove('hidden');
  }

  private button(label: string, onClick: () => void, cls = 'sf-btn'): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = label;
    b.onmouseenter = () => this.audio.blip('ui');
    b.onclick = () => {
      this.audio.blip('ui');
      onClick();
    };
    return b;
  }

  showTitle(): void {
    this.show('title');
    const s = this.store.s;
    this.panel.innerHTML = '';
    const h1 = document.createElement('h1');
    h1.className = 'sf-title';
    h1.textContent = 'SKYFORGE RACER';
    const sub = document.createElement('div');
    sub.className = 'sf-sub';
    sub.textContent = 'Open-world arcade driving & flight';
    const row = document.createElement('div');
    row.className = 'sf-row';
    row.appendChild(this.button('▶  START ENGINE', () => this.hooks.onStart(), 'sf-btn primary'));
    row.appendChild(this.button('🚗  GARAGE', () => this.hooks && this.showGarage()));
    const money = document.createElement('div');
    money.className = 'sf-sub';
    money.textContent = `Balance $${s.money.toLocaleString('en-US')} · Cars ${s.ownedCars.length}/${CARS.length}`;
    const hint = document.createElement('div');
    hint.className = 'sf-hint';
    hint.innerHTML = [
      '<b>Drive</b> <span class="sf-key">W A S D</span> drift with <span class="sf-key">SPACE</span>, boost <span class="sf-key">SHIFT</span>',
      '<b>Transform</b> <span class="sf-key">G</span> car → jet → hover — momentum carries over',
      '<b>Missions</b> <span class="sf-key">1</span> race · <span class="sf-key">2</span> delivery · <span class="sf-key">3</span> stunt',
      '<b>Camera</b> <span class="sf-key">C</span> · reset <span class="sf-key">R</span> · pause <span class="sf-key">ESC</span>',
    ].join('<br>');
    this.panel.append(h1, sub, money, row, hint);
  }

  showGarage(): void {
    this.show('garage');
    this.renderGarage();
  }

  private renderGarage(): void {
    const s = this.store.s;
    this.panel.innerHTML = '';
    const h1 = document.createElement('h1');
    h1.className = 'sf-title';
    h1.style.fontSize = '30px';
    h1.textContent = 'GARAGE';
    this.panel.append(h1);
    this.panel.appendChild(this.button('←  Back', () => this.showTitle(), 'sf-btn small'));

    for (const spec of CARS) {
      const owned = this.store.ownsCar(spec.id);
      const equipped = s.currentCar === spec.id;
      const color = spec.colors[s.settings.colorIndex % spec.colors.length] as number;
      const card = document.createElement('div');
      card.className = `sf-card${equipped ? ' equipped' : ''}`;

      const swatch = document.createElement('div');
      swatch.className = 'sf-swatch';
      swatch.style.background = `linear-gradient(135deg, #${color.toString(16).padStart(6, '0')}, #1e293b)`;
      swatch.title = spec.colorName;
      swatch.style.cursor = owned ? 'pointer' : 'default';
      if (owned) {
        swatch.onclick = () => {
          this.store.setColorIndex((s.settings.colorIndex + 1) % spec.colors.length);
          this.renderGarage();
        };
        swatch.title += ' — click to repaint';
      }

      const info = document.createElement('div');
      info.style.flex = '1';
      const name = document.createElement('h3');
      name.textContent = spec.name;
      info.appendChild(name);

      const stats = effectiveStats(spec, s.upgrades);
      const maxes = { top: 80, accel: 26, grip: 10, handling: 3 };
      const bar = (label: string, v: number, max: number): void => {
        const rowEl = document.createElement('div');
        rowEl.className = 'sf-stat';
        rowEl.innerHTML = `<span style="width:52px">${label}</span><div class="sf-bar"><div style="width:${Math.min(100, (v / max) * 100)}%"></div></div>`;
        info.appendChild(rowEl);
      };
      bar('SPEED', stats.topSpeed, maxes.top);
      bar('ACCEL', stats.accel, maxes.accel);
      bar('GRIP', stats.grip, maxes.grip);
      bar('HANDLING', stats.handling, maxes.handling);

      const right = document.createElement('div');
      right.style.cssText = 'display:flex; flex-direction:column; gap:8px; align-items:flex-end;';
      if (equipped) {
        const badge = document.createElement('span');
        badge.className = 'sf-badge equipped';
        badge.textContent = 'EQUIPPED';
        right.appendChild(badge);
      } else if (owned) {
        const badge = document.createElement('span');
        badge.className = 'sf-badge owned';
        badge.textContent = 'OWNED';
        right.appendChild(badge);
        right.appendChild(this.button('DRIVE', () => this.hooks.onEquip(spec), 'sf-btn small primary'));
      } else {
        const price = document.createElement('div');
        price.className = 'sf-price';
        price.textContent = `$${spec.price.toLocaleString('en-US')}`;
        const buy = this.button('BUY', () => {
          if (this.store.buyCar(spec.id, spec.price)) {
            this.audio.blip('good');
            this.hooks.onBuy(spec);
            this.renderGarage();
          } else {
            this.audio.blip('bad');
          }
        }, 'sf-btn small');
        buy.disabled = s.money < spec.price;
        right.append(price, buy);
      }

      card.append(swatch, info, right);
      this.panel.appendChild(card);
    }

    // Upgrades for the equipped car.
    const upTitle = document.createElement('h1');
    upTitle.className = 'sf-title';
    upTitle.style.fontSize = '22px';
    upTitle.style.marginTop = '26px';
    upTitle.textContent = 'UPGRADES';
    this.panel.appendChild(upTitle);
    for (const up of UPGRADES) {
      const level = this.store.upgradeLevel(up.id);
      const rowEl = document.createElement('div');
      rowEl.className = 'sf-toggle';
      const label = document.createElement('div');
      label.innerHTML = `<b style="color:#e2e8f0">${up.name}</b> <span style="color:#7c8aa0;font-size:12px"> — ${up.desc}</span>
        <div style="font-size:11px;color:${level >= up.max ? '#4ade80' : '#fbbf24'}">Level ${level}/${up.max}</div>`;
      const cost = upgradeCost(up, level);
      const btn = this.button(level >= up.max ? 'MAX' : `$${cost.toLocaleString('en-US')}`, () => {
        if (level >= up.max) return;
        if (this.store.spend(cost)) {
          this.store.setUpgradeLevel(up.id, level + 1);
          this.audio.blip('good');
          this.renderGarage();
        } else {
          this.audio.blip('bad');
        }
      }, 'sf-btn small');
      btn.disabled = level >= up.max || this.store.money < cost;
      rowEl.append(label, btn);
      this.panel.appendChild(rowEl);
    }

    const backRow = document.createElement('div');
    backRow.className = 'sf-row';
    backRow.appendChild(this.button('←  Back to title', () => this.showTitle()));
    this.panel.appendChild(backRow);
  }

  showPause(): void {
    this.show('pause');
    this.panel.innerHTML = '';
    const h1 = document.createElement('h1');
    h1.className = 'sf-title';
    h1.style.fontSize = '32px';
    h1.textContent = 'PAUSED';
    const row = document.createElement('div');
    row.className = 'sf-row';
    row.appendChild(this.button('▶  RESUME', () => this.hooks.onResume(), 'sf-btn primary'));
    const col = document.createElement('div');
    col.style.cssText = 'display:flex; flex-direction:column; gap:10px;';
    col.appendChild(this.button('GARAGE', () => this.showGarage()));
    col.appendChild(this.button('SETTINGS', () => this.showSettings(() => this.showPause())));
    col.appendChild(this.button('RESET CAR', () => this.hooks.onRespawn(), 'sf-btn small'));
    col.appendChild(this.button('NEW WORLD', () => this.hooks.onNewWorld(), 'sf-btn small'));
    row.appendChild(col);
    this.panel.append(h1, row);
  }

  showSettings(back: () => void): void {
    this.show('settings');
    const s = this.store.s;
    this.panel.innerHTML = '';
    const h1 = document.createElement('h1');
    h1.className = 'sf-title';
    h1.style.fontSize = '32px';
    h1.textContent = 'SETTINGS';
    this.panel.appendChild(h1);

    const toggle = (label: string, on: boolean, cb: (v: boolean) => void): void => {
      const rowEl = document.createElement('div');
      rowEl.className = 'sf-toggle';
      const l = document.createElement('div');
      l.textContent = label;
      const b = this.button(on ? 'ON' : 'OFF', () => {
        cb(!on);
        this.showSettings(back);
      }, 'sf-btn small');
      b.style.minWidth = '64px';
      rowEl.append(l, b);
      this.panel.appendChild(rowEl);
    };
    toggle('Sound effects', s.settings.sfx, (v) => {
      this.store.setSfx(v);
      this.audio.setSfxEnabled(v);
    });
    toggle('Music ambience', s.settings.music, (v) => this.store.setMusic(v));

    const qRow = document.createElement('div');
    qRow.className = 'sf-toggle';
    qRow.innerHTML = '<div>Graphics quality</div>';
    const qBtns = document.createElement('div');
    (['low', 'med', 'high'] as const).forEach((q) => {
      const b = this.button(q.toUpperCase(), () => {
        this.store.setQuality(q);
        this.hooks.onQuality(q);
        this.showSettings(back);
      }, 'sf-btn small');
      if (s.settings.quality === q) b.classList.add('primary');
      qBtns.appendChild(b);
    });
    qRow.appendChild(qBtns);
    this.panel.appendChild(qRow);

    this.panel.appendChild(this.button('←  Back', back, 'sf-btn small'));
  }

  hideAll(): void {
    this.show(null);
  }

  dispose(): void {
    this.overlay.remove();
    this.style.remove();
  }
}
