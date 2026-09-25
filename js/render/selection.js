// What gets drawn for the selected satellite: marker, orbit (inertial), ground track and footprint
// (Earth-fixed), and a nadir line; plus a lighter marker for the hovered one.

import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { DEG, eciToEcf, ecfToEci, ecfToGeodetic, geodeticToEcf, geodeticToScene, toScene } from '../core/frames.js';
import { footprintRing, periodSec, sampleGroundTrack, sampleOrbitEci } from '../core/orbit.js';
import { gmstFromMs, propagateMs } from '../core/sat.js';

const RING_VERT = /* glsl */ `
  uniform float uSize, uPixelRatio;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * uPixelRatio;
  }
`;
const RING_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = length(p);
    float ring = smoothstep(0.08, 0.0, abs(r - 0.78));
    float core = smoothstep(0.32, 0.18, r);
    float pulse = 0.65 + 0.35 * sin(uTime * 4.0);
    float a = max(ring * pulse, core);
    if (a < 0.02) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`;

function ringMarker(color, size) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uSize: { value: size }, uPixelRatio: { value: 1 }, uTime: { value: 0 } },
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.renderOrder = 6;
  p.visible = false;
  return p;
}

function fatLine(color, width, opacity, vertexColors = false) {
  const m = new LineMaterial({ color, linewidth: width, transparent: true, opacity, vertexColors, depthWrite: false });
  const l = new Line2(new LineGeometry(), m);
  l.frustumCulled = false;
  l.renderOrder = 4;
  l.visible = false;
  return l;
}

export class Selection {
  constructor(stage) {
    this.stage = stage;
    this.rec = null;
    this.marker = ringMarker('#ffb547', 26);
    this.hover = ringMarker('#d8eef7', 18);
    stage.scene.add(this.marker, this.hover);
    this.orbit = fatLine('#ffb547', 1.6, 0.85);
    stage.scene.add(this.orbit);
    this.track = fatLine('#ffffff', 1.6, 0.9, true);
    stage.earthGroup.add(this.track);
    this.footprint = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#ffb547', transparent: true, opacity: 0.55, depthWrite: false }));
    this.footprint.visible = false;
    this.footprint.frustumCulled = false;
    stage.earthGroup.add(this.footprint);
    this.nadir = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#ffb547', transparent: true, opacity: 0.35, depthWrite: false }));
    this.nadir.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.nadir.visible = false;
    this.nadir.frustumCulled = false;
    stage.scene.add(this.nadir);
    this.showPaths = true;
    this.position = new THREE.Vector3();
    this.builtOrbitAt = NaN;
    this.builtTrackAt = NaN;
    this.builtFootAt = NaN;
    stage.onResize((w, h, dpr) => {
      for (const l of [this.orbit, this.track]) l.material.resolution.set(w, h);
      this.marker.material.uniforms.uPixelRatio.value = dpr;
      this.hover.material.uniforms.uPixelRatio.value = dpr;
    });
  }

  set(rec, colorHex) {
    this.rec = rec;
    this.builtOrbitAt = this.builtTrackAt = this.builtFootAt = NaN;
    this.marker.visible = false; // shown once update() has computed a real position
    if (colorHex) this.marker.material.uniforms.uColor.value.set(colorHex);
    for (const o of [this.orbit, this.track, this.footprint, this.nadir]) o.visible = !!rec && this.showPaths;
    this.state = null;
  }

  setPaths(on) {
    this.showPaths = on;
    if (this.rec) for (const o of [this.orbit, this.track, this.footprint, this.nadir]) o.visible = on;
  }

  /** Exact SGP4 state for the selected satellite at t (ms); rebuilds paths when they go stale. */
  update(t, rate, minElDeg) {
    this.marker.material.uniforms.uTime.value = performance.now() / 1000;
    if (!this.rec) return null;
    const pv = propagateMs(this.rec, t);
    if (!pv) {
      this.marker.visible = false;
      this.state = null;
      return null;
    }
    const gmst = gmstFromMs(t);
    const ecf = eciToEcf(pv.r, gmst);
    this.marker.visible = true;
    this.position.set(...toScene(pv.r.x, pv.r.y, pv.r.z));
    this.marker.position.copy(this.position);
    this.state = { t, r: pv.r, v: pv.v, ecf, gmst, geo: ecfToGeodetic(ecf) };

    if (this.showPaths) {
      const P = periodSec(this.rec) * 1000;
      const coarse = Math.abs(rate) > 600 ? 10 : 1;
      if (!(Math.abs(t - this.builtOrbitAt) < (P / 72) * coarse)) this.#buildOrbit(t);
      if (!(Math.abs(t - this.builtTrackAt) < Math.max(1000, Math.abs(rate) * 1000) * coarse)) this.#buildTrack(t, P);
      if (!(Math.abs(t - this.builtFootAt) < 100 * Math.max(1, Math.abs(rate)))) this.#buildFootprint(ecf, minElDeg);
      const sub = this.state.geo;
      const ground = ecfToEci(geodeticToEcf(sub.lat, sub.lon, 0), gmst);
      const arr = this.nadir.geometry.attributes.position.array;
      arr.set(this.position.toArray(), 0);
      arr.set(toScene(ground.x, ground.y, ground.z), 3);
      this.nadir.geometry.attributes.position.needsUpdate = true;
    }
    return this.state;
  }

  #buildOrbit(t) {
    this.builtOrbitAt = t;
    const pts = sampleOrbitEci(this.rec, t);
    const flat = new Float32Array(pts.length);
    for (let i = 0; i < pts.length; i += 3) flat.set(toScene(pts[i], pts[i + 1], pts[i + 2]), i);
    if (flat.length < 6) return;
    this.orbit.geometry.dispose();
    this.orbit.geometry = new LineGeometry().setPositions(flat);
    this.orbit.computeLineDistances();
  }

  #buildTrack(t, P) {
    this.builtTrackAt = t;
    const span = Math.min(P, 86400e3);
    const pts = sampleGroundTrack(this.rec, t - span, t + 2 * span);
    if (pts.length < 2) return;
    const pos = new Float32Array(pts.length * 3);
    const col = new Float32Array(pts.length * 3);
    const a = [0, 0, 0];
    pts.forEach((p, i) => {
      geodeticToScene(p.latDeg, p.lonDeg, 6, a);
      pos.set(a, 3 * i);
      const future = p.t >= t;
      const fade = future ? 1 - 0.55 * Math.min(1, (p.t - t) / (2 * span)) : 0.35;
      col.set(future ? [1 * fade, 0.71 * fade, 0.28 * fade] : [0.3 * fade + 0.1, 0.6 * fade, 0.7 * fade], 3 * i);
    });
    this.track.geometry.dispose();
    this.track.geometry = new LineGeometry().setPositions(pos).setColors(col);
  }

  #buildFootprint(ecf, minElDeg) {
    this.builtFootAt = this.state.t;
    const ring = footprintRing(ecf, minElDeg ?? 0, 96);
    const pos = new Float32Array(ring.length * 3);
    const a = [0, 0, 0];
    ring.forEach((p, i) => pos.set(geodeticToScene(p.latDeg, p.lonDeg, 4, a), 3 * i));
    this.footprint.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.footprint.geometry = g;
  }

  setHover(pos) {
    this.hover.visible = !!pos;
    if (pos) this.hover.position.copy(pos);
  }
}

/** Observer marker on the ground (Earth-fixed). */
export function observerMarker(earthGroup) {
  const m = ringMarker('#ffb547', 16);
  m.material.uniforms.uColor.value.set('#ffb547');
  m.visible = true;
  earthGroup.add(m);
  return {
    mesh: m,
    set(latDeg, lonDeg, hKm) {
      m.position.set(...geodeticToScene(latDeg, lonDeg, hKm + 3));
    },
    setPixelRatio(dpr) {
      m.material.uniforms.uPixelRatio.value = dpr;
    },
    tick() {
      m.material.uniforms.uTime.value = performance.now() / 1000;
    },
  };
}

export const RAD_TO_DEG = 1 / DEG;
