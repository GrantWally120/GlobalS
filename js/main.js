// GlobalS — boot sequence, render loop and the `app` object the UI talks to.

import * as THREE from 'three';
import { APP_VERSION, CATEGORY_STYLE, DATA_AGE, OVERHEAD_MIN_EL, PASS_DEFAULTS } from './config.js';
import { CATEGORIES, CATEGORY_INDEX, FACETS, buildSearchIndex } from './core/catalog.js';
import { SimClock } from './core/clock.js';
import { fmtAge, fmtInt } from './core/format.js';
import { ecfToEci, eciToEcf, geodeticToEcf, toScene } from './core/frames.js';
import { geography } from './core/geo.js';
import { rasterizeRings } from './core/landmask.js';
import { makeObserver } from './core/look.js';
import { gmstFromMs, recFromAny } from './core/sat.js';
import { sunDirEci } from './core/sun.js';
import { parseTimeParam } from './core/time.js';
import { dataAgeHours, resolveData } from './data/loader.js';
import { createAtmosphere } from './render/atmosphere.js';
import { CameraModes } from './render/camera-modes.js';
import { createEarth, fallbackDayTexture, loadTexture } from './render/earth.js';
import { Labels } from './render/labels.js';
import { pickNearest } from './render/picking.js';
import { createStage } from './render/scene.js';
import { Selection, observerMarker } from './render/selection.js';
import { createSky } from './render/sky.js';
import { Swarm } from './render/swarm.js';
import { createBoot } from './ui/boot.js';
import { initDataView } from './ui/data-view.js';
import { initDetails } from './ui/details.js';
import { $, $$, setText } from './ui/dom.js';
import { initInstall } from './ui/install.js';
import { initKeyboard } from './ui/keyboard.js';
import { initPassesView } from './ui/passes-view.js';
import { initSkyView } from './ui/sky-view.js';
import { saveSettings, settings } from './ui/store.js';
import { LOCAL_TZ, initTimebar } from './ui/timebar.js';
import { toast } from './ui/toasts.js';
import { initTracking } from './ui/tracking.js';
import { WorkerClient } from './workers/rpc.js';

const params = new URLSearchParams(location.search);
const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const boot = createBoot();

async function json(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
  return res.json();
}

function hasWebGL2() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

const plainObserver = (o) => ({ name: o.name, latDeg: o.latDeg, lonDeg: o.lonDeg, hKm: o.hKm });

