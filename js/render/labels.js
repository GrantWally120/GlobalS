// HTML labels pinned to 3D points (selected satellite, hovered satellite, observer).

import * as THREE from 'three';
import { occludedByEarth } from './picking.js';

export class Labels {
  constructor(container, camera) {
    this.container = container;
    this.camera = camera;
    this.items = new Map();
    this.v = new THREE.Vector3();
  }

  /** Create or update label `key`; `getWorld(out)` fills the world position (return false to hide). */
  set(key, { text, sub = '', className = '', getWorld }) {
    let item = this.items.get(key);
    if (!item) {
      const el = document.createElement('div');
      el.className = `label ${className}`;
      el.append(document.createElement('span'), document.createElement('span'));
      el.lastChild.className = 'sub';
      this.container.append(el);
      item = { el };
      this.items.set(key, item);
    }
    item.getWorld = getWorld;
    if (item.text !== text) item.el.firstChild.textContent = item.text = text;
    if (item.sub !== sub) item.el.lastChild.textContent = item.sub = sub;
    item.el.className = `label ${className}`;
  }

  remove(key) {
    const item = this.items.get(key);
    if (item) {
      item.el.remove();
      this.items.delete(key);
    }
  }

  update(width, height) {
    for (const item of this.items.values()) {
      const v = this.v;
      const ok = item.getWorld(v);
      if (!ok || occludedByEarth(this.camera.position, v)) {
        item.el.style.display = 'none';
        continue;
      }
      v.project(this.camera);
      if (v.z > 1 || v.z < -1) {
        item.el.style.display = 'none';
        continue;
      }
      item.el.style.display = '';
      const x = (v.x * 0.5 + 0.5) * width + 14;
      const y = (0.5 - v.y * 0.5) * height - 10;
      item.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
  }
}
