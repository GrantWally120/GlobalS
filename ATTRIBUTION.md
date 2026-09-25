# Credits and licences

GlobalS stands on other people's work. Everything below is redistributed unchanged and under its
own licence; the full licence texts ship alongside the files (`vendor/*/LICENSE*`,
`assets/*/LICENSE`). Exact versions and checksums are in [VENDOR.md](VENDOR.md).

## Software

| Component | Used for | Licence |
| --- | --- | --- |
| [three.js](https://threejs.org) 0.186.1 — © 2010–2026 three.js authors | 3D rendering, camera controls, wide lines | MIT |
| [satellite.js](https://github.com/shashwatak/satellite-js) 7.1.0 — © 2013 Shashwat Kandadai, UCSC Jack Baskin School of Engineering | SGP4/SDP4 propagation, coordinate transforms, Sun position, eclipse test | MIT |
| [topojson-client](https://github.com/topojson/topojson-client) 3.1.0 — © 2012–2019 Michael Bostock | Decoding the world map | ISC |

satellite.js implements the SGP4 model as published in *Revisiting Spacetrack Report #3*
(D. A. Vallado, P. Crawford, R. Hujsak, T. S. Kelso; AIAA 2006-6753).

## Data

| Data | Source | Licence |
| --- | --- | --- |
| Orbital elements (fetched every 6 hours, not stored in this repository) | [CelesTrak](https://celestrak.org) (Dr T. S. Kelso), from U.S. Space Force tracking data published via Space-Track.org | Public data; credit CelesTrak |
| Coastlines, borders and land (1:50m) | [Natural Earth](https://www.naturalearthdata.com), via [world-atlas](https://github.com/topojson/world-atlas) 2.0.2 (© 2013–2019 Michael Bostock) | Public domain (data); ISC (packaging) |
| 5,044 naked-eye stars | XHIP: An Extended Hipparcos Compilation (Anderson & Francis 2012, VizieR V/137D), via [d3-celestial](https://github.com/ofrohn/d3-celestial) 0.7.35 (© 2015 Olaf Frohn) | BSD-3-Clause |
| Constellation lines | IAU constellation charts, as adapted by Olaf Frohn in d3-celestial 0.7.35 | BSD-3-Clause |
| Photoreal globe, day | *Blue Marble: Next Generation* (July 2004), NASA Earth Observatory — Reto Stöckli, NASA GSFC | Public domain (NASA) |
| Photoreal globe, night | *Black Marble 2016*, NASA Earth Observatory — Joshua Stevens, Miguel Román, NASA GSFC; Suomi NPP VIIRS | Public domain (NASA) |

NASA imagery is not copyrighted; NASA asks to be credited and does not endorse GlobalS.
The texture sources and checksums are recorded in `assets/textures/textures.json`.

## Used for testing only (not part of the app)

- SGP4 verification cases `SGP4-VER.TLE` and `tcppver.out` by D. A. Vallado, from the
  [python-sgp4](https://github.com/brandon-rhodes/python-sgp4) 2.27 distribution (© Brandon Rhodes, MIT;
  see `tests/fixtures/sgp4-verification/LICENSE-python-sgp4`).
- Reference positions, passes and Sun data generated once with [Skyfield](https://rhodesmill.org/skyfield/)
  1.55 (© Brandon Rhodes, MIT) and the JPL DE421 ephemeris (`tools/reference/gen_refs.py`).
