/** Stacked toast notifications, bottom-center, auto-expiring. */
export class Toaster {
  private root: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.style.cssText = `
      position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%);
      display: flex; flex-direction: column-reverse; gap: 8px; align-items: center;
      pointer-events: none; z-index: 40; font-family: Inter, system-ui, sans-serif;
    `;
    parent.appendChild(this.root);
  }

  show(msg: string, kind: 'info' | 'good' | 'bad' = 'info'): void {
    const colors = {
      info: { border: '#22d3ee', text: '#a5f3fc' },
      good: { border: '#4ade80', text: '#bbf7d0' },
      bad: { border: '#f87171', text: '#fecaca' },
    } as const;
    const c = colors[kind];
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = `
      background: rgba(10, 14, 26, 0.85); color: ${c.text};
      border: 1px solid ${c.border}; border-left-width: 4px;
      padding: 10px 18px; border-radius: 8px; font-size: 14px; font-weight: 600;
      box-shadow: 0 4px 24px rgba(0,0,0,0.5); backdrop-filter: blur(8px);
      opacity: 0; transform: translateY(12px); transition: all 0.25s ease;
      white-space: nowrap;
    `;
    this.root.appendChild(el);
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    });
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-8px)';
      setTimeout(() => el.remove(), 300);
    }, 2500);
  }

  dispose(): void {
    this.root.remove();
  }
}
