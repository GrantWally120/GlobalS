// Draws the sky-view radar: frame, a pass track (visible / daylight / shadow), and live satellites.

import { azElToXY, compassPoints, passSegments, pathD } from '../core/radar.js';
import { fmtHm } from '../core/format.js';
import { svg } from './dom.js';

const R = 110;

export function drawFrame(root, { mode = 'sky', minElDeg = 10 } = {}) {
  root.replaceChildren();
  for (const el of [0, 30, 60]) root.append(svg('circle', { class: 'ring', r: (R * (90 - el)) / 90 }));
  if (minElDeg > 0) root.append(svg('circle', { class: 'ring min', r: (R * (90 - minElDeg)) / 90 }));
  for (let az = 0; az < 360; az += 45) {
    const [x, y] = azElToXY(az, 0, R, mode);
    root.append(svg('line', { class: 'spoke', x1: 0, y1: 0, x2: x, y2: y }));
  }
  for (const p of compassPoints(R + 11, mode)) {
    root.append(svg('text', { class: `compass${p.label === 'N' ? ' n' : ''}`, x: p.x, y: p.y }, p.label));
  }
  for (const el of [30, 60]) root.append(svg('text', { class: 'elev', x: 3, y: -(R * (90 - el)) / 90 - 3 }, `${el}°`));
  const layer = svg('g', { class: 'content' });
  root.append(layer);
  return layer;
}

/**
 * @param {SVGGElement} layer from drawFrame
 * @param {Array} track compact samples [t, az, el, lit, dark]
 */
export function drawPass(layer, track, { mode = 'sky', timeZone = 'UTC' } = {}) {
  const samples = track.map(([t, azDeg, elDeg, lit, dark]) => ({ t, azDeg, elDeg, lit: !!lit, dark: !!dark }));
  for (const run of passSegments(samples)) {
    const pts = run.samples.map((s) => azElToXY(s.azDeg, s.elDeg, R, mode));
    layer.append(svg('path', { class: `track ${run.kind}`, d: pathD(pts) }));
  }
  // one-minute ticks
  let next = Math.ceil(samples[0]?.t / 60000) * 60000;
  for (const s of samples) {
    if (s.t >= next) {
      const [x, y] = azElToXY(s.azDeg, s.elDeg, R, mode);
      layer.append(svg('circle', { class: 'tick', cx: x, cy: y, r: 1.3 }));
      next += 60000;
    }
  }
  const first = samples[0];
  const last = samples.at(-1);
  if (first && last) {
    for (const [s, label] of [[first, fmtHm(first.t, timeZone)], [last, fmtHm(last.t, timeZone)]]) {
      const [x, y] = azElToXY(s.azDeg, Math.max(s.elDeg, 0), R, mode);
      layer.append(svg('text', { class: 'end', x: x + (x < 0 ? -4 : 4), y: y + (y < 0 ? -6 : 12), 'text-anchor': x < 0 ? 'end' : 'start' }, label));
    }
  }
}

export function drawDot(layer, azDeg, elDeg, { mode = 'sky', cls = 'live', r = 4 } = {}) {
  const [x, y] = azElToXY(azDeg, elDeg, R, mode);
  const c = svg('circle', { class: cls, cx: x, cy: y, r });
  layer.append(c);
  return c;
}
