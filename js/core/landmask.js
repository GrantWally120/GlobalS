// Rasterises Natural Earth land polygons into an equirectangular mask (row 0 = 90°N,
// column 0 = 180°W), handling what a naive planar fill gets wrong:
//  • rings that cross ±180° (Afro-Eurasia via Chukotka, Wrangel Island, Fiji) are unwrapped to a
//    continuous longitude and drawn again shifted by ±360° so both sides of the seam fill;
//  • Antarctica's coastline circles the South Pole (net ±360°), so it is closed along the pole.
// Even-odd filling keeps lakes and inland seas (holes) as water.

/** Make a ring's longitudes continuous and close pole-encircling rings along the pole. */
export function unwrapRing(ring) {
  const out = [[ring[0][0], ring[0][1]]];
  for (let i = 1; i < ring.length; i++) {
    let lon = ring[i][0];
    const prev = out[i - 1][0];
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    out.push([lon, ring[i][1]]);
  }
  const net = out[out.length - 1][0] - out[0][0];
  if (Math.abs(net) > 180) {
    const meanLat = out.reduce((s, p) => s + p[1], 0) / out.length;
    const pole = meanLat < 0 ? -90 : 90;
    out.push([out[out.length - 1][0], pole], [out[0][0], pole]);
  }
  return out;
}

/**
 * Even-odd scanline fill of lon/lat rings.
 * @param {number[][][]} rings arrays of [lon, lat]
 * @returns {Uint8Array} W×H mask, 255 = land
 */
export function rasterizeRings(rings, W, H) {
  const mask = new Uint8Array(W * H);
  // Edge list in pixel space: x = (lon + 180)/360·W, y = (90 − lat)/180·H.
  const edges = [];
  for (const ring of rings) {
    const u = unwrapRing(ring);
    for (const shift of [-360, 0, 360]) {
      let minLon = Infinity;
      let maxLon = -Infinity;
      for (const [lon] of u) {
        minLon = Math.min(minLon, lon + shift);
        maxLon = Math.max(maxLon, lon + shift);
      }
      if (maxLon < -180 || minLon > 180) continue;
      for (let i = 0; i < u.length; i++) {
        const a = u[i];
        const b = u[(i + 1) % u.length];
        const x0 = ((a[0] + shift + 180) / 360) * W;
        const y0 = ((90 - a[1]) / 180) * H;
        const x1 = ((b[0] + shift + 180) / 360) * W;
        const y1 = ((90 - b[1]) / 180) * H;
        if (y0 === y1) continue;
        edges.push(y0 < y1 ? [x0, y0, x1, y1] : [x1, y1, x0, y0]);
      }
    }
  }
  // Bucket edges by the first row whose centre they cross.
  const buckets = Array.from({ length: H }, () => []);
  for (const e of edges) {
    const first = Math.max(0, Math.ceil(e[1] - 0.5));
    if (first < H && first + 0.5 < e[3]) buckets[first].push(e);
  }
  let active = [];
  const xs = [];
  for (let j = 0; j < H; j++) {
    const yc = j + 0.5;
    active = active.filter((e) => e[3] > yc);
    for (const e of buckets[j]) active.push(e);
    xs.length = 0;
    for (const e of active) {
      if (e[1] <= yc && e[3] > yc) xs.push(e[0] + ((yc - e[1]) / (e[3] - e[1])) * (e[2] - e[0]));
    }
    xs.sort((a, b) => a - b);
    const row = j * W;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5));
      const to = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = from; x <= to; x++) mask[row + x] ^= 255;
    }
  }
  return mask;
}

/** Sample a mask at a geographic position (nearest pixel). */
export function sampleMask(mask, W, H, latDeg, lonDeg) {
  const x = Math.min(W - 1, Math.max(0, Math.floor(((lonDeg + 180) / 360) * W)));
  const y = Math.min(H - 1, Math.max(0, Math.floor(((90 - latDeg) / 180) * H)));
  return mask[y * W + x] > 127;
}
