import { CanvasSurface } from './canvas.js';
import { MISCUE_LIMIT } from './content.js';

/**
 * The cue ball seen from the player: drag the chalk mark to choose where the
 * tip strikes; double-tap to recentre. Non-interactive pads serve as icons.
 */
export class SpinPad {
  constructor(canvas, { interactive = false, onChange } = {}) {
    this.ox = 0;
    this.oy = 0;
    this.tilt = 0;
    this.onChange = onChange;
    this.surface = new CanvasSurface(canvas, (ctx, w, hgt) => this.paint(ctx, w, hgt));
    if (interactive) this.bindInput(canvas);
  }

  set(ox, oy, tilt = this.tilt) {
    Object.assign(this, { ox, oy, tilt });
    this.surface.draw();
  }

  bindInput(canvas) {
    let lastTap = 0;
    const update = (e) => {
      const rect = canvas.getBoundingClientRect();
      const r = (Math.min(rect.width, rect.height) / 2) * 0.92;
      let nx = (e.clientX - rect.left - rect.width / 2) / r;
      let ny = -(e.clientY - rect.top - rect.height / 2) / r;
      const m = Math.hypot(nx, ny);
      if (m > 1) [nx, ny] = [nx / m, ny / m];
      this.commit(nx, ny);
    };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      if (e.timeStamp - lastTap < 300) {
        lastTap = 0;
        this.commit(0, 0);
        return;
      }
      lastTap = e.timeStamp;
      update(e);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (canvas.hasPointerCapture(e.pointerId)) update(e);
    });
  }

  commit(ox, oy) {
    this.set(ox, oy);
    this.onChange?.(ox, oy);
  }

  paint(ctx, w, hgt) {
    const cx = w / 2;
    const cy = hgt / 2;
    const r = Math.min(w, hgt) / 2 - 2;
    if (r <= 1) return;
    const big = r > 40;

    ctx.fillStyle = 'rgba(0,0,0,.4)';
    circle(ctx, cx + r * 0.05, cy + r * 0.08, r);
    ctx.fill();
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx - r * 0.2, cy - r * 0.2, r * 1.5);
    g.addColorStop(0, '#fffbf0');
    g.addColorStop(0.55, '#eadfc6');
    g.addColorStop(1, '#b3a382');
    ctx.fillStyle = g;
    circle(ctx, cx, cy, r);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0,0,0,.2)';
    ctx.lineWidth = Math.max(1, r * 0.012);
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.9, cy);
    ctx.lineTo(cx + r * 0.9, cy);
    ctx.moveTo(cx, cy - r * 0.9);
    ctx.lineTo(cx, cy + r * 0.9);
    ctx.stroke();

    if (big) {
      ctx.setLineDash([r * 0.05, r * 0.05]);
      ctx.strokeStyle = 'rgba(0,0,0,.27)';
      circle(ctx, cx, cy, r * 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(192,71,58,.45)';
      ctx.lineWidth = r * 0.03;
      circle(ctx, cx, cy, r * 0.97);
      ctx.stroke();

      ctx.fillStyle = 'rgba(64,48,32,.6)';
      ctx.font = `600 ${r * 0.15}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('накат', cx, cy - r * 0.7);
      ctx.fillText('оттяжка', cx, cy + r * 0.75);
      ctx.fillText('Л', cx - r * 0.75, cy);
      ctx.fillText('П', cx + r * 0.75, cy);
      if (this.tilt > 0.05) {
        ctx.fillStyle = '#403020';
        ctx.font = `600 ${r * 0.13}px system-ui, sans-serif`;
        ctx.fillText(`наклон ${Math.round(this.tilt * 80)}°`, cx, cy + r * 0.45);
      }
    }

    // chalk mark where the tip strikes
    const mx = cx + this.ox * r * 0.92;
    const my = cy - this.oy * r * 0.92;
    const mr = r * (big ? 0.15 : 0.24);
    ctx.fillStyle = 'rgba(0,0,0,.33)';
    circle(ctx, mx + mr * 0.12, my + mr * 0.2, mr);
    ctx.fill();
    ctx.fillStyle = Math.hypot(this.ox, this.oy) > MISCUE_LIMIT ? '#d0614f' : '#3f7fc0';
    circle(ctx, mx, my, mr);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = mr * 0.22;
    ctx.stroke();
  }

  destroy() {
    this.surface.destroy();
  }
}

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}
