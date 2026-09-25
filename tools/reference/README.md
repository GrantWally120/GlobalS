# Reference values for GlobalS's tests

GlobalS checks its astronomy against an independent, widely used implementation:
[Skyfield](https://rhodesmill.org/skyfield/) with the JPL DE421 ephemeris, and python-sgp4.

`gen_refs.py` writes:

- `tests/fixtures/omm/ref-objects.json` — seven **REF-\*** element sets (ISS-like, sun-synchronous,
  GPS-like, geostationary over 124°E, Molniya-like, a six-digit catalog number, Starlink-like).
  They are realistic but **not real satellites**.
- `tests/fixtures/ref/skyfield.json` — GMST, Sun RA/Dec, Sun altitude and twilight at Cebu City,
  satellite states and look angles, passes over Cebu (≥0° and ≥10°, refined to ~1 ms), sunlight
  transitions and star precession.

CI never runs Python; the JSON is committed. To regenerate:

```sh
python3 -m venv .venv
.venv/bin/pip install skyfield==1.55 sgp4==2.27 skyfield-data==7.0.0 numpy
.venv/bin/python tools/reference/gen_refs.py
```

Pitfall this script avoids: `ts.utc(1970, 1, 1, 0, 0, seconds)` counts leap seconds (27 s by 2026),
unlike POSIX time and JavaScript `Date`, so times are converted through `datetime` instead.
