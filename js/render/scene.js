// Renderer, cameras, controls and the two-pass draw (sky first, then Earth and satellites).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.autoClear = false;
  renderer.setClearColor(0x02040a, 1);

  const scene = new THREE.Scene();
  const skyScene = new THREE.Scene();
  const earthGroup = new THREE.Group(); // rotates with the Earth (rotation.y = GMST)
  earthGroup.name = 'earth';
  scene.add(earthGroup);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
  const skyCamera = new THREE.PerspectiveCamera(38, 1, 0.1, 1000);
  camera.position.set(0, 0, 3.4);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.rotateSpeed = 0.45;
  controls.zoomSpeed = 0.9;
  controls.minDistance = 1.06;
  controls.maxDistance = 40;

  const listeners = new Set();
  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    skyCamera.aspect = w / h;
    skyCamera.updateProjectionMatrix();
    for (const fn of listeners) fn(w, h, renderer.getPixelRatio());
  }
  new ResizeObserver(resize).observe(canvas);
  window.addEventListener('resize', resize);
  resize();

  /** Keep the depth range tight around what is actually in view. */
  function updateClipping(focusDistance = Infinity) {
    const d = camera.position.length();
    const toSurface = Math.max(d - 1, 1e-4);
    camera.near = Math.min(0.5, Math.max(1e-5, 0.25 * Math.min(toSurface, focusDistance)));
    camera.far = d + 80;
    camera.updateProjectionMatrix();
  }

  function render() {
    renderer.clear();
    skyCamera.quaternion.copy(camera.quaternion);
    if (skyCamera.fov !== camera.fov) {
      skyCamera.fov = camera.fov;
      skyCamera.updateProjectionMatrix();
    }
    renderer.render(skyScene, skyCamera);
    renderer.clearDepth();
    renderer.render(scene, camera);
  }

  return {
    THREE, renderer, scene, skyScene, earthGroup, camera, skyCamera, controls, render, updateClipping,
    onResize: (fn) => {
      listeners.add(fn);
      fn(canvas.clientWidth, canvas.clientHeight, renderer.getPixelRatio());
    },
    size: () => ({ w: canvas.clientWidth, h: canvas.clientHeight, dpr: renderer.getPixelRatio() }),
  };
}
