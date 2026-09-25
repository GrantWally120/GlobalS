// Every satellite as one GPU point cloud. The propagator worker supplies SGP4 keyframes on a
// fixed time grid; each frame the main thread blends the bracketing pair with cubic Hermite
// interpolation (exact at the keyframes, sub-metre between them at 1×) into one position buffer.

import * as THREE from 'three';
import { CATEGORY_STYLE } from '../config.js';
import { hermiteBasis } from '../core/interp.js';
import { KeyframeCache, keyPair, neededKeys } from '../core/keyframes.js';

const VERT = /* glsl */ `
  attribute vec3 color;
  attribute vec2 aState;   // x: sunlit 0..1, y: shown 0/1
  attribute float aSize;
  uniform float uPixelRatio, uScale;
  varying vec3 vColor;
  varying float vLit;
  varying float vAlpha;
  void main() {
    vColor = color;
    vLit = aState.x;
    vAlpha = aState.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float near = clamp(3.0 / -mv.z, 0.75, 1.6);      // a little larger when close
    gl_PointSize = aState.y > 0.0 ? aSize * uScale * uPixelRatio * near : 0.0;
  }
`;
const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vLit;
  varying float vAlpha;
  void main() {
    if (vAlpha <= 0.0) discard;
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = dot(p, p);
    if (d > 1.0) discard;
    float shade = mix(0.42, 1.0, vLit);               // satellites in Earth's shadow are dimmer
    float a = smoothstep(1.0, 0.35, d) * vAlpha;
    gl_FragColor = vec4(vColor * shade, a);
    #include <colorspace_fragment>
  }
`;

export class Swarm {
  constructor(scene, client) {
    this.client = client;
    this.cache = new KeyframeCache(8);
    this.inflight = new Set();
    this.gen = 1;
    this.catalogGen = 0;
    this.count = 0;
    this.ready = false;
    this.waitingSince = 0;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: 1 }, uScale: { value: 4.4 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
    client.on('keyframe', (m) => this.#onKeyframe(m));
  }

  /** New catalogue: allocate buffers and colour by category. */
  setCatalog(meta, categoryKeys) {
    const n = meta.count;
    this.count = n;
    this.catalogGen++;
    this.cache.clear();
    this.inflight.clear();
    this.ready = false;
    this.gen++;
    this.meta = meta;
    this.position = new Float32Array(n * 3);
    this.lit = new Float32Array(n).fill(1);
    this.ok = new Uint8Array(n);
    this.shown = new Uint8Array(n).fill(1);
    const color = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const alpha = new Float32Array(n);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const style = CATEGORY_STYLE[categoryKeys[meta.cats[i]]] ?? CATEGORY_STYLE.other;
      c.set(style.color);
      color[3 * i] = c.r;
      color[3 * i + 1] = c.g;
      color[3 * i + 2] = c.b;
      size[i] = style.size;
      alpha[i] = style.alpha;
    }
    this.alphaBase = alpha;
    this.state = new Float32Array(n * 2);
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage);
    this.stateAttr = new THREE.BufferAttribute(this.state, 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('color', new THREE.BufferAttribute(color, 3));
    g.setAttribute('aState', this.stateAttr);
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.points.geometry.dispose();
    this.points.geometry = g;
  }

  /** Which objects the filters currently show (1 = shown). */
  setShown(mask) {
    this.shown = mask;
  }

  /** Call after a time jump so queued keyframe work is abandoned. */
  invalidate() {
    this.gen++;
    this.inflight.clear();
  }

  #onKeyframe(m) {
    this.inflight.delete(m.t);
    if (m.count !== this.count) return; // from a previous catalogue
    this.cache.put(m.t, m, this.lastT ?? m.t);
  }

  /** Blend keyframes for sim time t (ms) at warp `rate`. Returns false while waiting for data. */
  update(t, rate) {
    if (!this.count) return false;
    this.lastT = t;
    const missing = neededKeys(t, rate).filter((k) => !this.cache.has(k) && !this.inflight.has(k));
    if (missing.length) {
      for (const k of missing) this.inflight.add(k);
      this.client.post('keys', { times: missing, gen: this.gen });
    }
    const { ta, tb, h } = keyPair(t, rate);
    const A = this.cache.get(ta);
    const B = this.cache.get(tb);
    if (!A || !B) {
      if (!this.waitingSince) this.waitingSince = performance.now();
      return false;
    }
    this.waitingSince = 0;
    const s = (t - ta) / h;
    const [b0, b1, b2, b3] = hermiteBasis(s, h / 1000);
    const P0 = A.pos;
    const V0 = A.vel;
    const P1 = B.pos;
    const V1 = B.vel;
    const out = this.position;
    const st = this.state;
    let lit = 0;
    let shown = 0;
    for (let i = 0; i < this.count; i++) {
      const ok = A.ok[i] & B.ok[i];
      this.ok[i] = ok;
      const k = 3 * i;
      if (ok) {
        out[k] = b0 * P0[k] + b1 * V0[k] + b2 * P1[k] + b3 * V1[k];
        out[k + 1] = b0 * P0[k + 1] + b1 * V0[k + 1] + b2 * P1[k + 1] + b3 * V1[k + 1];
        out[k + 2] = b0 * P0[k + 2] + b1 * V0[k + 2] + b2 * P1[k + 2] + b3 * V1[k + 2];
      }
      const l = ((1 - s) * A.lit[i] + s * B.lit[i]) / 255;
      this.lit[i] = l;
      const vis = ok && this.shown[i] ? this.alphaBase[i] : 0;
      st[2 * i] = l;
      st[2 * i + 1] = vis;
      if (vis) {
        shown++;
        if (l > 0.5) lit++;
      }
    }
    this.posAttr.needsUpdate = true;
    this.stateAttr.needsUpdate = true;
    this.ready = true;
    this.stats = { shown, lit };
    return true;
  }

  /** Waiting noticeably long for keyframes (e.g. just after a big jump)? */
  isStalled(ms = 200) {
    return this.waitingSince && performance.now() - this.waitingSince > ms;
  }

  setPixelRatio(dpr) {
    this.material.uniforms.uPixelRatio.value = dpr;
  }

  /** Current scene-space position of object i (returns false if unknown). */
  positionOf(i, out) {
    if (!this.ok[i]) return false;
    out.set(this.position[3 * i], this.position[3 * i + 1], this.position[3 * i + 2]);
    return true;
  }
}
