import { h } from './dom.js';

/** How far (as a share of the track) the finger must travel for full power. */
const FULL_PULL = 0.8;
/** Below this the release counts as a cancelled stroke. */
const MIN_POWER = 0.03;

/**
 * The cue: press anywhere on the strip and pull down to draw the cue back,
 * release to strike, slide back up to cancel. A gold tick marks the power of
 * the previous stroke (or the coach's suggestion).
 *
 * onPull(power) fires while pulling; onRelease(power) when a stroke is made.
 */
export class CueStrip {
  constructor({ onPull, onRelease, onCancel } = {}) {
    Object.assign(this, { onPull, onRelease, onCancel });
    this.fill = h('div.cue-fill');
    this.mark = h('div.cue-mark');
    this.track = h('div.cue-track', this.fill, this.mark, h('div.cue-grip'));
    this.value = h('div.cue-value', 'тяни');
    this.el = h('div.cue-strip', {
      role: 'slider', tabindex: 0, 'aria-label': 'Кий: потяни вниз и отпусти, чтобы ударить',
      'aria-valuemin': 0, 'aria-valuemax': 100,
    }, h('div.cue-label', 'Кий'), this.track, this.value);
    this.power = 0;
    this.markPower = 0.4;
    this.bind();
    this.render();
  }

  set disabled(v) {
    this.el.classList.toggle('disabled', v);
    if (v) this.cancelPull();
  }

  get disabled() {
    return this.el.classList.contains('disabled');
  }

  /** Remembered or suggested power, shown as a tick. */
  setMark(p) {
    this.markPower = clamp(p);
    this.render();
  }

  /** Animates a stroke to `power` (computer, demo solutions); resolves when the cue would strike. */
  stroke(power, ms = 600, onStep) {
    const start = performance.now();
    return new Promise((resolve) => {
      const step = (now) => {
        const k = Math.min(1, (now - start) / ms);
        this.show(power * k * k * (3 - 2 * k));
        onStep?.(this.power);
        if (k < 1) requestAnimationFrame(step);
        else setTimeout(() => { this.show(0); resolve(); }, 120);
      };
      requestAnimationFrame(step);
    });
  }

  bind() {
    let startY = null;
    const pull = (e) => {
      const r = this.track.getBoundingClientRect();
      this.show(clamp((e.clientY - startY) / (r.height * FULL_PULL)));
      this.onPull?.(this.power);
    };
    this.el.addEventListener('pointerdown', (e) => {
      if (this.disabled) return;
      this.el.setPointerCapture(e.pointerId);
      startY = e.clientY;
      this.el.classList.add('pulling');
      this.onStart?.();
      pull(e);
    });
    this.el.addEventListener('pointermove', (e) => {
      if (startY !== null && this.el.hasPointerCapture(e.pointerId)) pull(e);
    });
    const finish = (fire) => () => {
      if (startY === null) return;
      startY = null;
      this.el.classList.remove('pulling');
      const p = this.power;
      this.show(0);
      if (fire && p >= MIN_POWER) {
        this.setMark(p);
        this.onRelease?.(p);
      } else {
        this.onCancel?.();
      }
    };
    this.el.addEventListener('pointerup', finish(true));
    this.el.addEventListener('pointercancel', finish(false));
    // keyboard: arrows set the power tick, Enter/Space strikes with it
    this.el.addEventListener('keydown', (e) => {
      if (this.disabled) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        this.setMark(this.markPower + (e.key === 'ArrowDown' ? 0.05 : -0.05));
        this.onPull?.(this.markPower);
      } else if (e.key === 'Enter' || e.key === ' ') {
        this.onRelease?.(this.markPower);
      } else return;
      e.preventDefault();
    });
  }

  cancelPull() {
    this.el.classList.remove('pulling');
    this.show(0);
  }

  show(p) {
    this.power = p;
    this.render();
  }

  render() {
    const pct = `${this.power * 100}%`;
    this.fill.style.height = pct;
    this.fill.style.background = `linear-gradient(hsl(${110 - this.power * 110} 65% 58%), hsl(${110 - this.power * 110} 55% 42%))`;
    this.mark.style.top = `${this.markPower * 100}%`;
    this.value.textContent = this.power > 0 ? `${Math.round(this.power * 100)}%` : 'тяни ↓';
    this.el.setAttribute('aria-valuenow', Math.round((this.power || this.markPower) * 100));
  }
}

const clamp = (v) => Math.min(1, Math.max(0, v));