async function start() {
  setText($('#appVersion'), `v${APP_VERSION}`);
  boot.progress(3, 'GRAPHICS');
  if (!hasWebGL2()) {
    boot.log('err', 'WebGL 2 is not available');
    boot.fail('GlobalS needs WebGL 2. Update your browser or graphics driver, or turn on hardware acceleration in the browser settings (Edge: Settings → System and performance).');
    return;
  }
  const stage = createStage($('#scene'));
  boot.log('ok', `WebGL 2 · textures up to ${stage.renderer.capabilities.maxTextureSize}px`);

  // ---------- clock ----------
  const clock = new SimClock();
  const tParam = params.get('t');
  if (tParam) {
    const t = parseTimeParam(tParam, Date.now(), LOCAL_TZ);
    if (Number.isFinite(t)) clock.jump(t);
  }
  if (params.has('rate')) clock.setRate(Number(params.get('rate')) || 0);

  // ---------- geography, stars ----------
  boot.progress(10, 'GEOGRAPHY');
  const [topo, starsGeo, linesGeo] = await Promise.all([
    json('assets/geo/countries-50m.json'),
    json('assets/stars/stars.6.json'),
    json('assets/stars/constellations.lines.json'),
  ]);
  const geo = geography(topo);
  const MASK_W = 4096;
  const MASK_H = 2048;
  const mask = rasterizeRings(geo.landRings, MASK_W, MASK_H);
  const earth = createEarth(stage.earthGroup, { mask, maskW: MASK_W, maskH: MASK_H, geo });
  boot.log('ok', `Natural Earth 1:50m · ${fmtInt(geo.coast.length / 4)} coastline segments`);
  boot.progress(22, 'STAR CATALOGUE');
  const sky = createSky(stage.skyScene, starsGeo, linesGeo);
  const atmosphere = createAtmosphere(stage.scene, earth.sunWorld);
  boot.log('ok', `Star catalogue · ${fmtInt(sky.stars.geometry.attributes.position.count)} naked-eye stars (XHIP)`);

  // ---------- workers ----------
  const propagator = new WorkerClient(new URL('./workers/propagator.worker.js', import.meta.url));
  const passer = new WorkerClient(new URL('./workers/passes.worker.js', import.meta.url));
  const swarm = new Swarm(stage.scene, propagator);
  const selection = new Selection(stage);
  const labels = new Labels($('#labels'), stage.camera);
  const cams = new CameraModes(stage);
  const obsMarker = observerMarker(stage.earthGroup);
  stage.onResize((w, h, dpr) => {
    swarm.setPixelRatio(dpr);
    sky.setPixelRatio(dpr);
    obsMarker.setPixelRatio(dpr);
  });

  // ---------- the app object the UI calls ----------
  const app = {
    settings, stage, clock, swarm, selection, earth, sky, propagator, passer,
    meta: null,
    categoryKeys: CATEGORIES.map((c) => c.key),
    searchIndex: null,
    selected: -1,
    selectedRec: null,
    selectedRecord: null,
    observer: null,
    overhead: null,
    data: null,
    source: 'none',
    texturesLoaded: false,
    saveSettings,
  };

  const tracking = initTracking(app);
  const details = initDetails(app);
  const passesView = initPassesView(app);
  const skyView = initSkyView(app);
  const dataView = initDataView(app);
  const timebar = initTimebar(app);
  clock.onChange(() => timebar.update(clock.now())); // pause/warp/jump show instantly
  initKeyboard(app);
  initInstall({ isLocal, params });

  let passGen = 0;
  let tonightGen = 0;
  let tonightAt = -Infinity;
  let activeTab = 'tracking';

  function updateHash() {
    const id = app.selected >= 0 ? app.meta.ids[app.selected] : null;
    const hash = id ? `#sat=${id}` : '';
    if (location.hash !== hash) history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
  }

  function shownMask() {
    const hidden = new Set(settings.hiddenCats.map((k) => CATEGORY_INDEX[k]));
    const m = new Uint8Array(app.meta.count);
    for (let i = 0; i < m.length; i++) m[i] = hidden.has(app.meta.cats[i]) ? 0 : 1;
    if (app.selected >= 0) m[app.selected] = 1;
    return m;
  }

  function requestPasses() {
    if (!app.selectedRecord) return;
    const gen = ++passGen;
    details.setPasses(null);
    const t0 = clock.now();
    passer.call('passes', {
      record: app.selectedRecord, obs: plainObserver(app.observer), t0, t1: t0 + PASS_DEFAULTS.days * 86400e3,
      minEl: settings.minElDeg, sunAltMax: PASS_DEFAULTS.sunAltMaxDeg,
    }).then((res) => { if (gen === passGen) details.setPasses(res); })
      .catch((err) => { if (gen === passGen) details.setPasses({ error: err.message }); });
  }

  async function requestTonight() {
    if (!app.meta) return;
    const gen = ++tonightGen;
    tonightAt = clock.now();
    passesView.setTonight(null);
    const visualBit = 1 << FACETS.findIndex((f) => f.key === 'visual');
    const indices = [];
    for (let i = 0; i < app.meta.count && indices.length < 400; i++) {
      if ((app.meta.facets[i] & visualBit) || app.meta.cats[i] === CATEGORY_INDEX.stations) indices.push(i);
    }
    const records = await propagator.call('records', { indices });
    const t0 = clock.now();
    passer.call('tonight', {
      records, obs: plainObserver(app.observer), t0, t1: t0 + PASS_DEFAULTS.tonightNights * 86400e3,
      minEl: settings.minElDeg, sunAltMax: PASS_DEFAULTS.sunAltMaxDeg,
    }).then((res) => { if (gen === tonightGen) passesView.setTonight(res); })
      .catch((err) => { if (gen === tonightGen) passesView.setTonight({ error: err.message }); });
  }

  async function refreshOverhead() {
    if (!app.meta || document.hidden) return;
    const res = await propagator.call('overhead', {
      t: clock.now(), obs: plainObserver(app.observer), minEl: OVERHEAD_MIN_EL, sunAltMax: PASS_DEFAULTS.sunAltMaxDeg,
    }).catch(() => null);
    if (!res) return;
    app.overhead = res;
    if (activeTab === 'sky') skyView.update(res);
  }

  function applyCatalog(meta) {
    app.meta = meta;
    app.selected = -1;
    app.selectedRec = app.selectedRecord = null;
    selection.set(null);
    details.hide();
    app.searchIndex = buildSearchIndex(meta.names, meta.ids, meta.cospars);
    swarm.setCatalog(meta, app.categoryKeys);
    swarm.setShown(shownMask());
    tracking.setCatalog(meta);
    const ages = Array.from(meta.epochs, (e) => (clock.now() - e) / 86400e3).sort((a, b) => a - b);
    app.medianAgeDays = ages.length ? ages[Math.floor(ages.length / 2)] : NaN;
    tonightAt = -Infinity;
    if (activeTab === 'passes') requestTonight();
    refreshOverhead();
  }

  function refreshDataView() {
    dataView.setData({ data: app.data, meta: app.meta, source: app.source, clockOffsetMs: clock.offsetMs, now: clock.realNow() });
    const badge = $('#dataBadge');
    if (app.source === 'demo') {
      badge.className = 'badge optional demo';
      setText(badge, 'DEMO DATA');
    } else if (app.data?.manifest) {
      const age = dataAgeHours(app.data.manifest, clock.realNow());
      badge.className = `badge optional ${age > DATA_AGE.redHours ? 'stale' : age > DATA_AGE.amberHours ? 'aging' : 'fresh'}`;
      setText(badge, `DATA ${fmtAge(age).toUpperCase()}`);
    } else {
      badge.className = 'badge optional stale';
      setText(badge, app.source === 'import' ? 'IMPORTED' : 'NO DATA');
    }
  }

  Object.assign(app, {
    async select(i, { focus = false, passAt } = {}) {
      if (!app.meta || i < 0 || i >= app.meta.count) return;
      app.poke?.();
      app.selected = i;
      const [record] = await propagator.call('records', { indices: [i] });
      if (app.selected !== i || !record) return;
      const rec = recFromAny(record);
      if (!rec) return toast('This satellite’s orbital elements could not be used.', { kind: 'warn' });
      app.selectedRec = rec;
      app.selectedRecord = record;
      const color = CATEGORY_STYLE[app.categoryKeys[app.meta.cats[i]]]?.color;
      selection.set(rec, '#ffb547');
      swarm.setShown(shownMask());
      details.show(i);
      labels.set('sel', {
        text: app.meta.names[i], sub: `NORAD ${app.meta.ids[i]}`, className: '',
        getWorld: (v) => (selection.marker.visible ? (v.copy(selection.position), true) : false),
      });
      labels.items.get('sel').el.style.color = color;
      app.pendingFocus = focus; // done in the render loop once the exact position is known
      if (passAt) app.jumpTo(passAt - 60_000);
      updateHash();
      requestPasses();
    },
    selectById(id, opts) {
      const i = app.meta ? app.meta.ids.indexOf(id) : -1;
      if (i >= 0) app.select(i, { focus: true, ...opts });
    },
    deselect() {
      if (app.selected < 0) return;
      app.selected = -1;
      app.selectedRec = app.selectedRecord = null;
      selection.set(null);
      details.hide();
      labels.remove('sel');
      if (cams.mode === 'follow') app.toggleFollow();
      swarm.setShown(shownMask());
      updateHash();
    },
    centreOnSelected() {
      if (!app.selectedRec || !selection.state) return;
      const d = Math.max(2.4, selection.position.length() * 1.7);
      cams.lookAtFrom(selection.position, d);
    },
    toggleFollow() {
      if (cams.mode === 'follow') cams.stopFollow();
      else if (app.selectedRec && selection.marker.visible) cams.startFollow(selection.position);
      details.setFollow(cams.mode === 'follow');
    },
    resetView() {
      if (cams.mode === 'follow') app.toggleFollow();
      const o = app.observer;
      const e = ecfToEci(geodeticToEcf(o.lat, o.lon, 0), gmstFromMs(clock.now()));
      cams.lookAtFrom(new THREE.Vector3(...toScene(e.x, e.y, e.z)), 3.4);
    },
    setObserver(o) {
      settings.observer = plainObserver(o);
      saveSettings();
      app.observer = makeObserver(o.latDeg, o.lonDeg, o.hKm, o.name);
      obsMarker.set(o.latDeg, o.lonDeg, o.hKm);
      labels.set('obs', {
        text: o.name, sub: '', className: 'observer',
        getWorld: (v) => (v.copy(obsMarker.mesh.position).applyMatrix4(stage.earthGroup.matrixWorld), true),
      });
      passesView.fill(settings.observer);
      requestPasses();
      tonightAt = -Infinity;
      if (activeTab === 'passes') requestTonight();
      refreshOverhead();
    },
    async setStyle(style) {
      app.poke?.();
      settings.style = style;
      saveSettings();
      tracking.setStyle(style);
      if (style === 'photo' && !app.texturesLoaded) {
        app.texturesLoaded = true;
        const [day, night] = await Promise.all([
          loadTexture('assets/textures/earth-day.jpg', stage.renderer),
          loadTexture('assets/textures/earth-night.jpg', stage.renderer),
        ]);
        earth.setTextures(day ?? fallbackDayTexture(mask, MASK_W, MASK_H), night);
        if (!day) toast('NASA imagery could not be loaded, so the photoreal globe uses a map-based stand-in.', { kind: 'warn' });
      }
      earth.setStyle(settings.style);
      atmosphere.setStyle(settings.style);
    },
    setShow(key, on) {
      app.poke?.();
      settings.show[key] = on;
      saveSettings();
      tracking.setToggle(key, on);
      if (key === 'paths') selection.setPaths(on);
      if (key === 'labels') $('#labels').hidden = !on;
      if (key === 'stars') sky.stars.visible = on;
      if (key === 'constellations') sky.lines.visible = on;
      if (key === 'grid') earth.layers.grid.visible = on;
      if (key === 'borders') earth.layers.borders.visible = on;
      if (key === 'atmosphere') atmosphere.mesh.visible = on;
    },
    setCategoryVisible(key, on) {
      settings.hiddenCats = settings.hiddenCats.filter((k) => k !== key);
      if (!on) settings.hiddenCats.push(key);
      saveSettings();
      if (app.meta) swarm.setShown(shownMask());
    },
    jumpTo(t) {
      app.poke?.();
      clock.jump(t);
      swarm.invalidate();
      refreshOverhead();
    },
    setRate(r) {
      app.poke?.();
      clock.setRate(r);
    },
    backToNow() {
      app.poke?.();
      clock.backToNow();
      swarm.invalidate();
      refreshOverhead();
    },
    focusSearch() {
      app.showTab('tracking');
      tracking.focusSearch();
    },
    showHelp() {
      $('#helpDialog').showModal();
    },
    showTab(name) {
      activeTab = name;
      for (const b of $$('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
      for (const s of $$('#leftPanel > section')) s.hidden = s.id !== `view-${name}`;
      $('#leftPanel').classList.remove('collapsed');
      if (window.matchMedia('(max-width: 820px)').matches) {
        document.body.classList.remove('detail-open');
        $('#detailPanel').hidden = true;
      }
      if (name === 'passes' && Math.abs(clock.now() - tonightAt) > 1800e3) requestTonight();
      if (name === 'sky') skyView.update(app.overhead);
      if (name === 'data') refreshDataView();
    },
    refreshRadars() {
      skyView.update(app.overhead);
      if (app.selectedRecord) requestPasses();
    },
    async importText(text, mode) {
      const meta = await propagator.call('import', { text, mode });
      if (mode === 'replace' || !app.meta) app.source = 'import';
      applyCatalog(meta);
      refreshDataView();
      return meta;
    },
  });

  for (const b of $$('.tabs button')) b.addEventListener('click', () => app.showTab(b.dataset.tab));
  $('#helpBtn').onclick = () => app.showHelp();
  $('#helpClose').onclick = () => $('#helpDialog').close();

  // ---------- settings → scene ----------
  const o = settings.observer;
  app.setObserver(o);
  for (const [k, v] of Object.entries(settings.show)) app.setShow(k, v);
  if (params.get('style') === 'photo' || params.get('style') === 'holo') settings.style = params.get('style');
  await app.setStyle(settings.style);

  // ---------- orbital data ----------
  boot.progress(35, 'ORBITAL DATA');
  const data = await resolveData(params, { isLocal });
  if (data) {
    app.data = data;
    app.source = data.source;
    if (data.clockOffsetMs) {
      clock.offsetMs = data.clockOffsetMs;
      if (!tParam) clock.backToNow();
      toast(`Your computer’s clock is ${Math.abs(data.clockOffsetMs / 1000).toFixed(1)} s ${data.clockOffsetMs > 0 ? 'slow' : 'fast'}. GlobalS corrected for it.`, { kind: 'warn' });
      boot.log('warn', `Device clock off by ${(data.clockOffsetMs / 1000).toFixed(1)} s — corrected`);
    }
    boot.progress(45, 'SATELLITE CATALOGUE');
    const synthetic = Number(params.get('synthetic') ?? (data.manifest.demo ? data.manifest.synthetic : 0)) || 0;
    try {
      const meta = await propagator.call('load', {
        catalogUrl: new URL(data.manifest.files.catalog, data.base).href,
        groupsUrl: new URL(data.manifest.files.groups, data.base).href,
        synthetic,
      });
      applyCatalog(meta);
      const age = dataAgeHours(data.manifest, clock.realNow());
      boot.log(data.source === 'demo' ? 'warn' : 'ok', data.source === 'demo'
        ? `DEMO DATA · ${fmtInt(meta.count)} reference + synthetic objects (not real positions)`
        : `${fmtInt(meta.count)} satellites · CelesTrak · updated ${fmtAge(age)}`);
      if (data.source === 'demo') $('#chips').append(Object.assign(document.createElement('span'), { className: 'chip warn', textContent: 'DEMO DATA — not real positions' }));
    } catch (err) {
      boot.log('err', `Catalogue failed to load: ${err.message}`);
    }
  } else {
    boot.log('warn', 'No orbital data reachable — import a TLE/OMM file from the Data tab');
  }
  refreshDataView();

  // ---------- pointer: hover and pick ----------
  const canvas = $('#scene');
  let pointer = null;
  let down = null;
  canvas.addEventListener('pointermove', (e) => { pointer = { x: e.offsetX, y: e.offsetY, touch: e.pointerType === 'touch' }; });
  canvas.addEventListener('pointerleave', () => { pointer = null; });
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.offsetX, y: e.offsetY }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.offsetX - down.x, e.offsetY - down.y);
    down = null;
    if (moved > 5) return;
    const { w, h } = stage.size();
    const i = pickNearest(swarm, stage.camera, e.offsetX, e.offsetY, w, h, e.pointerType === 'touch' ? 22 : 10);
    if (i >= 0) app.select(i);
  });

  // ---------- render loop ----------
  let frameNo = 0;
  let fps = 0;
  let lastFrame = performance.now();
  let lastUi = 0;
  let hoverIdx = -1;
  const tmp = new THREE.Vector3();
  const propagatingChip = Object.assign(document.createElement('span'), { className: 'chip', textContent: 'PROPAGATING…', hidden: true });
  $('#chips').append(propagatingChip);

  // Frame pacing: full rate while the user interacts or the camera animates, 30 fps when live and
  // idle, ~2 fps when paused and idle (saves battery on laptops; satellites barely move per frame).
  let lastInput = performance.now();
  let lastDraw = 0;
  const poke = () => { lastInput = performance.now(); };
  for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart']) window.addEventListener(ev, poke, { passive: true });
  stage.controls.addEventListener('change', poke);
  app.poke = poke;

  function frame(now) {
    requestAnimationFrame(frame);
    const busy = now - lastInput < 1500 || cams.tween || cams.tweenCamera || cams.mode === 'follow' || !swarm.ready;
    const minGap = busy ? 0 : clock.rate === 0 ? 500 : 1000 / 30;
    if (now - lastDraw < minGap - 2) return;
    lastDraw = now;
    const f0 = performance.now();
    const dt = now - lastFrame;
    lastFrame = now;
    if (dt > 0) fps = fps ? fps * 0.95 + (1000 / dt) * 0.05 : 1000 / dt;
    frameNo++;
    const t = clock.now();
    const gmst = gmstFromMs(t);
    stage.earthGroup.rotation.y = gmst;
    cams.applyEarthLock(gmst);
    const sEci = sunDirEci(t);
    earth.setSun(eciToEcf(sEci, gmst), sEci);
    sky.setSun(sEci);
    sky.setDate(t);
    swarm.update(t, clock.rate);
    propagatingChip.hidden = !swarm.isStalled();
    const st = selection.update(t, clock.rate, settings.minElDeg);
    if (app.pendingFocus && st) {
      app.pendingFocus = false;
      app.centreOnSelected();
    }
    cams.follow(st ? selection.position : null);
    cams.tick();
    stage.controls.update();
    stage.updateClipping(cams.mode === 'follow' ? stage.camera.position.distanceTo(selection.position) : Infinity);
    stage.earthGroup.updateMatrixWorld();
    obsMarker.tick();

    if (pointer && frameNo % 3 === 0 && !down) {
      const { w, h } = stage.size();
      hoverIdx = pickNearest(swarm, stage.camera, pointer.x, pointer.y, w, h, pointer.touch ? 22 : 10);
      canvas.style.cursor = hoverIdx >= 0 ? 'pointer' : '';
    } else if (!pointer) hoverIdx = -1;
    if (hoverIdx >= 0 && hoverIdx !== app.selected && swarm.positionOf(hoverIdx, tmp)) {
      selection.setHover(tmp);
      labels.set('hover', {
        text: app.meta.names[hoverIdx], sub: `NORAD ${app.meta.ids[hoverIdx]}`, className: 'hover',
        getWorld: (v) => swarm.positionOf(hoverIdx, v),
      });
    } else {
      selection.setHover(null);
      labels.remove('hover');
    }
    const { w, h } = stage.size();
    labels.update(w, h);
    stage.render();
    app.frameMs = app.frameMs ? app.frameMs * 0.95 + (performance.now() - f0) * 0.05 : performance.now() - f0;

    if (now - lastUi > 250) {
      lastUi = now;
      timebar.update(t);
      if (app.selectedRec) details.update(st, t);
      tracking.updateStats({
        total: app.meta?.count, shown: swarm.stats?.shown, lit: swarm.stats?.lit,
        overhead: app.overhead?.items.length, medianAgeDays: app.medianAgeDays, fps,
      });
      if (clock.isLive(5000)) clock.resync();
    }
  }

  // ---------- start ----------
  app.resetView();
  stage.camera.position.copy(cams.tweenCamera?.to ?? stage.camera.position);
  cams.tweenCamera = null;
  requestAnimationFrame(frame);
  boot.progress(80, 'FIRST PROPAGATION');
  const t0 = performance.now();
  while (app.meta?.count && !swarm.ready && performance.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 50));
  if (app.meta?.count) boot.log(swarm.ready ? 'ok' : 'warn', swarm.ready ? `SGP4 propagator · first keyframes in ${Math.round(performance.now() - t0)} ms` : 'Propagation is taking longer than expected');
  boot.log('ok', `Observer · ${app.observer.name} ${app.observer.latDeg.toFixed(3)}°, ${app.observer.lonDeg.toFixed(3)}°`);
  boot.done();

  setInterval(refreshOverhead, 2000);
  setInterval(refreshDataView, 60_000);
  // After sleep or a long background stint, a live view snaps back to real time.
  let wasLive = clock.isLive(5000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      wasLive = clock.isLive(5000);
    } else if (wasLive) {
      clock.backToNow();
      swarm.invalidate();
      refreshOverhead();
    }
  });

  const m = /sat=(\d+)/.exec(location.hash);
  if (m && app.meta) app.selectById(Number(m[1]));
  if (params.has('test')) {
    window.__globals = app;
    app.ready = true;
  }
}

start().catch((err) => {
  console.error(err);
  boot.log('err', err.message);
  boot.fail(`GlobalS couldn't start: ${err.message}`);
});
