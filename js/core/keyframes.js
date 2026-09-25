// Keyframe schedule for the satellite swarm. Keyframes sit on a fixed sim-time grid (multiples of
// the spacing since the Unix epoch) so they can be cached and shared while time runs either way.

/** Keyframe spacing in seconds for a given time-warp rate. */
export function spacingSec(rate) {
  const a = Math.abs(rate);
  if (a <= 60) return 60;
  if (a <= 180) return 180;
  return 900;
}

/** The keyframe pair bracketing `tMs`: ta ≤ t < tb. */
export function keyPair(tMs, rate) {
  const h = spacingSec(rate) * 1000;
  const ta = Math.floor(tMs / h) * h;
  return { ta, tb: ta + h, h };
}

/** Keyframes needed now, plus one prefetch in the direction time is flowing. */
export function neededKeys(tMs, rate) {
  const { ta, tb, h } = keyPair(tMs, rate);
  return [ta, tb, rate < 0 ? ta - h : tb + h];
}

/** Small cache of keyframes keyed by time; evicts the ones farthest from "now". */
export class KeyframeCache {
  constructor(limit = 6) {
    this.limit = limit;
    this.map = new Map();
  }

  get(t) {
    return this.map.get(t);
  }

  has(t) {
    return this.map.has(t);
  }

  put(t, frame, nowMs) {
    this.map.set(t, frame);
    if (this.map.size > this.limit) {
      const far = [...this.map.keys()].sort((a, b) => Math.abs(b - nowMs) - Math.abs(a - nowMs));
      for (const k of far.slice(0, this.map.size - this.limit)) this.map.delete(k);
    }
  }

  clear() {
    this.map.clear();
  }
}
