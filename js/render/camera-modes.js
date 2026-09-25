// Camera behaviours: Earth-locked (default — the view turns with the Earth, so the Philippines stay
// put), inertial (Earth spins beneath a fixed camera), and following the selected satellite.

import * as THREE from 'three';

export class CameraModes {
  constructor(stage) {
    this.stage = stage;
    this.mode = 'earth';
    this.lastGmst = null;
    this.followPos = new THREE.Vector3();
    this.tween = null;
  }

  setMode(mode) {
    this.mode = mode;
    if (mode !== 'follow') this.#tweenTarget(new THREE.Vector3(0, 0, 0));
  }

  /** Turn the camera with the Earth by the change in sidereal angle since last frame. */
  applyEarthLock(gmst) {
    if (this.lastGmst === null) this.lastGmst = gmst;
    let d = gmst - this.lastGmst;
    this.lastGmst = gmst;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    if (this.mode !== 'earth' || d === 0) return;
    const { camera, controls } = this.stage;
    camera.position.applyAxisAngle(THREE.Object3D.DEFAULT_UP, d);
    controls.target.applyAxisAngle(THREE.Object3D.DEFAULT_UP, d);
  }

  /** Keep the camera's offset from a moving satellite. */
  follow(pos) {
    if (this.mode !== 'follow' || !pos) return;
    const { camera, controls } = this.stage;
    if (this.followPos.lengthSq() === 0) this.followPos.copy(pos);
    const delta = pos.clone().sub(this.followPos);
    camera.position.add(delta);
    controls.target.add(delta);
    this.followPos.copy(pos);
  }

  startFollow(pos) {
    this.mode = 'follow';
    this.followPos.copy(pos);
    const { camera, controls } = this.stage;
    const offset = camera.position.clone().sub(controls.target);
    const dist = Math.min(offset.length(), 0.6);
    controls.target.copy(pos);
    camera.position.copy(pos).add(offset.setLength(dist));
    controls.minDistance = 0.01;
  }

  stopFollow() {
    this.stage.controls.minDistance = 1.06;
    this.followPos.set(0, 0, 0);
    this.setMode('earth');
  }

  /** Point the camera at a scene position from a given distance, keeping the view up. */
  lookAtFrom(pos, distance) {
    const { camera, controls } = this.stage;
    if (!(pos.lengthSq() > 1e-12) || !Number.isFinite(distance)) return;
    const dir = pos.clone().normalize();
    this.#tweenTarget(new THREE.Vector3(0, 0, 0));
    this.tweenCamera = { from: camera.position.clone(), to: dir.multiplyScalar(distance), t0: performance.now(), dur: 900 };
    controls.update();
  }

  #tweenTarget(to) {
    this.tween = { from: this.stage.controls.target.clone(), to, t0: performance.now(), dur: 700 };
  }

  tick() {
    const now = performance.now();
    const ease = (x) => 1 - (1 - x) ** 3;
    if (this.tween) {
      const k = Math.min(1, (now - this.tween.t0) / this.tween.dur);
      this.stage.controls.target.lerpVectors(this.tween.from, this.tween.to, ease(k));
      if (k >= 1) this.tween = null;
    }
    if (this.tweenCamera) {
      const k = Math.min(1, (now - this.tweenCamera.t0) / this.tweenCamera.dur);
      // move along the sphere so the camera doesn't dive through the Earth
      const a = this.tweenCamera.from;
      const b = this.tweenCamera.to;
      const len = a.length() + (b.length() - a.length()) * ease(k);
      this.stage.camera.position.copy(a).normalize().lerp(b.clone().normalize(), ease(k)).setLength(len);
      if (k >= 1) this.tweenCamera = null;
    }
  }
}
