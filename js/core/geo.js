// Natural Earth geography (world-atlas countries-50m TopoJSON) → rings for the land mask and
// line segments for coastlines and borders.

import { feature, mesh } from '../../vendor/topojson-client/src/index.js';

function ringsOf(geojson) {
  const feats = geojson.type === 'FeatureCollection' ? geojson.features : [geojson];
  const rings = [];
  for (const f of feats) {
    const g = f.geometry ?? f;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) for (const ring of poly) rings.push(ring);
  }
  return rings;
}

/** Artificial edges from the source projection: along the ±180° seam, or along the pole cut. */
function isArtificial(a, b) {
  if (a[1] < -89.9 && b[1] < -89.9) return true;
  return Math.abs(Math.abs(a[0]) - 180) < 1e-6 && Math.abs(Math.abs(b[0]) - 180) < 1e-6;
}

/** Flatten MultiLineString coordinates into [lon0, lat0, lon1, lat1, …] segment pairs. */
function segments(multiLine) {
  const out = [];
  for (const line of multiLine.coordinates) {
    for (let i = 1; i < line.length; i++) {
      if (!isArtificial(line[i - 1], line[i])) out.push(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]);
    }
  }
  return Float32Array.from(out);
}

/**
 * @param {object} topo countries-50m.json (objects: countries, land)
 * @returns {{landRings: number[][][], coast: Float32Array, borders: Float32Array}}
 *   coast/borders: flat [lon0, lat0, lon1, lat1, …] in degrees
 */
export function geography(topo) {
  return {
    landRings: ringsOf(feature(topo, topo.objects.land)),
    coast: segments(mesh(topo, topo.objects.land)),
    borders: segments(mesh(topo, topo.objects.countries, (a, b) => a !== b)),
  };
}
