// The simulation clock. Sim time t = anchorSim + (perfNow − anchorPerf) · rate.
// "LIVE" means rate = 1 and sim time within a second of the (offset-corrected) wall clock.

export const WARP_STEPS = [-3600, -600, -60, -10, -1, 0, 1, 10, 60, 600, 3600];

export class SimClock {
  /**
   * @param {object} [o]
   * @param {() => number} [o.perfNow] monotonic ms (performance.now)
   * @param {() => number} [o.wallNow] wall-clock UTC ms (Date.now)
   * @param {number} [o.startMs] initial sim time (defaults to now)
   * @param {number} [o.rate] initial rate
   */
  constructor({ perfNow = () => performance.now(), wallNow = () => Date.now(), startMs, rate = 1 } = {}) {
    this.perfNow = perfNow;
    this.wallNow = wallNow;
    /** Correction added to the device clock (estimated from server Date headers). */
    this.offsetMs = 0;
    this.rate = rate;
    this.lastNonZeroRate = rate || 1;
    this.anchorPerf = perfNow();
    this.anchorSim = startMs ?? wallNow();
    this.listeners = new Set();
  }

  /** Corrected real time. */
  realNow() {
    return this.wallNow() + this.offsetMs;
  }

  now() {
    return this.anchorSim + (this.perfNow() - this.anchorPerf) * this.rate;
  }

  #reanchor(simMs) {
    this.anchorSim = simMs;
    this.anchorPerf = this.perfNow();
  }

  #emit(kind) {
    for (const fn of this.listeners) fn(kind, this);
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setRate(rate) {
    if (rate === this.rate) return;
    this.#reanchor(this.now());
    this.rate = rate;
    if (rate !== 0) this.lastNonZeroRate = rate;
    this.#emit('rate');
  }

  pause() {
    this.setRate(0);
  }

  play() {
    this.setRate(this.lastNonZeroRate || 1);
  }

  toggle() {
    if (this.rate === 0) this.play();
    else this.pause();
  }

  /** Jump to an instant, keeping the current rate. */
  jump(simMs) {
    this.#reanchor(simMs);
    this.#emit('jump');
  }

  /** Step by `deltaMs` of sim time. */
  step(deltaMs) {
    this.jump(this.now() + deltaMs);
  }

  /** Back to real time at 1×. */
  backToNow() {
    this.#reanchor(this.realNow());
    this.rate = 1;
    this.lastNonZeroRate = 1;
    this.#emit('now');
  }

  isLive(toleranceMs = 1000) {
    return this.rate === 1 && Math.abs(this.now() - this.realNow()) < toleranceMs;
  }

  /** While live, pull sim time back onto the wall clock if they drift (sleep, suspend, clock sync). */
  resync(maxDriftMs = 250) {
    if (this.rate === 1 && Math.abs(this.now() - this.realNow()) < 5000 &&
        Math.abs(this.now() - this.realNow()) > maxDriftMs) {
      this.#reanchor(this.realNow());
    }
  }

  /** Next warp step above (direction > 0) or below (direction < 0) the current rate. */
  nextRate(direction) {
    if (direction > 0) return WARP_STEPS.find((r) => r > this.rate) ?? WARP_STEPS.at(-1);
    return WARP_STEPS.findLast((r) => r < this.rate) ?? WARP_STEPS[0];
  }
}
