// The Earth: a WGS-84 ellipsoid with two looks — holographic HUD and NASA photoreal — plus
// coastlines, borders and a graticule. Everything here lives in the Earth group, which rotates
// with GMST, so it is modelled in Earth-fixed coordinates.

import * as THREE from 'three';
import { DEG, geodeticNormal, geodeticToScene, toScene } from '../core/frames.js';

const SIN = (deg) => Math.sin(deg * DEG);

/** Ellipsoid mesh with geodetic normals and exact equirectangular UVs (north = v 1). */
export function ellipsoidGeometry(latSeg = 128, lonSeg = 256) {
  const pos = [];
  const nrm = [];
  const uv = [];
  const idx = [];
  const tmp = [0, 0, 0];
  for (let i = 0; i <= latSeg; i++) {
    const lat = 90 - (180 * i) / latSeg;
    for (let j = 0; j <= lonSeg; j++) {
      const lon = -180 + (360 * j) / lonSeg;
      geodeticToScene(lat, lon, 0, tmp);
      pos.push(...tmp);
      const n = geodeticNormal(lat * DEG, lon * DEG);
      nrm.push(n.x, n.z, -n.y); // same axis mapping as toScene (a pure rotation)
      uv.push(j / lonSeg, 1 - i / latSeg);
    }
  }
  const row = lonSeg + 1;
  for (let i = 0; i < latSeg; i++) {
    for (let j = 0; j < lonSeg; j++) {
      const a = i * row + j;
      const b = a + row;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Land mask texture (rows north→south, so shaders sample it at 1 − v). */
export function maskTexture(mask, W, H) {
  const t = new THREE.DataTexture(mask, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.NoColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

const COMMON_VERT = /* glsl */ `
  varying vec3 vNormal;     // Earth-fixed (model) normal: geodetic up
  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying vec3 vViewPos;
  void main() {
    vNormal = normal;
    vUv = uv;
    vViewNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const HUD_FRAG = /* glsl */ `
  #define PI 3.141592653589793
  uniform sampler2D uMask;
  uniform vec3 uSun;          // unit vector to the Sun, Earth-fixed scene axes
  uniform vec3 uOcean, uOceanNight, uLand, uLandNight, uTerm, uRim;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying vec3 vViewPos;

  float land(vec2 uv) { return texture2D(uMask, vec2(uv.x, 1.0 - uv.y)).r; }

  // Dots on an equal-area grid: rows every sp radians of latitude, spaced sp along each row.
  float dots(float lat, float lon, float sp, float pxPerRad) {
    float rowLat = floor(lat / sp + 0.5) * sp;
    float perRow = max(1.0, floor(2.0 * PI * cos(rowLat) / sp));
    float dl = 2.0 * PI / perRow;
    float dotLon = -PI + (floor((lon + PI) / dl) + 0.5) * dl;
    vec2 dotUv = vec2((dotLon + PI) / (2.0 * PI), (rowLat + 0.5 * PI) / PI);
    float onLand = step(0.5, land(dotUv));
    float d = length(vec2((lon - dotLon) * cos(lat), lat - rowLat));
    float r = min(sp * 0.3, 2.6 / pxPerRad);                 // never bigger than ~2.6 px
    float aa = fwidth(d) + 1e-7;
    return onLand * (1.0 - smoothstep(r - aa, r + aa, d));
  }

  void main() {
    float sinAlt = dot(normalize(vNormal), uSun);
    float day = smoothstep(-0.0145, 0.14, sinAlt);            // Sun above −0.833° … ~8°
    float lat = (vUv.y - 0.5) * PI;
    float lon = (vUv.x - 0.5) * 2.0 * PI;
    float pxPerRad = 1.0 / max(fwidth(lat), 1e-7);
    float coarse = dots(lat, lon, 0.026, pxPerRad);            // 1.5°
    float fine = dots(lat, lon, 0.0087, pxPerRad);             // 0.5°
    float fineW = smoothstep(4.5, 7.0, 0.0087 * pxPerRad);     // fine dots once they are ≥ ~5 px apart
    float coarseW = smoothstep(3.0, 6.0, 0.026 * pxPerRad) * (1.0 - fineW);
    float fill = land(vUv);
    float landSig = max(max(coarse * coarseW, fine * fineW), fill * 0.22);
    vec3 col = mix(mix(uOceanNight, uOcean, day), mix(uLandNight, uLand, day), landSig);

    // Terminator (−0.833°) and civil / nautical / astronomical twilight (−6°, −12°, −18°).
    float w = fwidth(sinAlt) * 1.3;
    float t0 = 1.0 - smoothstep(0.0, w, abs(sinAlt + 0.01454));
    float t6 = 1.0 - smoothstep(0.0, w, abs(sinAlt + 0.10453));
    float t12 = 1.0 - smoothstep(0.0, w, abs(sinAlt + 0.20791));
    float t18 = 1.0 - smoothstep(0.0, w, abs(sinAlt + 0.30902));
    col += uTerm * (0.9 * t0 + 0.4 * t6 + 0.28 * t12 + 0.18 * t18);

    float fres = pow(1.0 - max(dot(normalize(vViewNormal), normalize(-vViewPos)), 0.0), 3.0);
    col += uRim * fres * (0.12 + 0.4 * day);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const PHOTO_FRAG = /* glsl */ `
  uniform sampler2D uDay, uNight, uMask;
  uniform vec3 uSun;          // Sun direction, Earth-fixed axes (for day/night)
  uniform vec3 uSunWorld;     // Sun direction, world axes (for the specular highlight)
  uniform float uHasNight;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying vec3 vViewPos;
  void main() {
    vec3 n = normalize(vNormal);
    float sinAlt = dot(n, uSun);
    float lit = smoothstep(-0.1045, 0.14, sinAlt);           // civil twilight … 8°
    float diffuse = lit * (0.35 + 0.65 * clamp(sinAlt * 1.4, 0.0, 1.0));
    vec3 day = texture2D(uDay, vUv).rgb * diffuse;
    float dark = 1.0 - smoothstep(-0.1045, 0.0, sinAlt);     // city lights after civil dusk
    vec3 lights = texture2D(uNight, vUv).rgb * vec3(1.0, 0.86, 0.62) * 1.5 * dark * uHasNight;
    // Sun glint on water only (land mask), Blinn-Phong in view space.
    float water = 1.0 - texture2D(uMask, vec2(vUv.x, 1.0 - vUv.y)).r;
    vec3 v = normalize(-vViewPos);
    vec3 s = normalize((viewMatrix * vec4(uSunWorld, 0.0)).xyz);
    vec3 h = normalize(s + v);
    float spec = pow(max(dot(normalize(vViewNormal), h), 0.0), 140.0) * water * lit * 0.3;
    float fres = pow(1.0 - max(dot(normalize(vViewNormal), v), 0.0), 4.0);
    vec3 col = day + lights + vec3(1.0, 0.95, 0.85) * spec + vec3(0.35, 0.6, 1.0) * fres * lit * 0.35 + vec3(0.004, 0.008, 0.02);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const LINE_VERT = /* glsl */ `
  uniform vec3 uSun;
  varying float vDay;
  void main() {
    vDay = smoothstep(-0.12, 0.1, dot(normalize(position), uSun));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const LINE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity, uNight;
  varying float vDay;
  void main() {
    gl_FragColor = vec4(uColor, uOpacity * mix(uNight, 1.0, vDay));
    #include <colorspace_fragment>
  }
`;

/** Line segments on the surface from flat [lon0, lat0, lon1, lat1, …] degrees, lifted by hKm. */
export function surfaceSegments(flat, hKm, color, opacity, night, sunUniform) {
  const n = flat.length / 4;
  const pos = new Float32Array(n * 6);
  const a = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    geodeticToScene(flat[4 * i + 1], flat[4 * i], hKm, a);
    pos.set(a, 6 * i);
    geodeticToScene(flat[4 * i + 3], flat[4 * i + 2], hKm, a);
    pos.set(a, 6 * i + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.ShaderMaterial({
    uniforms: { uSun: sunUniform, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uNight: { value: night } },
    vertexShader: LINE_VERT,
    fragmentShader: LINE_FRAG,
    transparent: true,
    depthWrite: false,
  });
  return new THREE.LineSegments(g, m);
}

/** Graticule every `step` degrees plus tropics and polar circles for the date's obliquity. */
export function graticuleSegments(step = 15, obliquityDeg = 23.436) {
  const major = [];
  const minor = [];
  const addParallel = (lat, out) => {
    for (let lon = -180; lon < 180; lon += 2) out.push(lon, lat, lon + 2, lat);
  };
  for (let lat = -90 + step; lat < 90; lat += step) addParallel(lat, lat === 0 ? major : minor);
  for (let lon = -180; lon < 180; lon += step) {
    for (let lat = -88; lat < 88; lat += 2) (lon === 0 ? major : minor).push(lon, lat, lon, lat + 2);
  }
  const special = [];
  for (const lat of [obliquityDeg, -obliquityDeg, 90 - obliquityDeg, -(90 - obliquityDeg)]) {
    for (let lon = -180; lon < 180; lon += 4) special.push(lon, lat, lon + 2, lat); // dashed
  }
  return { major: Float32Array.from(major), minor: Float32Array.from(minor), special: Float32Array.from(special) };
}

/**
 * Build the Earth. Returns an object with the mesh, both materials, line layers and setters.
 * @param {{coast: Float32Array, borders: Float32Array}} geo
 */
export function createEarth(earthGroup, { mask, maskW, maskH, geo }) {
  const sun = { value: new THREE.Vector3(1, 0, 0) }; // Earth-fixed scene axes
  const sunWorld = { value: new THREE.Vector3(1, 0, 0) };
  const maskTex = maskTexture(mask, maskW, maskH);
  const geometry = ellipsoidGeometry();

  const hud = new THREE.ShaderMaterial({
    uniforms: {
      uMask: { value: maskTex },
      uSun: sun,
      uOcean: { value: new THREE.Color('#0a2342') },
      uOceanNight: { value: new THREE.Color('#030a16') },
      uLand: { value: new THREE.Color('#5cffd6') },
      uLandNight: { value: new THREE.Color('#1c5a66') },
      uTerm: { value: new THREE.Color('#ffb547') },
      uRim: { value: new THREE.Color('#4ff0ff') },
    },
    vertexShader: COMMON_VERT,
    fragmentShader: HUD_FRAG,
  });

  const photo = new THREE.ShaderMaterial({
    uniforms: {
      uDay: { value: null },
      uNight: { value: null },
      uMask: { value: maskTex },
      uSun: sun,
      uSunWorld: sunWorld,
      uHasNight: { value: 0 },
    },
    vertexShader: COMMON_VERT,
    fragmentShader: PHOTO_FRAG,
  });

  const mesh = new THREE.Mesh(geometry, hud);
  mesh.name = 'earth-surface';
  mesh.renderOrder = 0;
  earthGroup.add(mesh);

  const coast = surfaceSegments(geo.coast, 2, '#4ff0ff', 0.75, 0.3, sun);
  const borders = surfaceSegments(geo.borders, 2, '#4ff0ff', 0.28, 0.35, sun);
  const grat = graticuleSegments();
  const gridMinor = surfaceSegments(grat.minor, 1, '#4ff0ff', 0.1, 0.6, sun);
  const gridMajor = surfaceSegments(grat.major, 1, '#4ff0ff', 0.32, 0.7, sun);
  const gridSpecial = surfaceSegments(grat.special, 1, '#ffb547', 0.22, 0.6, sun);
  for (const l of [coast, borders, gridMinor, gridMajor, gridSpecial]) {
    l.renderOrder = 1;
    earthGroup.add(l);
  }
  const grid = new THREE.Group();
  grid.add(gridMinor, gridMajor, gridSpecial);
  earthGroup.add(grid);

  return {
    mesh,
    hud,
    photo,
    sun,
    sunWorld,
    layers: { coast, borders, grid },
    setStyle(style) {
      mesh.material = style === 'photo' ? photo : hud;
      coast.material.uniforms.uOpacity.value = style === 'photo' ? 0.28 : 0.75;
      borders.material.uniforms.uOpacity.value = style === 'photo' ? 0.16 : 0.28;
    },
    setTextures(day, night) {
      photo.uniforms.uDay.value = day;
      photo.uniforms.uNight.value = night;
      photo.uniforms.uHasNight.value = night ? 1 : 0;
    },
    /** @param {{x,y,z}} sunEcf unit vector in ECF; @param {{x,y,z}} sunEci unit vector in ECI */
    setSun(sunEcf, sunEci) {
      sun.value.set(...toScene(sunEcf.x, sunEcf.y, sunEcf.z)).normalize();
      sunWorld.value.set(...toScene(sunEci.x, sunEci.y, sunEci.z)).normalize();
    },
  };
}

/** A natural-colour stand-in for the NASA day texture, painted from the land mask (maskW×maskH). */
export function fallbackDayTexture(mask, maskW, maskH, W = 2048, H = 1024) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const lat = 90 - ((y + 0.5) / H) * 180;
    const ice = Math.abs(lat) > 66 ? Math.min(1, (Math.abs(lat) - 66) / 10) : 0;
    const dry = Math.max(0, 1 - Math.abs(Math.abs(lat) - 24) / 12); // subtropical desert belts
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const m = mask[Math.floor((y * maskH) / H) * maskW + Math.floor((x * maskW) / W)];
      if (m) {
        const r = 58 + 100 * dry;
        const g = 92 + 40 * dry;
        const b = 44 + 30 * dry;
        img.data[i] = r + (235 - r) * ice;
        img.data[i + 1] = g + (240 - g) * ice;
        img.data[i + 2] = b + (245 - b) * ice;
      } else {
        img.data[i] = 10;
        img.data[i + 1] = 38 + 10 * (1 - Math.abs(lat) / 90);
        img.data[i + 2] = 82;
      }
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Load a NASA texture, downscaled if the GPU can't hold it (or memory is tight).
 * @returns {Promise<THREE.Texture|null>}
 */
export async function loadTexture(url, renderer, { maxWidth } = {}) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const limit = Math.min(renderer.capabilities.maxTextureSize, maxWidth ?? ((navigator.deviceMemory ?? 8) <= 4 ? 2048 : 4096));
    const probe = await createImageBitmap(blob);
    const { width, height } = probe; // read before close(): a closed bitmap reports 0×0
    probe.close?.();
    const scale = Math.min(1, limit / width);
    const bitmap = await createImageBitmap(blob, scale < 1
      ? { resizeWidth: Math.round(width * scale), resizeHeight: Math.round(height * scale), resizeQuality: 'high', imageOrientation: 'flipY' }
      : { imageOrientation: 'flipY' });
    const t = new THREE.Texture(bitmap);
    t.flipY = false; // already flipped by createImageBitmap
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    t.needsUpdate = true;
    return t;
  } catch {
    return null;
  }
}
