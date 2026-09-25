# GlobalS V2 — rebuild prompt

A complete, tool-agnostic specification for rebuilding **GlobalS V2** from an empty folder with a
local coding agent: Claude Code, OpenAI Codex CLI, or Nous Research's Hermes Agent. It describes the
app as it was built and verified in September 2026 (repository: github.com/GrantWally120/GlobalS),
including the design decisions and the pitfalls hit along the way.

> Just want the existing code? This gives you all of it, with tests, in PowerShell:
>
> ```
> git clone https://github.com/GrantWally120/GlobalS
> cd GlobalS
> node --test "tests/**/*.test.mjs"   # the checks
> node tools/build-single.mjs          # builds dist\GlobalS.html; double-click it
> node tools/serve.mjs                 # or the web version at http://localhost:8080
> ```
>
> This prompt is for rebuilding it yourself, or for having an agent rebuild it.

---

## Part A — How to use this with each agent (for you, the human)

**Prerequisites (Windows 11):**
- Git for Windows.
- Node.js 22 or newer: the LTS installer from nodejs.org. Only `node` is used; there are no npm
  packages.
- Microsoft Edge (already installed).

**Optional:**
- Python 3.11+, only to regenerate the astronomy reference values.
- A GitHub account, for the automatic data feed and downloads (Part B §11). Without one, use
  local-only mode (Part B §10.5).

**Setup, for every agent:**
1. Make an empty folder, e.g. `C:\dev\GlobalS`. Run `git init` in it.
2. Save this file as `docs/GLOBALS_V2_SPEC.md` inside it.
3. Create `AGENTS.md` and `CLAUDE.md` from Appendix A. Codex and Hermes read `AGENTS.md`; Claude
   Code reads `CLAUDE.md`, which imports `AGENTS.md`.
4. Start the agent in that folder and give it the kickoff message below.

**Kickoff message:**

> Read docs/GLOBALS_V2_SPEC.md completely before doing anything. Then build GlobalS V2 phase by
> phase as described in Part B §14. At the start of each phase, restate its goal and acceptance
> checks. Do not start the next phase until every check of the current one passes. Commit after
> each phase. Ask me before any step that needs my accounts or settings: GitHub, Google Drive, or
> Windows settings.

**Claude Code:**
- Plan mode (Shift+Tab until it says "plan mode") works well for phases 0–2.
- Allow it to run `node`, `git` and `python` commands.
- It needs internet access for the npm registry (registry.npmjs.org), NASA, CelesTrak and GitHub.

**OpenAI Codex CLI:**
- It runs natively in Windows PowerShell (OpenAI still labels the native Windows sandbox
  experimental) or inside WSL2.
- `AGENTS.md` must stay small; by default Codex stops reading instruction files once they total
  32 KiB (`project_doc_max_bytes`). Keep the long spec in `docs/`, as above.
- Codex's `workspace-write` sandbox blocks network by default. Allow it for this project with
  `[sandbox_workspace_write]` / `network_access = true` in `~/.codex/config.toml`, or start it with
  `codex --config sandbox_workspace_write.network_access=true`. The Codex desktop app has had a bug
  where it ignored this setting (github.com/openai/codex/issues/13373). If downloads fail, run the
  download steps (`node tools/vendor.mjs`, `node tools/fetch-textures.mjs`) yourself when it asks.

**Hermes Agent (Nous Research):**
- It runs natively on Windows (a desktop package, or the PowerShell installer from its docs) or
  in WSL2.
- It loads only one project context file, the first it finds in this order: `.hermes.md` /
  `HERMES.md`, `AGENTS.override.md`, `AGENTS.md`, `CLAUDE.md`, `.cursorrules`. So don't add a
  `HERMES.md`, or it will hide `AGENTS.md`.
- It truncates oversized context files (it always keeps at least 20,000 characters). Another
  reason to keep `AGENTS.md` short and the spec in `docs/`.
- Pick a strong coding model. This spec is demanding, and weaker models cut corners in the
  maths.
- Enable its web and search tools for looking up documentation.

**Tips:**
- Expect several sessions; the phases are sized for that.
- Keep `node --test "tests/**/*.test.mjs"` green. It's the agent's safety net.
- Hard facts (version numbers, URLs, formulas) are in this spec on purpose. Tell the agent not to
  "improve" them without evidence.

---

## Part B — The specification (for the agent)

### 0. Your role and working rules

You are rebuilding **GlobalS V2**, a real-time satellite tracker for Windows 11 that runs in the
browser. Accuracy matters more than speed.

- Every number the app shows must be real and computed, never decorative. V1 of this app invented
  its orbits and its status text. V2's whole point is honesty: if something isn't known, say so in
  the UI.
- Verify claims with tests against independent references (§12).
- When unsure about an API or a version, check the source, such as the npm tarball, the official
  docs or the library code, instead of guessing.
- Plain, friendly UI copy, written for a non-specialist in Cebu City, Philippines.

### 1. What the app does (product spec)

**Satellites**
- Every active satellite, about 16,800 objects in 2026 (Starlink alone is about 11,000).
- Real positions from CelesTrak GP data (OMM JSON), propagated with SGP4 in the browser.

**The globe**
- A 3D WGS-84 Earth that rotates correctly (GMST), with the real Sun.
- A day/night terminator with twilight bands.
- Two styles:
  - **Holographic HUD**, the default: a cyan dot-matrix continents look;
  - **Photoreal**: NASA Blue Marble by day, Black Marble city lights at night.

**Finding satellites**
- Search by name, NORAD catalogue number or COSPAR ID.
- Category layers with counts; each can be switched off.

**Selected satellite**
- Its orbit (one period, inertial), ground track (−1 to +2 orbits, Earth-fixed) and coverage
  footprint.
- A follow camera.
- A details panel (§9.3).
- The next 7 days of passes over the observer, each with a sky chart.

**Observer**
- The default is Cebu City, Philippines: 10.29306° N, 123.90194° E, 34 m, time zone Asia/Manila.
- It can be edited, or set with "Use my location".
- It is saved locally.

**Your sky**
- **Tonight's visible passes**: naked-eye passes, meaning the satellite is sunlit while the
  observer's sky is dark.
- A **sky radar** of everything above the horizon now.
- A **real star sky**: 5,044 naked-eye stars and IAU constellation lines, precessed to the current
  date.

**Time**
- Pause, and run from −3600× to +3600× in steps: `[-3600, -600, -60, -10, -1, 0, 1, 10, 60, 600, 3600]`.
- Step ±1 hour, jump to any date/time, and return **NOW**.
- A badge shows **LIVE** only when the rate is 1× and simulated time is within 1 s of real time;
  otherwise it shows **SIMULATED**.

**Data**
- The data's age is shown everywhere it matters.
- The app refreshes the data itself while open.
- Import TLE, 3LE or OMM JSON files by drag-and-drop or a file chooser.

**Distribution**
- **Primary:** a single `GlobalS.html`, about 8 MB, that works when double-clicked (`file://`) in
  Edge or Chrome.
- A 4 KB **starter file** that loads the latest single file from GitHub. It's meant for Google
  Drive.
- **Optional:** an installable web app (PWA) on GitHub Pages.

### 2. Non-negotiable constraints

1. **No npm, no bundler, no build step for users.**
   - The app is plain HTML, CSS and ES modules.
   - Third-party code is **vendored** (committed) by a zero-dependency Node script. That script
     downloads the exact npm tarballs, verifies the registry's sha512 `integrity`, and extracts an
     allowlist of files.
   - No `package.json` is needed.
   - Every tool in `tools/` is a zero-dependency Node ≥ 22 ES module and runs on Windows, macOS and
     Linux.
2. **Pinned versions** (§3). Don't upgrade without a reason and re-verification.
3. **`js/core/` stays pure.** No DOM, no three.js, no fetch; it may import only `js/core/*` and the
   vendored satellite.js and topojson-client. Tests run it in Node.
