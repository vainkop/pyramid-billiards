/**
 * Keeps a canvas's backing store matched to its CSS size × devicePixelRatio and
 * calls `draw(ctx, width, height)` in CSS pixels whenever it needs repainting.
 */
export class CanvasSurface {
  constructor(canvas, draw) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.drawFn = draw;
    this.width = 0;
    this.height = 0;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
  }

  resize() {
    const { width, height } = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.width = width;
    this.height = height;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.onResize?.();
    this.draw();
  }

  draw() {
    if (this.width > 0 && this.height > 0) {
      this.ctx.clearRect(0, 0, this.width, this.height);
      this.drawFn(this.ctx, this.width, this.height);
    }
  }

  destroy() {
    this.observer.disconnect();
  }
}
