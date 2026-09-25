// Sky-view radar geometry: azimuth/elevation → polar chart coordinates (SVG, y grows downward).
//
// 'sky' mode is how the sky looks when you lie on your back with your head to the north:
// north at the top, EAST ON THE LEFT (like a planisphere). 'map' mode mirrors it: east on the right.

/** Chart coordinates for an azimuth/elevation (degrees); zenith at the origin, horizon at radius R. */
export function azElToXY(azDeg, elDeg, R, mode = 'sky') {
  const r = (R * (90 - Math.max(-5, Math.min(90, elDeg)))) / 90;
  const a = (azDeg * Math.PI) / 180;
  return [(mode === 'sky' ? -1 : 1) * r * Math.sin(a), -r * Math.cos(a)];
}

/** Compass label positions for a chart of radius R. */
export function compassPoints(R, mode = 'sky') {
  return [['N', 0], ['E', 90], ['S', 180], ['W', 270]].map(([label, az]) => {
    const [x, y] = azElToXY(az, 0, R, mode);
    return { label, x, y };
  });
}

/** SVG path data through points [[x, y], ...]. */
export function pathD(points) {
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
}

/**
 * Split pass samples into runs by how the satellite would look:
 *  'visible' — sunlit against a dark sky (naked-eye), 'daylight' — sunlit but the sky is bright,
 *  'shadow' — inside Earth's shadow.
 * @param {{azDeg: number, elDeg: number, lit: boolean, dark: boolean}[]} samples
 */
export function passSegments(samples) {
  const kind = (s) => (!s.lit ? 'shadow' : s.dark ? 'visible' : 'daylight');
  const runs = [];
  for (const s of samples) {
    const k = kind(s);
    const last = runs.at(-1);
    if (last && last.kind === k) last.samples.push(s);
    else {
      // share the boundary sample so consecutive runs connect without a gap
      const seed = last ? [last.samples.at(-1)] : [];
      runs.push({ kind: k, samples: [...seed, s] });
    }
  }
  return runs;
}
