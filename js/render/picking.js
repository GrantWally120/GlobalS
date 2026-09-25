// Screen-space picking for the point cloud (no raycasting through 16k sprites).

import * as THREE from 'three';
import { ER_KM, WGS84_B } from '../core/frames.js';

const K = ER_KM / WGS84_B; // stretch scene Y so the ellipsoid becomes a unit sphere
const vp = new THREE.Matrix4();

/** Does the Earth hide scene point p from camera position c? */
export function occludedByEarth(c, p) {
  const cx = c.x;
  const cy = c.y * K;
  const cz = c.z;
  const dx = p.x - cx;
  const dy = p.y * K - cy;
  const dz = p.z - cz;
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (cx * dx + cy * dy + cz * dz);
  const cc = cx * cx + cy * cy + cz * cz - 1;
  const disc = b * b - 4 * a * cc;
  if (disc <= 0) return false;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t > 0 && t < 1;
}

/**
 * Nearest visible satellite to pixel (px, py) within `radius` CSS px.
 * @returns {number} index, or −1
 */
export function pickNearest(swarm, camera, px, py, width, height, radius = 10) {
  if (!swarm.count || !swarm.ready) return -1;
  vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const e = vp.elements;
  const pos = swarm.position;
  const r2 = radius * radius;
  const hits = [];
  for (let i = 0; i < swarm.count; i++) {
    if (!swarm.ok[i] || !swarm.shown[i]) continue;
    const x = pos[3 * i];
    const y = pos[3 * i + 1];
    const z = pos[3 * i + 2];
    const w = e[3] * x + e[7] * y + e[11] * z + e[15];
    if (w <= 0) continue;
    const sx = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / w * 0.5 + 0.5) * width;
    const sy = (0.5 - (e[1] * x + e[5] * y + e[9] * z + e[13]) / w * 0.5) * height;
    const d = (sx - px) ** 2 + (sy - py) ** 2;
    if (d < r2) hits.push([d, i]);
  }
  hits.sort((a, b) => a[0] - b[0]);
  const p = new THREE.Vector3();
  for (const [, i] of hits.slice(0, 12)) {
    p.set(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
    if (!occludedByEarth(camera.position, p)) return i;
  }
  return -1;
}
