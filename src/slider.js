import { h } from './dom.js';

/** Brass slider, value 0..1 (vertical: filled from the bottom). Keyboard accessible. */
export class Slider {
  constructor({ label, value = 0, format = (v) => `${Math.round(v * 100)}%`, onChange, horizontal = false }) {
    this.horizontal = horizontal;
    this.format = format;
    this.onChange = onChange;
    this.fill = h('div.slider-fill');
    this.thumb = h('div.slider-thumb');
    this.track = h('div.slider-track', this.fill, this.thumb);
    this.readout = h('div.slider-value');
    this.el = h(`div.slider${horizontal ? '.h' : ''}`, {
      role: 'slider', tabindex: 0, 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100,
    }, h('div.slider-label', label), this.track, this.readout);
    this.bind();
    this.setValue(value);
  }

  get value() {
    return this._value;
  }

  setValue(v) {
    this._value = Math.min(1, Math.max(0, v));
    const pct = `${this._value * 100}%`;
    if (this.horizontal) {
      this.fill.style.width = pct;
      this.thumb.style.left = pct;
    } else {
      this.fill.style.height = pct;
      this.thumb.style.bottom = pct;
    }
    this.readout.textContent = this.format(this._value);
    this.el.setAttribute('aria-valuenow', Math.round(this._value * 100));
  }

  set disabled(d) {
    this.el.classList.toggle('disabled', d);
    this.el.setAttribute('aria-disabled', d);
  }

  get disabled() {
    return this.el.classList.contains('disabled');
  }

  bind() {
    const update = (e) => {
      const r = this.track.getBoundingClientRect();
      this.commit(this.horizontal ? (e.clientX - r.left) / r.width : (r.bottom - e.clientY) / r.height);
    };
    this.el.addEventListener('pointerdown', (e) => {
      if (this.disabled) return;
      this.el.setPointerCapture(e.pointerId);
      update(e);
    });
    this.el.addEventListener('pointermove', (e) => {
      if (this.el.hasPointerCapture(e.pointerId)) update(e);
    });
    this.el.addEventListener('keydown', (e) => {
      if (this.disabled) return;
      const step = { ArrowUp: 0.02, ArrowRight: 0.02, ArrowDown: -0.02, ArrowLeft: -0.02 }[e.key];
      if (step) {
        e.preventDefault();
        this.commit(this._value + step);
      }
    });
  }

  commit(v) {
    this.setValue(v);
    this.onChange?.(this._value);
  }
}