4. **Workers never import `three`.** Import maps don't apply in workers.
5. **Offline-capable and honest.** Show data age, label demo data loudly ("DEMO DATA — not real
   positions"), and never fake status lines.
6. **Accessibility.**
   - Keyboard shortcuts.
   - `prefers-reduced-motion`.
   - Meaning never conveyed by colour alone (dashes and labels too).
   - Text set via `textContent`, never `innerHTML`, for data.
7. **Politeness to CelesTrak** (§6.1).
   - Download each group at most once per 2-hour update cycle.
   - Space requests 2 s apart.
   - Identify yourself in the User-Agent.
   - Stop on 403, or when CelesTrak isn't answering.

### 3. Pinned inputs

| What | Version / source | Files used | Licence |
| --- | --- | --- | --- |
| three.js | 0.186.1 (npm) | `build/three.module.js`, `build/three.core.js`, `examples/jsm/controls/OrbitControls.js`, `examples/jsm/lines/{Line2,LineGeometry,LineMaterial,LineSegments2,LineSegmentsGeometry}.js`, `LICENSE` | MIT |
| satellite.js | 7.1.0 (npm) | `dist/{common-types,constants,dopplerFactor,ext,io,propagation,shadow,sun,transforms}.js`, `dist/propagation/{SatRec,check-for-decay,dpper,dscom,dsinit,dspace,gstime,initl,propagate,sgp4,sgp4init}.js`, `LICENSE.md` | MIT |
| topojson-client | 3.1.0 (npm) | `src/*.js`, `LICENSE` | ISC |
| world-atlas | 2.0.2 (npm) → `assets/geo/` | `countries-50m.json`, `LICENSE` | ISC; data Natural Earth, public domain |
| d3-celestial | 0.7.35 (npm) → `assets/stars/` | `data/stars.6.json`, `data/constellations.lines.json` (+ `constellations.json`, unused), `LICENSE` | BSD-3-Clause (stars: XHIP, Anderson & Francis 2012) |
| NASA day texture | Blue Marble NG, July 2004, topo+bathy, 5400×2700 | `<host>/73000/73751/world.topo.bathy.200407.3x5400x2700.jpg` (≈2.3 MB; fallback: December 2004, `73000/73909/world.topo.bathy.200412.3x5400x2700.jpg`) | public domain |
| NASA night texture | Black Marble 2016, 0.1°, 3600×1800 | `<host>/144000/144898/BlackMarble_2016_01deg.jpg` (≈0.78 MB) | public domain |

NASA hosts, tried in order: `https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords`,
then `https://eoimages.gsfc.nasa.gov/images/imagerecords`.

**satellite.js**
- Use 7.1.0 exactly. It fixed `sunPos` errors of up to about 1.1°.
- Never import its `dist/index.js`. It statically pulls in WASM runtimes whose `#wasm-*` imports
  only resolve in Node, so import the individual modules above through one facade,
  `js/core/sat.js`.

**Import map in `index.html`:**

```json
{
  "imports": {
    "three": "./vendor/three/build/three.module.js",
    "three/addons/": "./vendor/three/examples/jsm/"
  }
}
```

**`tools/vendor.mjs`:**
- Fetches `https://registry.npmjs.org/<name>` metadata and gets the tarball URL and `dist.integrity`.
- Downloads the tarball and verifies its sha512.
- Gunzips it and reads the tar with a tiny pure-JS ustar/pax reader.
- Extracts the allowlist, writes `vendor/vendor-lock.json` (sha256 per file) and `VENDOR.md`.
- `--check` mode re-hashes the files on disk against the lock, offline.

**`tools/fetch-textures.mjs`:**
- Downloads the two JPEGs, trying alternative NASA hosts where needed.
- Validates each is a real JPEG of the expected pixel size, by parsing the SOF marker.
- Writes `assets/textures/{earth-day.jpg, earth-night.jpg, textures.json}`. The JSON holds source,
  credit, size and sha256.

### 4. Repository layout

```
index.html  manifest.webmanifest  sw.js  README.md  ATTRIBUTION.md  VENDOR.md  .gitattributes  .gitignore
css/globals.css
js/main.js            boot sequence, render loop, the `app` object the UI calls
js/config.js          APP_VERSION '2.0.0', REPO_URL, FEED_URLS, DEFAULT_OBSERVER, CATEGORY_STYLE, thresholds
js/core/              PURE: sat.js frames.js look.js sun.js time.js interp.js keyframes.js clock.js stars.js
                      radar.js orbit.js passes.js omm.js catalog.js synthetic.js landmask.js geo.js format.js
js/data/              loader.js (where data comes from), offline-store.js (IndexedDB copy, single file)
js/workers/           rpc.js, propagator.worker.js, passes.worker.js
js/render/            scene.js earth.js atmosphere.js sky.js swarm.js picking.js selection.js labels.js camera-modes.js
js/ui/                dom.js store.js boot.js toasts.js radar-svg.js timebar.js tracking.js details.js
                      passes-view.js sky-view.js data-view.js keyboard.js install.js
vendor/               three/, satellite.js/, topojson-client/, vendor-lock.json
assets/               geo/, stars/, icons/ (svg + png 48/96/180/192/256/512 + maskable-512), textures/
fixtures/data/        demo manifest/catalog/groups (REF-* objects; local testing only, never deployed)
launcher/GlobalS.html the 4 KB starter (§10.3)
tools/                vendor.mjs fetch-textures.mjs serve.mjs fetch-celestrak.mjs describe-data.mjs
                      check-imports.mjs stage-site.mjs stamp-sw.mjs build-single.mjs smoke-single.mjs
                      reference/gen_refs.py
tests/                *.test.mjs (node:test) + fixtures/{sgp4-verification, omm, ref}
.github/workflows/    test.yml  publish.yml  (optional: data-check.yml, textures.yml)
docs/                 screenshots, this spec
```

Add a `.gitattributes`:
- `* text=auto eol=lf`, so every platform checks out LF;
- `-text` for third-party files (`vendor/**`, `assets/geo/**`, `assets/stars/**`,
  `tests/fixtures/sgp4-verification/**`), which must stay byte-for-byte as published. A few of them
  use CRLF upstream.
- `binary` for images (`*.jpg`, `*.jpeg`, `*.png`).

Why:
- Without it, Git for Windows converts LF to CRLF on checkout.
- That breaks the vendored-file hashes (`vendor.mjs --check`), and it broke the single-file build,
  whose `index.html` edits expected `\n`.
- Belt and braces: build tools also turn `\r\n` into `\n` when they read text, so a CRLF checkout
  still builds the byte-identical file.

### 5. Core science (`js/core/`) — exact conventions

**Units.** Time is UTC milliseconds (Number); distances km; velocities km/s; angles are radians
unless the name ends in `Deg`.

**5.1 Epochs and SGP4 (`sat.js`)**

- **Use OMM JSON only.** NORAD catalogue numbers passed 99,999 on 2026-07-11, and six-digit numbers
  have no TLE form. Key everything by the integer `NORAD_CAT_ID`.
- **Parse `EPOCH` exactly.** Strings look like `"2026-09-20T11:22:17.431104"`: UTC, no `Z`, up to 6
  fractional digits. Parse to milliseconds, keeping the sub-millisecond fraction.
- **Normalize for satellite.js.** `json2satrec` reads 11 fields and does `new Date(EPOCH + 'Z')`,
  which can't take 6 fractional digits. Give it an epoch normalized to 3 decimals, but compute
  `tsince` in minutes from your own exact epoch.
- **Propagate.** Call `sgp4(satrec, tsinceMin)`, then `checkForDecay(satrec)`. If the result is
  NaN, has an error or has decayed, the object is invalid at that time: count it, never draw it.
- **Julian date and GMST.** `JD = ms / 86400000 + 2440587.5`; GMST is satellite.js
  `gstime(jd)`. UTC is used as UT1, an error under 1 s.
- **TLE input** (imports only) goes through `twoline2satrec`, with records stored as
  `{OBJECT_NAME, NORAD_CAT_ID, TLE_LINE1, TLE_LINE2}`.

**5.2 Frames (`frames.js`)**

- **Earth model.** WGS-84: `a = 6378.137 km`, `f = 1/298.257223563`. The scene unit is 1 Earth
  equatorial radius (ER = 6378.137 km).
- **Axis mapping.** TEME/ECI and ECF (z north) map to three.js (y up) as **`scene = (x, z, −y)`**.
  This is a proper rotation.
- **Why GMST drives rotation.y.** Because Rz(θ) in ECI equals Ry(θ) in the scene,
  `earthGroup.rotation.y = GMST`. All Earth-fixed things live in `earthGroup`: mesh, lines, track,
  footprint, observer. Satellites, orbits and the Sun live in the inertial root.
- **Conversions.** `geodeticToEcf(lat, lon, hKm)`, plus an iterative `ecfToGeodetic` that is stable
  at the poles, and a geodetic normal. Render buffers are float32; all maths is double.

**5.3 Look angles (`look.js`)**
- `lookAngles(obs, rEcf, vEcf?)` returns `{azDeg, elDeg, rangeKm, rangeRateKms}` in the observer's
  topocentric SEZ/ENU frame.
- Use geodetic (not geocentric) vertical.

**5.4 Sun (`sun.js`)**
- Sun direction from satellite.js `sunPos`, as ECI in AU. Rotate it to ECF with GMST.
- Observer Sun altitude uses the geodetic normal.
- Levels:
  - day/night line at −0.833°;
  - civil twilight −6°;
  - nautical twilight −12°;
  - astronomical twilight −18°.
- `darkWindows(obs, t0, t1, altDeg = −6)` finds the dark intervals: it samples every 10 min, then
  bisects each boundary to 1 s.

**5.5 Pass prediction (`passes.js`)** — Skyfield-style "maxima first".

- **Scan step:** 30 s if eccentricity > 0.1; otherwise `clamp(P/100, 20 s, 300 s)` (P is the
  period).
- **Scan window:**
  - Scan `[t0 − min(P/2, 1 day), t1 + min(P/2, 1 day)]`.
  - While the elevation at either end is still ≥ minEl, widen that end by `min(P/4, 6 h)`, up to
    8 times.
- **Always up / never rises:** if the minimum sampled elevation is ≥ minEl, report **always up**
  (GEO-like); the UI explains that a geosynchronous satellite hangs in the same place in your sky.
  If the maximum is < minEl and there are no passes, report **never rises**.
- **Refining each pass:**
  - For each local maximum of the samples, refine the peak by **golden-section search** (tolerance
    100 ms). Skip it if the peak is below minEl.
  - **Rise and set:** bisection on `el − minEl` (100 ms). If the neighbouring samples are still
    above minEl, walk outwards through the samples first.
  - Merge duplicate maxima that share the same rise and set, keeping the higher peak.
  - Return the passes that overlap `[t0, t1]`; mark `inProgress` when rise < t0.
- **Visibility.** Sample every 5 s from rise to set.
  - **Sunlit** = satellite.js `shadowFraction(sun, r) < 0.5`, the same test as Skyfield's
    `is_sunlit`.
  - **Dark sky** = the observer's Sun altitude < −6°.
  - Pass kinds:
    - `visible`: some sample is sunlit AND dark; transitions refined to 1 s.
    - `daylight`: sunlit, but only in daylight.
    - `eclipsed`: shown as "In shadow".
  - No magnitudes: GP data carries no brightness information, and the UI says so.
- **Defaults:** minEl 10° (options 0, 5, 10, 20, 30); selected satellite: 7 days. Tonight's
  visible passes cover:
  - the `visual` group plus `stations`, capped at 400 objects;
  - only the dark windows of the next 2 nights, with results streamed.

**5.6 Orbits (`orbit.js`)**
- `revsPerDay`, `periodSec`.
- Apsides use SGP4's Earth radius 6378.135.
- `orbitClass`, in this order:
  - if revs/day is in (0.99, 1.01): **GEO** when e < 0.01 and i < 15°, otherwise **GSO**;
  - else if e ≥ 0.25: **HEO**;
  - else if apogee < 2000 km: **LEO**;
  - else **MEO**.
- Other functions:
  - `sampleOrbitEci` (one revolution, centred on t);
  - `sampleGroundTrack`;
  - `footprintRing(satEcf, minElDeg, points=96)`, solved with the same look-angle function.

**5.7 Interpolation (`interp.js`, `keyframes.js`)**

- **Keyframes.** The worker computes keyframes on a fixed simulated-time grid: position and
  velocity for all objects, plus sunlit and valid flags.
- **Grid spacing** by |rate|: ≤ 60× → 60 s; ≤ 180× → 180 s; otherwise 900 s. Paused uses 60 s.
- **Prefetch** one keyframe ahead, backwards when time runs in reverse.
- **Jumps.** A jump bumps a generation counter, and a "PROPAGATING…" chip shows until keyframes
  arrive.
- **Hermite.** The main thread does **cubic Hermite** interpolation between keyframes, with
  `h = (tb − ta)/1000` and `s = (t − ta)/(tb − ta)`:
  `b0 = 2s³−3s²+1, b1 = (s³−2s²+s)·h, b2 = −2s³+3s², b3 = (s³−s²)·h;  p = b0·P0 + b1·V0 + b2·P1 + b3·V1`
- **Accuracy.** Error about 0.4 m at 60 s spacing and about 30 m at 180 s. Linear interpolation
  would be about 435 m off after just 10 s.
- **Selected satellite.** It is always propagated exactly on every frame.

**5.8 Stars (`stars.js`)**

- **Positions.** d3-celestial stores `[lon, lat]` with RA wrapped to ±180°, so RA = lon + 360 when
  lon < 0. B−V is a string.
- **Precession.** IAU-1976 from J2000 to date, with `T` in Julian centuries from J2000 and angles in
  arcseconds:
  - ζ = 2306.2181T + 0.30188T² + 0.017998T³
  - z = 2306.2181T + 1.09468T² + 0.018203T³
  - θ = 2004.3109T − 0.42665T² − 0.041833T³
  - **P = R3(−z)·R2(θ)·R3(−ζ)**, applied to the sky group, conjugated by the axis map.
- **Point size** (px): `clamp(3.2·10^(−0.2(mag−1)), 1, 7)`.
- **Opacity:** `clamp(10^(−0.4(mag−4)), 0.15, 1)`.
- **Colour from B−V:**
  1. B−V → temperature (Ballesteros): `T = 4600·(1/(0.92·bv+1.7) + 1/(0.92·bv+0.62))`, with bv
     clamped to [−0.4, 2.0] and missing values taken as 0.6.
  2. T clamped to [1667, 25000] K.
  3. Planckian-locus x, y (Kim et al. cubic fits) → XYZ → linear sRGB, normalized.

**5.9 Map (`geo.js`, `landmask.js`)**
- Decode `countries-50m.json` with topojson-client.
- Land rings are stitched across ±180°: Afro-Eurasia, Antarctica, Fiji and Wrangel all cross it.
  Rasterize the land mask (4096×2048, equirectangular, row 0 = north) with:
  - **ring unwrapping** (continuous longitude);
  - **polar closure** for Antarctica.
- Expect about 29 % land by area (the test accepts 28–30.5 %).
- Spot checks:
  - Cebu and Bohol are land (Bohol is missing from the 110m data — use 50m);
  - the South Pole is land;
  - the Gulf of Guinea is sea;
  - no 360° streaks.
- Coast and border lines are flat `[lon0, lat0, lon1, lat1, …]` segment arrays, with the artificial
  seam and pole edges dropped.

**5.10 Catalogue (`omm.js`, `catalog.js`)**

- **Parsing and validation (`omm.js`):**
  - OMM fields kept: `OBJECT_NAME, OBJECT_ID, NORAD_CAT_ID, EPOCH, MEAN_MOTION, ECCENTRICITY,
    INCLINATION, RA_OF_ASC_NODE, ARG_OF_PERICENTER, MEAN_ANOMALY, BSTAR, MEAN_MOTION_DOT,
    MEAN_MOTION_DDOT`.
  - `validateOmm` checks the ranges, then de-duplicates by id, keeping the newest epoch.
  - TLE parsing handles 2LE and 3LE, `"0 "` name prefixes, the mod-10 checksum (a mismatch is kept
    with a warning) and **Alpha-5** ids (A = 10 … Z = 33, skipping I and O).
- **Categories** — the first match wins, in this order:
  1. stations: group `stations`;
  2. gnss: groups `gps-ops, glo-ops, galileo, beidou`;
  3. weather: groups `weather, resource`, or names
     `^(FLOCK|SKYSAT|ICEYE|LEMUR|JILIN|GAOFEN|CAPELLA|UMBRA|NUSAT|SUPERVIEW|WORLDVIEW|PLEIADES|SENTINEL|LANDSAT)`;
  4. science: group `science`;
  5. amateur: group `amateur`;
  6. starlink: `^STARLINK`;
  7. oneweb: `^ONEWEB`;
  8. kuiper: `^KUIPER`;
  9. megacon, "Other comms constellations":
     `^(QIANFAN|GUOWANG|HULIANWANG|SATNET|IRIDIUM|GLOBALSTAR|ORBCOMM)`;
  10. geo: orbit class GEO or GSO;
  11. other.
- **Facets:** `visual` (Brightest) and `recent` (`last-30-days`).
- **Search** (case- and space-normalized); the highest score wins:
  - exact id 1000;
  - exact name 900;
  - id prefix `300 − len(id)`;
  - name prefix `700 − len(name)`;
  - word start inside the name `500 − len`, other substring `200 − len`;
  - COSPAR prefix (≥ 4 chars, dashes ignored) 400;
  - then −250 for names matching `DEB|R/B|RB|AKM|PKM`, so "ISS (ZARYA)" beats "ISS DEB";
  - ties sorted by name.
- **Category colours** (sRGB; alpha dims crowded constellations):

  | Category | Colour | Alpha | Size |
  | --- | --- | --- | --- |
  | stations | `#ffb547` | 1 | 1.5 |
  | gnss | `#5cffb1` | 1 | 1.2 |
  | weather | `#ffe066` | 1 | 1.1 |
  | science | `#ff5fa8` | 1 | 1.1 |
  | amateur | `#ff8a4c` | 1 | 1.0 |
  | starlink | `#4ff0ff` | 0.55 | 0.85 |
  | oneweb | `#7aa7ff` | 0.7 | 0.9 |
  | kuiper | `#c38bff` | 0.8 | 0.9 |
  | megacon | `#9ec9ff` | 0.7 | 0.9 |
  | geo | `#d8eef7` | 0.9 | 1.0 |
  | other | `#7f9bb3` | 0.75 | 0.9 |

**5.11 Formatting (`format.js`), time (`time.js`), clock (`clock.js`)**

- **Ages:** `fmtAge(h)`: "just now" (< 0.02 h), "N min ago", "N.N h ago" (< 10 h) or "N h ago" (< 48 h),
  then "N.N days ago".
- **Element age:** shown relative to the displayed time, and "before epoch" when the time shown is
  earlier than the elements.
- **Warnings:** element age over 3 days (LEO) or 14 days (period ≥ 225 min) turns amber and shows
  a note.
- **`parseTimeParam`:** accepts "now" and ISO 8601 with an optional `Z` or ±hh:mm. Without an
  offset, it's read in the computer's time zone.
- **`SimClock`:** `offsetMs` (device clock correction), `rate` and `lastNonZeroRate`. Methods:
  `now`, `realNow`, `setRate`, `pause`, `play`, `toggle`, `jump`, `step`, `backToNow`,
  `isLive(tol = 1 s)`, `resync(maxDrift = 250 ms)` (after the computer sleeps, a live view snaps
  back to real time), `nextRate(dir)` and `onChange`.

### 6. Data pipeline

**6.1 Relay (`tools/fetch-celestrak.mjs`)**

CelesTrak's `gp.php` sends **no CORS headers**, so browsers can't read it. A GitHub Action relays
it instead.

- **Endpoint:** `https://celestrak.org/NORAD/elements/gp.php?GROUP=<g>&FORMAT=json`.
- **Groups, one at a time, 2 s apart:**
  `active` (required, 90 s timeout), then `stations, visual, gps-ops, glo-ops, galileo, beidou,
  weather, resource, science, amateur, last-30-days` (30 s each).
- **Etiquette:**
  - User-Agent `GlobalS-data/1.0 (+https://github.com/<owner>/<repo>)`.
  - A 5xx or network error gets **one** retry after 30–35 s.
  - **403** means stop contacting CelesTrak for this run (breaker).
  - A group that **fails twice** also stops the run ("unreachable" breaker). Don't hammer 11 more
    groups: a refused runner IP otherwise costs about 11 minutes.
  - **Reuse guard:** if the previous data shows a group was *attempted* (successfully or not) less
    than 2 h ago, reuse it without contacting CelesTrak.
- **Validation:**
  - `validateOmm`, plus a successful propagation at epoch.
  - Records are compacted to the OMM fields and de-duplicated by id, keeping the newest epoch.
  - The `active` group must have ≥ 50 % of the previous count and a median element age ≤ 7 days.
  - Otherwise, or on any failure, each group falls back to the previous data.
- **Output** (`--out dir`):
  - `catalog.json`: an array of compact OMM records.
  - `groups.json`: `{group: [ids]}`.
  - `manifest.json`:
    ```
    { schema: 1, version: sha256(catalog + groups)[:12], generatedAt, source{…},
      files: { catalog: 'catalog.json?v=<version>', groups: 'groups.json?v=<version>' },
      counts: { objects }, epoch: { min, median, max }, dropped: { invalid, propagation },
      groups: { <name>: { status: fresh|reused|fallback|blocked|unreachable|invalid|failed,
                          count, fetchedAt, attemptedAt, http, bytes, reason } } }
    ```
- **Other behaviour:**
  - Writes a Markdown step summary.
  - **Always exits 0.** The workflow decides whether to publish, and refuses fewer than 1,000
    objects.
  - `--previous <dir|URL>` gives the previous data; `--force` skips the reuse guard; `--from-dir`
    reads `<group>.json` files, for tests.

**6.2 Feed.**
- The workflow force-pushes **one orphan commit** to a `data` branch, so there's no history
  growth. The commit holds `manifest.json, catalog.json, groups.json, README.md`.
- Clients read it from:
  1. `https://raw.githubusercontent.com/<owner>/<repo>/data/`: CORS `*`, 5-min cache, **60
     unauthenticated requests per hour per IP**;
  2. `https://cdn.jsdelivr.net/gh/<owner>/<repo>@data/`: caches branches up to 12 h; purge after
     each push, best effort;
  3. `https://<owner>.github.io/<repo>/data/`: only if Pages is on.
- The workflow reads the *previous* data with `git fetch origin data`, not raw, to avoid rate limits.

**6.3 Loader (`js/data/loader.js`)**

- **Candidate order:**
  - Web version: `./data/` (same site), then each feed URL, then demo fixtures (`localhost` only).
  - Single file (`globalThis.GLOBALS_SINGLE` set): feed URLs only.
  - `?data=fixtures` forces demo data.
- **Manifest fetch:** 12 s timeout, `cache: 'no-cache'`.
- **Clock offset:**
  - Measure it only from a **same-origin** Date header that the service worker didn't serve from
    cache.
  - Offset = `server + 500 ms − midpoint(sent, received)`. Ignore it below 2 s or above 30 min.
  - Otherwise the Data tab says "Not checked", not "OK".
- **Refresh while open:**
  - Every 30 min, when the page becomes visible after 10 min or more, and on `online`.
  - If there's newer data (different version and a later `generatedAt`), swap it in and keep the
    selected satellite and follow mode.
  - If the user has imported files, offer a toast instead of swapping.
  - If the app started with **no data**, retry every 2 min and on `online`; say "Satellite data
    loaded" when it arrives.
- **Offline copies:**
  - Single file: after each successful load, keep `{manifest, catalogText, groupsText}` in
    IndexedDB (db `globals`, store `offline`) and start from it when all feeds fail.
  - Web version: the service worker keeps the data (§10.4).

### 7. Workers

**`rpc.js`**
- A promise RPC: `call(type, payload)` returns the reply; `on(type)` receives pushes.
- The worker side uses `serve(handlers)`, which sets `self.onmessage`.

**`propagator.worker.js`**

| Handler | Input | Behaviour | Output |
| --- | --- | --- | --- |
| `load` | `catalogUrl` + `groupsUrl`, or `catalogText` + `groupsText`, plus optional `synthetic` | Builds records, category and orbit class | Columnar meta: `count, ids (Int32Array), cats, facets, orbits, epochs (Float64Array), names, cospars, failed`, as transferables |
| `import` | text; mode merge or replace | Parses the file | The same meta, plus `imported`, `importedIds` (first 20) and `problems` |
| `keys` | generation, times | Queues keyframe jobs and drops stale generations | Pushes `{type: 'keyframe', t, gen, count, pos, vel, lit (0–255), ok}` in scene units |
| `overhead` | observer | Everything above the horizon now | `{t, skyDark, items: [{i, az, el, range, lit}]}` |
| `records` | indices | Looks up the original element sets | Those element sets |

**`passes.worker.js`**
- `passes`: one satellite, 7 days, with visibility and a compact track `[t, az, el, lit, dark]`.
- `tonight`: many satellites, inside dark windows only.

### 8. Rendering (three.js)

**Scene (`scene.js`)**
- Two passes: the sky scene first, then `clearDepth`, then the main scene. Stars have no parallax
  and are never clipped.
- `OrbitControls`: distance 1.06–40 ER (follow mode min 0.01).
- Near and far planes adapt to the focus distance.
- DPR capped at 2.

**Earth (`earth.js`)**
- **Mesh.** A true WGS-84 ellipsoid built from `geodeticToEcf` on a lat/lon grid, with geodetic
  normals and exact UVs.
- **HUD shader:**
  - a dot-matrix land sampled from the mask, with dot size capped at about 2.6 px;
  - a finer grid that fades in when dots are 4.5–7 px apart;
  - cyan coastlines and borders (drawn 2 km above the ellipsoid; the graticule 1 km, the ground
    track 6 km);
  - a 15° graticule and night-side dimming;
  - thin **twilight contours at −0.833°, −6°, −12° and −18°**.
- **Photo shader:**
  - the day texture;
  - night lights blended across the terminator;
  - an ocean-only specular glint, `pow(…, 140)·0.3`.
- **Textures:**
  - Load via `fetch` → `createImageBitmap`. Read `width`/`height` **before** `close()`.
  - Resize to fit `maxTextureSize` and memory: 2048 if `deviceMemory` ≤ 4, else 4096. Use
    `imageOrientation: 'flipY'` with `texture.flipY = false`, and sRGB.
  - If the textures are missing, fall back to a generated natural-colour map from the land mask,
    and say so.
- **Every custom `ShaderMaterial` ends with `#include <colorspace_fragment>`.**

**Atmosphere (`atmosphere.js`)**
- A sphere at 1.1 ER with a limb glow lit by the Sun.
- Use the limb direction `n − (n·v)·v`. Lighting by back-face normals makes the night limb glow
  (a bug).

**Swarm (`swarm.js`)**
- One `THREE.Points` with a custom shader, using the per-point category colour and alpha.
- Size: `category size × uScale 4.4 × DPR`. Satellites in Earth's shadow are dimmed ×0.42.
- A shown-mask for hidden categories.
- About 1 ms/frame of JavaScript for 20,000 objects.

**Picking (`picking.js`)**
- Screen-space nearest point within 10 px (22 px for touch).
- Reject points hidden behind the ellipsoid.

**Selection (`selection.js`)**
- A pulsing ring marker, shown only once its first exact position exists.
- An orbit `Line2` (1.6 px, amber `#ffb547`).
- A ground-track `Line2` with vertex colours: past dim blue, future amber fading out.
- A footprint loop and a nadir line.
- Rebuild each only when it goes stale for the current warp.

**Cameras (`camera-modes.js`)**
- Modes:
  - **earth-locked**, the default: the camera turns with the Earth by the GMST change;
  - inertial;
  - **follow**, which keeps the camera's offset from the satellite.
- `lookAtFrom` tweens along a sphere over 900 ms; it rejects zero vectors.
- The initial view is 3.4 ER above the observer.
- Centring on the selection uses a distance of `max(2.4, 1.7·|r|)`.
- Focus waits until the render loop has the exact position (`pendingFocus`).

**Labels**
- HTML labels projected each frame, for the selection, hover and observer.

### 9. UI and UX

**9.1 Layout (dark HUD)**
- **Palette:** background `#02040a`; cyan `#4ff0ff`; amber `#ffb547`; green for good, amber for
  warnings.
- **Style:** glass panels with corner brackets; fonts Segoe UI Variable and Consolas/mono.
- **Top bar:**
  - logo and version;
  - tabs **Tracking · Passes · Sky · Data**;
  - data-age badge: green < 8 h, amber < 48 h, red after;
  - LIVE/SIMULATED badge, Install button (web version only) and `?` help.
- **Other areas:**
  - left panel (tab content);
  - right details panel;
  - bottom time bar: UTC, Local (zone label), GMST, LST, JD, the controls `−1h « ❚❚ » +1h`, rate,
    a datetime-local jump and **NOW**;
  - chips such as "PROPAGATING…" and "DEMO DATA";
  - toasts, the help dialog and a drop overlay.

**9.2 Tabs**
- **Tracking:**
  - search with keyboard navigation;
  - layer checkboxes with counts;
  - globe style switch (Holographic/Photoreal);
  - display toggles: orbit & track, labels, stars, constellations, grid, borders, atmosphere;
  - telemetry: objects, shown, sunlit, overhead, median data age (against *real* time, never
    "−0.0 d"), frame rate.
- **Passes:**
  - location form: place, latitude, longitude, height in metres, minimum elevation;
  - Save, Use my location, and Cebu City buttons, in a row that wraps;
  - tonight's visible passes.
- **Sky:**
  - an SVG radar with zenith at the centre and rings at 0°, 30° and 60° plus the minimum
    elevation, labelled N/E/S/W;
  - the default is "looking up" (east on the left); tapping flips it, and the caption says which;
  - the geostationary belt appears as an arc;
  - a list of what's overhead, sorted by elevation.
- **Data:**
  - source, updated, median epoch, version, objects (unusable count), clock;
  - notes: groups carried over, or unavailable;
  - offline and demo notes;
  - import (chooser, "replace catalogue" checkbox, drag-and-drop anywhere);
  - "This app": version, build and offline status, with **Reset app cache**;
  - accuracy text and credits, with links to ATTRIBUTION.md and the source.

**9.3 Details panel**

- **Header:** name, NORAD id, COSPAR id and category; Follow, Centre and Passes buttons.
- **Rows:**

  | Row | Content |
  | --- | --- |
  | Altitude | km |
  | Speed | km/s |
  | Latitude, Longitude | position below the satellite |
  | Sunlight | Sunlit / In Earth's shadow |
  | From \<observer\> | `az° DIR · el° up` or `el° below` |
  | Range | km, with range rate ± km/s |
  | Orbit | class and period |
  | Inclination, Apogee × perigee, Eccentricity | orbit shape |
  | Elements from | epoch |
  | Element age | how old the elements are |

- **Next passes** (7 days, from the observer, ≥ minEl). Each pass shows:
  - date and time, rise → set;
  - kind badge: Visible, Daylight or In shadow (dashed);
  - maximum elevation and direction, rise and set directions, duration.
- Clicking a pass shows its radar chart, with a live dot during the pass.

**9.4 Behaviour**

- **Boot screen:**
  - a real step log, e.g. "WebGL 2 · textures up to 8192px", "Natural Earth 1:50m · 59,144
    coastline segments", "Star catalogue · 5,044 naked-eye stars (XHIP)", "16,764 satellites ·
    CelesTrak · updated 3 min ago", "SGP4 propagator · first keyframes in 2158 ms", "Observer ·
    Cebu City 10.293°, 123.902°";
  - progress and an error box;
  - if WebGL 2 is missing, a clear message.
- **Frame pacing:** full rate while interacting (until 1.5 s after the last input), while the
  camera animates or follows, and until the swarm is ready; 30 fps when live and idle; about 2 fps
  when paused and idle; stop when hidden.
- After sleep, a live view snaps back to real time.
- **Keyboard:**

  | Key | Action |
  | --- | --- |
  | `/` | search |
  | Space | pause/play |
  | `[` `]` | slower/faster |
  | Shift+←/→ | ±1 h |
  | N | now |
  | F | follow |
  | O | paths |
  | V | style |
  | C | constellations |
  | G | grid |
  | R | reset view |
  | Esc | deselect |
  | ? | help |

- **Settings:** in `localStorage` under the key `globals.settings.v1`: observer, minElDeg, style,
  show-toggles, hiddenCats, radarMode.
- **URL options:**

  | Option | Effect |
  | --- | --- |
  | `#sat=<id>` | select a satellite; the hash updates |
  | `?t=` | start at a time |
  | `?rate=` | start speed |
  | `?style=photo\|holo` | globe style |
  | `?tab=` | open a tab |
  | `?data=fixtures` | demo data |
  | `?synthetic=N` | add synthetic objects |
  | `?test=1` | exposes `window.__globals` with `ready` |
  | `?sw=1` | enables the service worker on localhost |

- **Responsive:**
  - ≤ 1100 px: optional clock cells hide.
  - ≤ 820 px: tabs move to a bottom bar and the panels become sheets, with no horizontal overflow
    at 390 px.
- `prefers-reduced-motion` is respected.
- **Window Controls Overlay:** a drag region in the title bar.

### 10. Distribution

**10.1 Local dev server (`tools/serve.mjs`)**
- A zero-dependency static server, `--port`, `--root`, with `no-store` caching.
- MIME types include `.webmanifest`.

**10.2 Single file (`tools/build-single.mjs` → `dist/GlobalS.html`, about 8.1 MB, deterministic)**

A page opened from disk (`file://`, origin `null`) may **not** load module scripts, start module
workers from `blob:` URLs, or `fetch()` neighbouring files. Solution:

- **Module graph.**
  - Build it from `index.html`: the import map, the module script and the worker URLs of the form
    `new URL('./workers/x.worker.js', import.meta.url)`. Reuse the checker's parser (§11).
  - Detect cycles; the load must be acyclic.
- **Rewrite specifiers only, never syntax.**
  - Replace each import specifier literal with a placeholder `'\uFDD0M:<path>'`.
  - Replace each worker URL with `new URL('\uFDD0W:<path>')`.
  - The browser's own module semantics (live bindings, `export *`) stay intact.
- **Order.** Emit a depth-first post-order ("dependencies first") for the page and for each worker.
- **Embedding.**
  - Put every module's source into `<script type="application/json" id="globals-bundle">`.
  - Escape every `<` as `\u003c` so the JSON can never close its script tag, and escape U+FDD0.
  - JSON assets go in as text; the NASA JPEGs and the favicon as base64 `data:` URLs; the CSS
    inline.
  - Remove the import map, modulepreloads, the manifest link and the module script.
- **Inline loader** (a classic script):
  1. Parse the bundle and set `globalThis.GLOBALS_SINGLE = {build}`.
  2. Install a `fetch` shim that serves embedded paths (e.g. `assets/geo/countries-50m.json`)
     relative to the file's folder.
  3. Create each worker's start-up script (below).
  4. Create `blob:` URLs for page modules, dependencies first, replacing placeholders with blob URLs.
  5. `import()` the entry. On failure, show the message in the boot error box.
- **Workers.**
  - Chromium refuses *module* workers from page-created blob URLs on `file://`, but it allows a
    **classic** blob worker, and allows a worker to `import()` blob URLs **it created itself**.
    Tested: `data:` module workers also work.
  - So each worker starts as a classic blob script. It receives its module table (sources in
    dependency order), builds its own blob URLs, and `import()`s its entry.
  - Messages that arrive meanwhile are held (`self.onmessage = hold`), then re-dispatched with
    `self.dispatchEvent(new MessageEvent('message', {data}))` once `serve()` has replaced the
    handler.
  - `WorkerClient` uses `{type: 'classic'}` when `GLOBALS_SINGLE` is set.
- **Marker.** Add `<meta name="generator" content="GlobalS single-file build <12-hex>">`. The starter
  file checks for it.
- **In single-file mode:**
  - no service worker and no Install button;
  - the Data tab shows the build id and "Keeps the last data it downloaded".
- **Checks:**
  - no placeholders left;
  - topological order holds;
  - no unescaped `<` in the bundle;
  - under 16 MB;
  - byte-identical rebuilds, including from a checkout with CRLF line endings;
  - `tools/smoke-single.mjs` opens it from `file://` in headless Chrome or Edge and checks the
    start-up log. It works on Windows with
    `--chrome "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"`.
  - Drive the smoke test with the **DevTools protocol** (`--remote-debugging-port=0`, read
    `DevToolsActivePort`, then Node's built-in WebSocket and `Runtime.evaluate` polling). Don't use
    `--virtual-time-budget`: with WebGL and software rendering it effectively never finishes.

**10.3 Starter file (`launcher/GlobalS.html`, about 4 KB)**
- It fetches the single file from `https://raw.githubusercontent.com/<owner>/<repo>/app/GlobalS.html`,
  falling back to jsDelivr `@app`. Use a streaming read with a progress bar.
- It checks the build marker.
- It keeps `{build, html}` in IndexedDB (`globals-starter`), and rewrites it only when the build
  changes.
- Then `document.open(); document.write(html); document.close()`. The page keeps the starter's
  `file://` URL, so the fetch shim works.
- Offline, it starts from the saved copy. On a first start without internet, it shows a clear
  message.
- It's small enough to upload through a Google Drive connector as `text/html`, with conversion to
  Google types **disabled**.

**10.4 Optional web version / PWA (GitHub Pages)**

- **Manifest:**
  - `id "/<repo>/"`, `start_url "./?source=pwa"`, `scope "./"`;
  - `display standalone` with `display_override ["window-controls-overlay","standalone"]`;
  - colours `#02040a`;
  - icons: SVG, PNG 48/96/192/256/512 and a maskable 512 (the 180 px PNG is the apple-touch icon);
  - shortcuts `./?tab=passes` and `./?tab=sky`;
  - `launch_handler {client_mode: ["focus-existing","auto"]}`;
  - `file_handlers` (action `./?source=file`) for `.tle .3le .txt .json`, read via `launchQueue`.
    A small import (≤ 20 objects) selects the first one.
- **`sw.js`** (classic):
  - `VERSION`, `TEX_VERSION` and `PRECACHE` are stamped at deploy by `tools/stamp-sw.mjs`.
    `VERSION` = sha256 over the sorted "path NUL sha256" lines of the **app files only**, so
    data-only deploys never force a re-download. Unstamped means development: pass everything
    through.
  - Caches:
    - `globals-shell-<VERSION>`: precached with `cache: 'reload'`;
    - `globals-data`: exactly one snapshot, stored when the page reports `KEEP_DATA` after a
      successful load;
    - `globals-tex-<TEX_VERSION>`: filled on first use.
  - Fetch strategies:
    - navigations: the cached `index.html`;
    - `data/manifest.json`: network-first with a 4 s limit; if falling back to cache, add the
      header `x-globals-from-cache: 1`;
    - versioned data: cache-first, falling back to the snapshot;
    - other app files: cache-first.
  - Activation deletes old `globals-*` caches only. Other github.io project sites share the origin.
  - Updates: a toast offers **Reload**, which posts `SKIP_WAITING`. Reload exactly once, and don't
    reload on the *first* install.
  - "Reset app cache" unregisters only this scope.
- **Deploy tools:**
  - `tools/stage-site.mjs`: allowlist copy into `_site/`. It refuses to wipe the source or a
    parent of it; guard with `path.relative`, including `/`.
  - `tools/check-imports.mjs`:
    - every import, worker and asset resolves;
    - bare imports resolve through the import map, and never appear in worker code;
    - `js/core` stays pure;
    - satellite.js's `index.js` is never imported;
    - manifest icon sizes match;
    - with `--precache`, everything is precached;
    - no cycles.

**10.5 Local-only mode (no GitHub)**
- `node tools/fetch-celestrak.mjs --out data` (a PC can reach CelesTrak directly), then
  `node tools/serve.mjs` and open `http://localhost:8080`. The web version reads `./data/`.
- Refresh it with Windows Task Scheduler every 6 h. Keep the 2-hour rule.
- Optional extension: `build-single.mjs --embed-data data` bakes a data snapshot into the single
  file as a last-resort fallback, clearly labelled with its age.

### 11. GitHub Actions

Use Node 22 and the current majors: `actions/checkout@v6`, `actions/setup-node@v6`,
`actions/upload-artifact@v7`, `actions/download-artifact@v8`, `actions/configure-pages@v6`,
`actions/upload-pages-artifact@v5`, `actions/deploy-pages@v5`. Check for newer majors when you
build.

**`test.yml`** (every push and PR, `contents: read`, `persist-credentials: false`):
- `node --test "tests/**/*.test.mjs"`;
- `node tools/check-imports.mjs`;
- `node tools/vendor.mjs --check`;
- stage, stamp and `check-imports --root _site --precache`;
- `build-single` plus `smoke-single` (Chrome on the runner; `--no-sandbox` when `CI` is set).

**`publish.yml`** (push to main, cron `41 */6 * * *`, and `workflow_dispatch` with a `force_fetch`
input; concurrency `publish`). Jobs:

1. **`data`** (`contents: write`):
   - tests;
   - previous data from `git fetch origin data`;
   - run the relay;
   - refuse fewer than 1,000 objects;
   - describe the data in the step summary;
   - orphan commit: `git checkout --orphan`, `git rm -rq --cached .`, add the 4 files, commit,
     `git push --force origin HEAD:refs/heads/data`;
   - jsDelivr purge;
   - upload `_data` as an artifact.
2. **`release`** (`contents: write`; `if: !cancelled() && event != schedule`, so it runs even if
   CelesTrak failed):
   - build and smoke-test (`--require-data` when data succeeded);
   - `gh release create v<APP_VERSION>` if missing, then `gh release upload … --clobber`;
   - force-push `GlobalS.html` to the `app` branch for the starter, then purge jsDelivr's
     `@app/GlobalS.html`, best effort;
   - the stable link is `releases/latest/download/GlobalS.html`.
3. **`pages-check`** (`pages: read`): `gh api repos/<repo>/pages` works only when Pages is enabled
   with Source: GitHub Actions.
4. **`pages`** (only if enabled):
   - stage, and download the `data` artifact into `_site/data`, so CelesTrak is never contacted
     twice;
   - stamp, check, upload-pages-artifact, deploy-pages.

**Notes:**
- Pushes made with `GITHUB_TOKEN` don't trigger other workflows, so there are no loops.
- Scheduled workflows pause after 60 days without repository activity. The app's red data badge
  explains how to re-enable them.

**Optional workflows:**
- `data-check.yml`: runs the relay without deploying on `claude/**` branches when the relay
  changes, with an `actions/cache` of its previous output.
- `textures.yml`: fetches the NASA textures on a runner and commits them.

### 12. Tests and verification

**Unit tests** (`node --test`, no npm) and their tolerances:

| What is checked | Against | Tolerance |
| --- | --- | --- |
| SGP4 positions and velocities | Vallado verification suite (`SGP4-VER.TLE` + `tcppver.out` from the python-sgp4 2.27 sdist, MIT), 500+ states | 2e-7 km and km/s |
| SGP4 error codes | the deliberately broken cases | `[1,1,6,6,4,3,6]` |
| GMST (IAU-82) | Skyfield / sgp4 | 1e-9 h (J2000.0: 18.697374558 h) |
| Frame identities and round trips | — | 1e-9 or better |
| Sun RA/Dec (1990–2045) | Skyfield + DE421 | 0.01° (achieved 0.009°) |
| Cebu Sun altitude and azimuth | Skyfield | 0.02° |
| Dusk and dawn times | Skyfield | 10 s |
| Look angles | Skyfield | 0.01° (azimuth scaled by 1/cos el) |
| Pass rise / set times | Skyfield brute force at 1 s, cross-checked with `find_events` | 1 s (achieved 0.04 s / 0.23 s over 95 passes) |
| Pass rise / set azimuth; culmination time | Skyfield | 0.05°; 5 s |
| Pass maximum elevation | Skyfield | 0.02° (achieved 0.005°) |
| Pass count | Skyfield | equal |
| Sunlit transitions | Skyfield `is_sunlit` | 2 s |
| Star precession (IAU-1976, to 2026-09-25) | Skyfield (IAU 2006) | 1″ |
| Hermite interpolation | — | sub-metre at 60 s |

Other checks:
- **Pass cases** include in-progress and grazing passes, over Cebu.
- **Data handling:** clock continuity; Alpha-5 and six-digit parsing; de-duplication; categories;
  search ranking; the land-mask spot checks; relay branches with a mocked `fetch` (fresh, reuse,
  force, 403 breaker, unreachable breaker, 5xx retry, shrunken catalogue).
- **Deploy tools:** stage/stamp determinism; the service-worker strategies run against an in-memory
  Cache API in `node:vm`.
- **Single-file build:** its invariants (§10.2); the starter's marker and URL.

**References.** `tools/reference/gen_refs.py` is Python and runs once, never in CI; its JSON output
is committed.
- It uses Skyfield 1.55, sgp4 2.27 and skyfield-data 7.0.0 (for DE421), plus numpy:
  `pip install skyfield==1.55 sgp4==2.27 skyfield-data==7.0.0 numpy`.
- It writes synthetic REF objects to `tests/fixtures/omm/ref-objects.json`:
  - epoch `2026-09-24T12:00:00.123456`;
  - REF-ISS 90001, REF-SSO 90002, REF-GPS 90003, REF-GEO124 90004, REF-MOLNIYA 90005,
    REF-SIXDIGIT 100123, REF-STARLINK 90007.
- It writes the reference values to `tests/fixtures/ref/skyfield.json`.
- **Pitfall:** convert Unix milliseconds with `datetime(1970,1,1, tzinfo=utc) + timedelta(...)`.
  `ts.utc(1970, …, seconds)` counts leap seconds, which skewed everything by 27 s.

**Browser end-to-end tests** (developer only; Playwright or the DevTools protocol, with Chromium).
The page must have no console errors. Coverage:
- search and select;
- time controls and the LIVE/SIMULATED badge;
- follow mode;
- TLE import;
- 390 px layout;
- first install without a reload, and offline start;
- the update flow (exactly one reload);
- installability (no errors);
- file launch and shortcut tabs;
- data swap keeping the selection;
- the single file from `file://` with a routed feed: offline start from IndexedDB, back online,
  photoreal textures from embedded data;
- the starter file online, offline and on a first start.

Finally, the **real released file** with the live feed: about 16,800 satellites, ISS 25544 present,
and passes over Cebu.

**Visual review:** holographic and photoreal globes at 1600×900, at 390×844, and the photoreal
terminator. Check the −6° contour crosses Cebu when Skyfield says: civil dusk there is at
09:59:47 UTC (5:59:47 PM Philippine time) on 2026-09-25.

### 13. Pitfalls we actually hit (read before coding)

1. **satellite.js**
   - `dist/index.js` drags in WASM that only loads in Node. Import the individual modules instead.
   - `json2satrec` can't parse 6 fractional digits in `EPOCH`, so normalize the epoch.
2. **Six-digit catalogue numbers.** TLE can't represent them; use OMM JSON.
3. **Skyfield time conversion.** `ts.utc(1970, …, seconds)` counts leap seconds (27 s). Go through
   `datetime`.
4. **Picking up the camera too early.** Centring before the first exact position exists flew the
   camera to the origin. Defer the focus to the render loop, and reject zero vectors.
5. **Texture size.** Read the texture's width **before** `ImageBitmap.close()`; after closing it
   reports 0×0.
6. **Atmosphere lighting.** Lit by back-face normals, the night limb glowed cyan. Use the limb
   direction.
7. **Search ranking.** "ISS DEB" outranked "ISS (ZARYA)", so add the junk penalty.
8. **Land mask.** Without ring unwrapping at ±180°, the land mask gets 360° streaks. Antarctica
   also needs polar closure.
9. **UI details.**
   - Negative ages showed "just now in the future" and "−0.0 d"; below-horizon angles showed
     "−72° up".
   - The location buttons overflowed a 320 px panel.
10. **Service worker.**
    - It reloaded the page on the *first* install; only reload on updates.
    - It deleted other github.io sites' caches; filter by name prefix and scope.
11. **`file://` restrictions.**
    - It blocks module scripts, module workers from page blobs and local `fetch`.
    - What works: blob-URL modules on the page, classic blob workers, a worker importing its own
      blobs, and `data:` module workers. IndexedDB and localStorage work too.
12. **Headless Chrome.** `--virtual-time-budget` hangs with WebGL; use the DevTools protocol.
13. **CelesTrak refusing runners.**
    - Specific GitHub runner IPs were refused ("fetch failed" instantly), while others worked.
    - Fail fast ("unreachable" breaker), keep the previous data, and don't block the release on the
      data job.
    - Don't re-download within 2 h. A second workflow right after the first counts too.
14. **GitHub limits.**
    - raw.githubusercontent.com allows 60 unauthenticated requests per hour per IP.
    - GitHub Pages must be enabled (Settings → Pages → Source: **GitHub Actions**) before a Pages
      deploy works. Skip that job when it's off, don't fail it.
15. **Checkout credentials.** `actions/checkout@v6` keeps its credentials in an included config
    file. Pushing an orphan commit from the main checkout works.
16. **Google Drive connectors** take content inline, so an 8 MB file won't fit. That's why the 4 KB
    starter exists.
17. **Git line endings.**
    - Git for Windows' CRLF conversion breaks the vendored-file hashes.
    - It also broke the single-file build: its `index.html` edits looked for `\n`.
    - Add `.gitattributes` (§4), and normalize `\r\n` in build inputs. Test a CRLF copy.

### 14. Build order (each phase ends with green tests, a browser smoke check and a commit)

| Phase | Build | Acceptance |
| --- | --- | --- |
| 0 | `tools/vendor.mjs` + pinned vendoring, `serve.mjs`, `index.html` skeleton with import map, `.gitattributes`, `fetch-textures.mjs` | `vendor.mjs --check` passes; the page loads three.js and a satellite.js facade with no errors |
| 1 | `js/core/*` maths + `gen_refs.py` + references + the Vallado suite | every §12 tolerance met |
| 2 | Data: `omm.js`, `catalog.js`, `landmask.js`, `geo.js`, fixtures, `fetch-celestrak.mjs` with mocked tests, `loader.js` | relay tests pass; the land mask spot checks pass |
| 3 | Globe: scene, cameras, WGS-84 mesh, HUD shader, lines, terminator, atmosphere, sky pass | terminator checked at an equinox and a solstice; screenshots reviewed |
| 4 | Swarm: worker, keyframes, Hermite, picking, time bar, badges | 20,000 synthetic objects at about 1 ms/frame of JavaScript |
| 5 | Selection: search, details, orbit, track, footprint, follow, labels | interaction tests pass |
| 6 | Observer and passes: form, overhead list, passes worker, tonight, radar | passes match the Skyfield references |
| 7 | HUD polish: honest boot log, tabs, responsive layout, accessibility, help and shortcuts | 390 px layout has no horizontal overflow |
| 8 | Photoreal mode: shader, texture sizing, fallback | NASA imagery renders, and the fallback path works |
| 9 | Single file + starter + smoke tool | `file://` tests (§12) pass |
| 10 | Optional PWA + deploy tools + service-worker tests | offline, update and install checks pass |
| 11 | Workflows + README (download first) + ATTRIBUTION | publish creates the data branch, the release and the app branch |

### 15. Definition of done

- `GlobalS.html` opens from `file://` in Edge and shows about 16,800 real satellites within
  seconds, with data refreshed every 6 hours.
- ISS pass times over Cebu agree with Heavens-Above or N2YO to within about a minute.
- Every test is green, and the README tells a non-developer how to download and use it.

---

### Appendix A — instruction files

`AGENTS.md` (keep under a few KB; Codex caps instruction files at 32 KiB):

```markdown
# GlobalS — agent instructions
The full specification is docs/GLOBALS_V2_SPEC.md. Read it before changing anything.
- Plain HTML/CSS/ES modules; no npm, no bundler. Third-party code is vendored by tools/vendor.mjs (pinned versions).
- js/core is pure (no DOM/three/fetch) and is tested in Node: node --test "tests/**/*.test.mjs".
- Workers never import 'three'. Never import satellite.js dist/index.js.
- Every number in the UI must be real; label demo data; show data age.
- Be polite to CelesTrak: once per group per 2 h, 2 s apart, stop on 403/unreachable.
- Before committing: tests green, node tools/check-imports.mjs, node tools/vendor.mjs --check.
- Windows: keep LF line endings (.gitattributes); tools must run with plain `node` on Windows.
```

`CLAUDE.md`:

```markdown
@AGENTS.md
```

### Appendix B — credits to keep

Put these in `ATTRIBUTION.md` and in the app's Data tab:
- orbital data: CelesTrak (T. S. Kelso), from U.S. Space Force data;
- three.js (MIT);
- satellite.js (MIT), after Vallado et al. 2006;
- topojson-client and world-atlas (ISC), with Natural Earth data (public domain);
- d3-celestial (BSD-3), with the XHIP stars;
- NASA Blue Marble NG and Black Marble 2016 (NASA Earth Observatory, public domain);
- for testing: python-sgp4 (MIT) and Skyfield (MIT).
