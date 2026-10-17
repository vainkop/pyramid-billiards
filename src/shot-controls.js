import { h } from './dom.js';
import { SpinPad } from './spin-pad.js';
import { Slider } from './slider.js';
import { CueStrip } from './cue-strip.js';
import { technique } from './content.js';

/**
 * Everything the player sets for a stroke: the tip position on the cue ball
 * (`padEl`), cue elevation (`tiltEl`) and the cue itself (`stripEl`), which is
 * pulled back and released to strike.
 *
 *   onChange(values, { silent })  any setting or the pull changed
 *   onShoot(values)               the cue was released
 *   onPullStart()                 a pull began (drills reset the table here)
 */
export class ShotControls {
  constructor(scope, { onChange, onShoot, onPullStart, elevation = true, power = 0.4 }) {
    Object.assign(this, { onChange, onShoot });
    this.power = power;
    this.padEl = h('canvas.spin-pad');
    this.pad = scope.keep(new SpinPad(this.padEl, { interactive: true, onChange: () => this.changed() }));
    this.tilt = new Slider({
      label: 'Наклон', horizontal: true, value: 0,
      format: (v) => `${Math.round(v * 80)}°`, onChange: () => this.changed(),
    });
    this.tilt.disabled = !elevation;
    this.tiltEl = this.tilt.el;
    this.strip = new CueStrip({
      onPull: (p) => { this.power = p; this.changed(); },
      onRelease: (p) => { this.power = p; this.onShoot?.(this.values); },
      onCancel: () => { this.power = this.strip.markPower; this.changed(); },
    });
    this.strip.onStart = () => onPullStart?.();
    this.strip.setMark(power);
    this.stripEl = this.strip.el;
  }

  get values() {
    return { power: this.power, ox: this.pad.ox, oy: this.pad.oy, elev: this.tilt.value };
  }

  /** Name and effect of the current settings, e.g. { name: 'Накат', desc: … }. */
  get technique() {
    const v = this.values;
    return technique(v.ox, v.oy, v.elev);
  }

  set({ power, ox, oy, elev }) {
    if (power !== undefined) {
      this.power = power;
      this.strip.setMark(power);
    }
    if (elev !== undefined) this.tilt.setValue(elev);
    this.pad.set(ox ?? this.pad.ox, oy ?? this.pad.oy, this.tilt.value);
    this.changed(false);
  }

  /**
   * Animates drawing the cue back to `power` (computer, demo solutions); the cue
   * stick on the table follows. Resolves when the stroke would be released.
   */
  async stroke(power, ms = 650) {
    await this.strip.stroke(power, ms, (p) => {
      this.power = Math.max(p, 0.001);
      this.onChange?.(this.values, { silent: true });
    });
    this.set({ power });
  }

  /** Locks the controls while the computer plays or the balls are rolling. */
  set locked(v) {
    for (const el of [this.padEl, this.tiltEl]) el.classList.toggle('locked', v);
    this.strip.disabled = v;
  }

  changed(notify = true) {
    this.pad.set(this.pad.ox, this.pad.oy, this.tilt.value);
    this.onChange?.(this.values, { silent: !notify });
  }
}

/**
 * Shared layout of the trainer, drills and the game: header, the table with the
 * cue strip beside it, and a dock with the spin pad, status and actions.
 */
export function playLayout({ head, goal, canvas, overlay, controls, status, detail, actions, className = '' }) {
  expandable(detail);
  return h(`section.play${className}`,
    head,
    goal,
    h('div.play-main', h('div.table-wrap', canvas, overlay), controls.stripEl),
    h('div.dock',
      controls.padEl,
      h('div.dock-body', status, detail, h('div.dock-actions', actions, controls.tiltEl))));
}

/**
 * The dock shows two lines of the status text; a longer text gets an «ещё»
 * marker and opens in full above the dock on a tap. New text closes it again.
 */
function expandable(detail) {
  detail.setAttribute('role', 'button');
  detail.setAttribute('tabindex', '0');
  const measure = () => {
    detail.classList.remove('open');
    requestAnimationFrame(() => detail.classList.toggle('more', detail.scrollHeight > detail.clientHeight + 1));
  };
  new MutationObserver(measure).observe(detail, { childList: true, characterData: true, subtree: true });
  const toggle = () => {
    if (detail.classList.contains('more') || detail.classList.contains('open')) detail.classList.toggle('open');
  };
  detail.addEventListener('click', toggle);
  detail.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });
}
