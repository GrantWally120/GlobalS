// The real sky: 5,044 naked-eye stars (XHIP, via d3-celestial) precessed to the date, IAU
// constellation lines, and the Sun at its true position. Rendered in its own pass behind
// everything, from a camera that shares the main camera's orientation (no parallax, no clipping).

import * as THREE from 'three';
import { lonToRaDeg, magToAlpha, magToSize, precessionMatrix, raDecToUnit, starBuffers } from '../core/stars.js';

const R = 100; // sky sphere radius in the sky scene

const STAR_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    gl_PointSize = aSize * uPixelRatio * 2.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const STAR_FRAG = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = dot(p, p);
    if (d > 1.0) discard;
    float core = exp(-d * 5.0);
    gl_FragColor = vec4(vColor, core * vAlpha * uOpacity);
    #include <colorspace_fragment>
  }
`;

// ECI (z north) → scene (y up), as in core/frames.js, applied to unit vectors.
const toSky = (x, y, z) => [x * R, z * R, -y * R];

function glowTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.18, inner);
  grad.addColorStop(0.35, outer);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * @param {THREE.Scene} skyScene
 * @param {object} starsGeo stars.6.json
 * @param {object} linesGeo constellations.lines.json
 */
export function createSky(skyScene, starsGeo, linesGeo) {
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  skyScene.add(group);

  const buf = starBuffers(starsGeo);
  const pos = new Float32Array(buf.count * 3);
  const size = new Float32Array(buf.count);
  const alpha = new Float32Array(buf.count);
  for (let i = 0; i < buf.count; i++) {
    pos.set(toSky(buf.pos[3 * i], buf.pos[3 * i + 1], buf.pos[3 * i + 2]), 3 * i);
    size[i] = magToSize(buf.mag[i]);
    alpha[i] = magToAlpha(buf.mag[i]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  g.setAttribute('aColor', new THREE.BufferAttribute(buf.color, 3));
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: 1 }, uOpacity: { value: 1 } },
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const stars = new THREE.Points(g, starMat);
  group.add(stars);

  // Constellation stick figures.
  const seg = [];
  for (const f of linesGeo.features) {
    for (const line of f.geometry.coordinates) {
      for (let i = 1; i < line.length; i++) {
        for (const [lon, lat] of [line[i - 1], line[i]]) {
          const u = raDecToUnit((lonToRaDeg(lon) * Math.PI) / 180, (lat * Math.PI) / 180);
          seg.push(...toSky(u[0], u[1], u[2]));
        }
      }
    }
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
  const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#4ff0ff', transparent: true, opacity: 0.14, depthWrite: false }));
  group.add(lines);

  // The Sun (drawn outside the precessed group: its direction is already of-date).
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture('rgba(255,248,230,1)', 'rgba(255,190,90,0.35)'),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  sun.scale.setScalar(9);
  skyScene.add(sun);

  let precessedFor = NaN;
  return {
    group,
    stars,
    lines,
    sun,
    setPixelRatio(dpr) {
      starMat.uniforms.uPixelRatio.value = dpr;
    },
    /** Re-precess when the date moves by more than ~30 days (0.004°). */
    setDate(tMs) {
      if (Math.abs(tMs - precessedFor) < 30 * 86400e3) return;
      precessedFor = tMs;
      const p = precessionMatrix(tMs); // ECI rows
      // Conjugate by the axis map M: (x, y, z) → (x, z, −y), so it acts on scene vectors.
      const e = (r, c) => p[3 * r + c];
      group.matrix.set(
        e(0, 0), e(0, 2), -e(0, 1), 0,
        e(2, 0), e(2, 2), -e(2, 1), 0,
        -e(1, 0), -e(1, 2), e(1, 1), 0,
        0, 0, 0, 1,
      );
      group.matrixWorldNeedsUpdate = true;
    },
    setSun(sunEci) {
      sun.position.set(...toSky(sunEci.x, sunEci.y, sunEci.z)).multiplyScalar(0.9);
    },
  };
}
