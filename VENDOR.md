# Vendored third-party files

GlobalS has no build step and no npm dependencies: these files are copied verbatim from the npm registry by
`node tools/vendor.mjs`, which verifies each tarball against its published sha512 integrity hash.
`node tools/vendor.mjs --check` (also run by the test suite) confirms nothing here has been edited.

| Package | Version | License | Files |
| --- | --- | --- | --- |
| three | 0.186.1 | MIT | 9 |
| satellite.js | 7.1.0 | MIT | 21 |
| topojson-client | 3.1.0 | ISC | 14 |
| world-atlas | 2.0.2 | ISC (data: Natural Earth, public domain) | 2 |
| d3-celestial | 0.7.35 | BSD-3-Clause | 4 |

## three 0.186.1

- Tarball: https://registry.npmjs.org/three/-/three-0.186.1.tgz
- Integrity: `sha512-blFeqb49wRCSGUGj7gtpfnSGHy2lwDk94RhUmS1c/hTby70kvChbWpkJ4Pm1390LqzzvTmzgXKHPEafJwCb8jA==`

- `vendor/three/LICENSE` (1,081 bytes)
- `vendor/three/build/three.module.js` (662,772 bytes)
- `vendor/three/build/three.core.js` (1,458,113 bytes)
- `vendor/three/examples/jsm/controls/OrbitControls.js` (40,755 bytes)
- `vendor/three/examples/jsm/lines/Line2.js` (1,486 bytes)
- `vendor/three/examples/jsm/lines/LineGeometry.js` (3,479 bytes)
- `vendor/three/examples/jsm/lines/LineMaterial.js` (14,020 bytes)
- `vendor/three/examples/jsm/lines/LineSegments2.js` (11,477 bytes)
- `vendor/three/examples/jsm/lines/LineSegmentsGeometry.js` (6,893 bytes)

## satellite.js 7.1.0

- Tarball: https://registry.npmjs.org/satellite.js/-/satellite.js-7.1.0.tgz
- Integrity: `sha512-U6nRml9Nb7dV9LJPiMNPyna7U7ry+1nXYkOeCEG7K/YbojQQLHHmcjPisp03VNY+HLcbQHqbt7t4t1vQMaKCLQ==`

- `vendor/satellite.js/LICENSE.md` (1,135 bytes)
- `vendor/satellite.js/dist/common-types.js` (11 bytes)
- `vendor/satellite.js/dist/constants.js` (645 bytes)
- `vendor/satellite.js/dist/dopplerFactor.js` (1,005 bytes)
- `vendor/satellite.js/dist/ext.js` (5,780 bytes)
- `vendor/satellite.js/dist/io.js` (9,473 bytes)
- `vendor/satellite.js/dist/propagation.js` (152 bytes)
- `vendor/satellite.js/dist/shadow.js` (2,977 bytes)
- `vendor/satellite.js/dist/sun.js` (5,535 bytes)
- `vendor/satellite.js/dist/transforms.js` (4,893 bytes)
- `vendor/satellite.js/dist/propagation/SatRec.js` (1,045 bytes)
- `vendor/satellite.js/dist/propagation/check-for-decay.js` (1,325 bytes)
- `vendor/satellite.js/dist/propagation/dpper.js` (6,542 bytes)
- `vendor/satellite.js/dist/propagation/dscom.js` (10,456 bytes)
- `vendor/satellite.js/dist/propagation/dsinit.js` (11,651 bytes)
- `vendor/satellite.js/dist/propagation/dspace.js` (8,063 bytes)
- `vendor/satellite.js/dist/propagation/gstime.js` (1,823 bytes)
- `vendor/satellite.js/dist/propagation/initl.js` (4,322 bytes)
- `vendor/satellite.js/dist/propagation/propagate.js` (1,162 bytes)
- `vendor/satellite.js/dist/propagation/sgp4.js` (12,835 bytes)
- `vendor/satellite.js/dist/propagation/sgp4init.js` (21,291 bytes)

## topojson-client 3.1.0

- Tarball: https://registry.npmjs.org/topojson-client/-/topojson-client-3.1.0.tgz
- Integrity: `sha512-605uxS6bcYxGXw9qi62XyrV6Q3xwbndjachmNxu8HWTtVPxZfEJN9fd/SZS1Q54Sn2y0TMyMxFj/cJINqGHrKw==`

- `vendor/topojson-client/LICENSE` (734 bytes)
- `vendor/topojson-client/src/bbox.js` (967 bytes)
- `vendor/topojson-client/src/bisect.js` (182 bytes)
- `vendor/topojson-client/src/feature.js` (2,381 bytes)
- `vendor/topojson-client/src/identity.js` (43 bytes)
- `vendor/topojson-client/src/index.js` (415 bytes)
- `vendor/topojson-client/src/merge.js` (2,775 bytes)
- `vendor/topojson-client/src/mesh.js` (1,426 bytes)
- `vendor/topojson-client/src/neighbors.js` (1,288 bytes)
- `vendor/topojson-client/src/quantize.js` (1,958 bytes)
- `vendor/topojson-client/src/reverse.js` (145 bytes)
- `vendor/topojson-client/src/stitch.js` (2,242 bytes)
- `vendor/topojson-client/src/transform.js` (540 bytes)
- `vendor/topojson-client/src/untransform.js` (630 bytes)

## world-atlas 2.0.2

- Tarball: https://registry.npmjs.org/world-atlas/-/world-atlas-2.0.2.tgz
- Integrity: `sha512-IXfV0qwlKXpckz1FhwXVwKRjiIhOnWttOskm5CtxMsjgE/MXAYRHWJqgXOpM8IkcPBoXnyTU5lFHcYa5ChG0LQ==`

- `assets/geo/LICENSE` (734 bytes)
- `assets/geo/countries-50m.json` (756,420 bytes)

## d3-celestial 0.7.35

- Tarball: https://registry.npmjs.org/d3-celestial/-/d3-celestial-0.7.35.tgz
- Integrity: `sha512-cURxIl0E+FGWnYj6gTDt80SjuiM9lklcGykj/skVy7glDg5nj/QxTUoPPArU+bpEQ+1fLy5hi920OvJ/TgliRw==`

- `assets/stars/LICENSE` (1,491 bytes)
- `assets/stars/stars.6.json` (656,721 bytes)
- `assets/stars/constellations.lines.json` (27,136 bytes)
- `assets/stars/constellations.json` (50,580 bytes)
