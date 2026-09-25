// A thin glowing shell of atmosphere, brighter on the sunlit limb and tinted at the terminator.

import * as THREE from 'three';

const VERT = /* glsl */ `
  varying vec3 vViewNormal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  void main() {
    vViewNormal = normalize(normalMatrix * normal);
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uSunWorld, uDayColor, uNightColor, uTwilight;
  uniform float uStrength;
  varying vec3 vViewNormal;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  void main() {
    float rim = pow(clamp(0.74 - dot(vViewNormal, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 2.6);
    // Light the glow by the limb it belongs to (the normal with the line-of-sight component
    // removed), not by the back face, which points at the far side of the planet.
    vec3 view = normalize(vWorldPos - cameraPosition);
    vec3 n = normalize(vWorldNormal);
    vec3 limb = normalize(n - dot(n, view) * view + 1e-6);
    float s = dot(limb, uSunWorld);
    float lit = smoothstep(-0.35, 0.25, s);
    float dusk = exp(-pow(s / 0.18, 2.0)) * 0.8;
    vec3 col = mix(uNightColor, uDayColor, lit) + uTwilight * dusk;
    gl_FragColor = vec4(col * rim * uStrength, 1.0);
    #include <colorspace_fragment>
  }
`;

export function createAtmosphere(scene, sunWorld) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSunWorld: sunWorld,
      uDayColor: { value: new THREE.Color('#4ff0ff') },
      uNightColor: { value: new THREE.Color('#0d3550') },
      uTwilight: { value: new THREE.Color('#ff9a3c') },
      uStrength: { value: 1.0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1.1, 96, 64), material);
  mesh.scale.set(1, 0.9966, 1); // follow the Earth's flattening
  mesh.renderOrder = 2;
  scene.add(mesh);
  return {
    mesh,
    setStyle(style) {
      material.uniforms.uDayColor.value.set(style === 'photo' ? '#5aa8ff' : '#4ff0ff');
      material.uniforms.uStrength.value = style === 'photo' ? 0.9 : 1.0;
    },
  };
}
