#!/usr/bin/env python3
"""Generate independent reference values for GlobalS's unit tests using Skyfield.

GlobalS's own math (JavaScript) is tested against these numbers, so every astronomical
claim the app makes is checked by a second, well-established implementation.

Run once by a maintainer — CI never runs Python; the JSON output is committed:

    python3 -m venv .venv && .venv/bin/pip install skyfield==1.55 sgp4==2.27 skyfield-data==7.0.0 numpy
    .venv/bin/python tools/reference/gen_refs.py

Outputs (tests/fixtures/):
    omm/ref-objects.json   REF-* orbital elements (synthetic but realistic; NOT real satellites)
    ref/skyfield.json      reference values: GMST, Sun, satellite states, look angles, passes, sunlight, stars
"""

import json
import math
import platform
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import sgp4
import skyfield
from sgp4.api import Satrec  # noqa: F401  (documents the SGP4 implementation used)
from sgp4.propagation import gstime as sgp4_gstime
from skyfield import almanac
from skyfield.api import EarthSatellite, Loader, Star, wgs84
from skyfield.precessionlib import compute_precession
from skyfield_data import get_skyfield_data_path

ROOT = Path(__file__).resolve().parents[2]
OUT_OMM = ROOT / 'tests' / 'fixtures' / 'omm' / 'ref-objects.json'
OUT_REF = ROOT / 'tests' / 'fixtures' / 'ref' / 'skyfield.json'

load = Loader(get_skyfield_data_path())
ts = load.timescale(builtin=True)
eph = load('de421.bsp')
EARTH, SUN = eph['earth'], eph['sun']

# Default GlobalS observer: Cebu City, 10°17′35″N 123°54′07″E, 34 m (Wikipedia).
OBS = {'name': 'Cebu City', 'latDeg': 10.29306, 'lonDeg': 123.90194, 'heightM': 34.0}
TOPOS = wgs84.latlon(OBS['latDeg'], OBS['lonDeg'], elevation_m=OBS['heightM'])

MS_PER_DAY = 86_400_000.0


UNIX_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def t_from_ms(ms):
    """Skyfield Time for POSIX UTC milliseconds (scalar or array).

    Note: ts.utc(1970, 1, 1, 0, 0, seconds) would count leap seconds (27 s by 2026), unlike POSIX
    time and JavaScript's Date — so convert through datetime, which follows POSIX semantics.
    """
    if np.ndim(ms) == 0:
        return ts.from_datetime(UNIX_EPOCH + timedelta(milliseconds=float(ms)))
    return ts.from_datetimes([UNIX_EPOCH + timedelta(milliseconds=float(x)) for x in np.asarray(ms, dtype=float)])


def ms_from_t(t):
    return float((t.utc_datetime() - UNIX_EPOCH).total_seconds() * 1000.0)


def epoch_ms(epoch):
    dt = datetime.fromisoformat(epoch).replace(tzinfo=timezone.utc)
    return (dt - UNIX_EPOCH).total_seconds() * 1000.0


def gmst82_from_ms(ms):
    """IAU-82 GMST treating UTC as UT1 — exactly the model GlobalS uses (|UT1−UTC| ≤ 0.9 s)."""
    return sgp4_gstime(ms / MS_PER_DAY + 2440587.5)


# ---------------------------------------------------------------------------------------------
# Reference objects: realistic element sets with 2026 epochs. Names start with REF- so nobody
# mistakes them for live data.
# ---------------------------------------------------------------------------------------------

def omm(name, norad, epoch, n, e, i, raan, argp, m, bstar=0.0, ndot=0.0):
    return {
        'OBJECT_NAME': name, 'OBJECT_ID': f'2026-9{norad % 100:02d}A', 'EPOCH': epoch,
        'MEAN_MOTION': n, 'ECCENTRICITY': e, 'INCLINATION': i, 'RA_OF_ASC_NODE': raan,
        'ARG_OF_PERICENTER': argp, 'MEAN_ANOMALY': m, 'EPHEMERIS_TYPE': 0, 'CLASSIFICATION_TYPE': 'U',
        'NORAD_CAT_ID': norad, 'ELEMENT_SET_NO': 999, 'REV_AT_EPOCH': 1000, 'BSTAR': bstar,
        'MEAN_MOTION_DOT': ndot, 'MEAN_MOTION_DDOT': 0,
    }


EPOCH = '2026-09-24T12:00:00.123456'
GEO_LON = 124.0
_gmst_deg = math.degrees(gmst82_from_ms(epoch_ms(EPOCH)))
REF_OBJECTS = [
    omm('REF-ISS', 90001, EPOCH, 15.50103472, 0.0006703, 51.6416, 247.4627, 130.5360, 325.0288, 0.00019512, 0.00010416),
    omm('REF-SSO', 90002, EPOCH, 14.57112233, 0.0001208, 98.2009, 331.5874, 89.3121, 270.8211, 0.00002314, 0.00000187),
    omm('REF-GPS', 90003, EPOCH, 2.00563213, 0.0081442, 55.0137, 108.9402, 42.4412, 318.2255),
    # Geostationary above 124°E: mean longitude = RAAN + ω + M − GMST(epoch).
    omm('REF-GEO124', 90004, EPOCH, 1.00271000, 0.0001905, 0.0312, 88.2000, 147.8000,
        (GEO_LON + _gmst_deg - 88.2 - 147.8) % 360.0),
    omm('REF-MOLNIYA', 90005, EPOCH, 2.00607911, 0.7205113, 63.4213, 312.3187, 270.1122, 358.9021),
    omm('REF-SIXDIGIT', 100123, EPOCH, 15.20548361, 0.0012134, 97.4731, 12.0414, 201.6655, 158.4099, 0.00031205, 0.00004120),
    omm('REF-STARLINK', 90007, EPOCH, 15.06390001, 0.0001432, 53.0541, 191.2233, 81.4410, 278.6918, 0.00012051, 0.00001502),
]
for o in REF_OBJECTS:
    o['MEAN_ANOMALY'] = round(o['MEAN_ANOMALY'], 4)


def satellite(o):
    fields = {k: str(v) for k, v in o.items()}
    return EarthSatellite.from_omm(ts, fields)


# ---------------------------------------------------------------------------------------------
# Refinement helpers (independent of Skyfield's own event finder, which is only ~1 s precise).
# ---------------------------------------------------------------------------------------------

def bisect(f, a, b, tol_ms=1.0):
    fa = f(a)
    for _ in range(200):
        m = 0.5 * (a + b)
        fm = f(m)
        if (fm > 0) == (fa > 0):
            a, fa = m, fm
        else:
            b = m
        if b - a < tol_ms:
            break
    return 0.5 * (a + b)


def golden_max(f, a, b, tol_ms=1.0):
    g = (math.sqrt(5) - 1) / 2
    c, d = b - g * (b - a), a + g * (b - a)
    fc, fd = f(c), f(d)
    while b - a > tol_ms:
        if fc > fd:
            b, d, fd = d, c, fc
            c = b - g * (b - a)
            fc = f(c)
        else:
            a, c, fc = c, d, fd
            d = a + g * (b - a)
            fd = f(d)
    return 0.5 * (a + b)


def altaz(sat, ms):
    alt, az, dist = (sat - TOPOS).at(t_from_ms(ms)).altaz()
    return alt.degrees, az.degrees, dist.km


# ---------------------------------------------------------------------------------------------

def gen_gmst():
    out = []
    for iso in ['1990-01-01T00:00:00Z', '2000-01-01T12:00:00Z', '2004-06-11T06:33:12.500Z', '2019-06-05T12:12:58Z',
                '2026-03-20T14:46:00Z', '2026-09-25T00:00:00Z', '2026-09-25T13:37:42.123Z', '2031-12-31T23:59:59Z',
                '2045-07-04T04:04:04Z']:
        ms = epoch_ms(iso.replace('Z', ''))
        out.append({'iso': iso, 'ms': ms, 'gmstRad': gmst82_from_ms(ms)})
    return out


def gen_sun():
    rows = []
    for year in range(1990, 2046, 5):
        for month, day, hour in ((3, 21, 6), (6, 21, 18), (9, 23, 12), (12, 22, 0)):
            if len(rows) >= 48:
                break
            ms = epoch_ms(f'{year}-{month:02d}-{day:02d}T{hour:02d}:00:00')
            t = t_from_ms(ms)
            ra, dec, dist = EARTH.at(t).observe(SUN).apparent().radec(epoch='date')
            rows.append({'ms': ms, 'raDeg': ra._degrees, 'decDeg': dec.degrees, 'distAu': dist.au})
    # Sun altitude at Cebu (apparent Sun, geometric altitude — no refraction), every 2 h over a day.
    alts = []
    base = epoch_ms('2026-09-25T00:00:00')
    obs = EARTH + TOPOS
    for k in range(13):
        ms = base + k * 2 * 3_600_000
        alt, az, _ = obs.at(t_from_ms(ms)).observe(SUN).apparent().altaz()
        alts.append({'ms': ms, 'altDeg': alt.degrees, 'azDeg': az.degrees})
    # Twilight transitions at Cebu over three days (levels: 0 night, 1 astro, 2 nautical, 3 civil, 4 day).
    t0, t1 = t_from_ms(base), t_from_ms(base + 3 * MS_PER_DAY)
    f = almanac.dark_twilight_day(eph, TOPOS)
    times, levels = almanac.find_discrete(t0, t1, f)
    transitions = [{'ms': ms_from_t(t), 'level': int(level)} for t, level in zip(times, levels)]
    return {'radec': rows, 'cebuAltitude': alts, 'cebuTwilight': transitions}


def gen_satellites():
    out = []
    for o in REF_OBJECTS:
        sat = satellite(o)
        e_ms = epoch_ms(o['EPOCH'])
        states = []
        for dt_h in (0, 1, 6, 24, 72):
            ms = e_ms + dt_h * 3_600_000
            err, r, v = sat.model.sgp4_tsince((ms - e_ms) / 60000.0)
            alt, az, rng = altaz(sat, ms)
            states.append({'ms': ms, 'err': int(err), 'r': list(r), 'v': list(v),
                           'altDeg': float(alt), 'azDeg': float(az), 'rangeKm': float(rng)})
        out.append({'id': o['NORAD_CAT_ID'], 'name': o['OBJECT_NAME'], 'epochMs': e_ms,
                    'skyfieldEpochMs': ms_from_t(sat.epoch), 'states': states})
    return out


def gen_passes(min_el):
    out = []
    for o in REF_OBJECTS:
        sat = satellite(o)
        e_ms = epoch_ms(o['EPOCH'])
        t0, t1 = t_from_ms(e_ms), t_from_ms(e_ms + 3 * MS_PER_DAY)
        times, events = sat.find_events(TOPOS, t0, t1, altitude_degrees=min_el)
        el = lambda ms: altaz(sat, ms)[0]  # noqa: E731
        passes, cur = [], None
        for t, ev in zip(times, events):
            ms = ms_from_t(t)
            if ev == 0:
                cur = {'rise': bisect(lambda x: el(x) - min_el, ms - 5000, ms + 5000)}
            elif ev == 1:
                cur = cur or {'rise': None}
                tm = golden_max(el, ms - 30_000, ms + 30_000)
                if 'max' not in cur or el(tm) > cur['maxElDeg']:
                    cur['max'] = tm
                    cur['maxElDeg'] = float(el(tm))
            elif ev == 2:
                cur = cur or {'rise': None}
                cur['set'] = bisect(lambda x: el(x) - min_el, ms - 5000, ms + 5000)
                passes.append(cur)
                cur = None
        if cur:
            cur['set'] = None
            passes.append(cur)
        for p in passes:
            for key in ('rise', 'set'):
                if p.get(key) is not None:
                    alt, az, _ = altaz(sat, p[key])
                    p[key + 'AzDeg'] = float(az)
            if p.get('max') is not None:
                p['maxAzDeg'] = float(altaz(sat, p['max'])[1])
        # Brute-force cross-check: sampled maximum elevation over the window (1-minute grid).
        grid = np.arange(e_ms, e_ms + 3 * MS_PER_DAY, 60_000.0)
        alt_grid = (sat - TOPOS).at(t_from_ms(grid)).altaz()[0].degrees
        out.append({'id': o['NORAD_CAT_ID'], 'name': o['OBJECT_NAME'], 'minElDeg': min_el,
                    't0': e_ms, 't1': e_ms + 3 * MS_PER_DAY, 'passes': passes,
                    'gridMaxElDeg': float(alt_grid.max()), 'gridMinElDeg': float(alt_grid.min())})
    return out


def gen_sunlit():
    out = []
    for o in REF_OBJECTS:
        if o['OBJECT_NAME'] not in ('REF-ISS', 'REF-SSO', 'REF-GPS'):
            continue
        sat = satellite(o)
        e_ms = epoch_ms(o['EPOCH'])
        grid = np.arange(e_ms, e_ms + MS_PER_DAY, 20_000.0)
        lit = sat.at(t_from_ms(grid)).is_sunlit(eph)
        trans = []
        for k in range(1, len(grid)):
            if lit[k] != lit[k - 1]:
                f = lambda ms: 1.0 if bool(sat.at(t_from_ms(ms)).is_sunlit(eph)) else -1.0  # noqa: E731
                trans.append({'ms': bisect(f, grid[k - 1], grid[k], 10.0), 'lit': bool(lit[k])})
        out.append({'id': o['NORAD_CAT_ID'], 'name': o['OBJECT_NAME'], 't0': e_ms, 't1': e_ms + MS_PER_DAY,
                    'litAtStart': bool(lit[0]), 'transitions': trans})
    return out


def gen_stars():
    ms = epoch_ms('2026-09-25T00:00:00')
    t = t_from_ms(ms)
    P = compute_precession(t.tdb)
    out = []
    # J2000 catalogue positions (Hipparcos, epoch/equinox J2000; proper motion ignored on purpose).
    for name, ra_deg, dec_deg in (('Polaris', 37.95456067, 89.26410897), ('Sirius', 101.28715533, -16.71611586),
                                  ('Vega', 279.23473479, 38.78368896), ('Canopus', 95.98795782, -52.69566138),
                                  ('Acrux', 186.64956, -63.09909)):
        ra, dec = math.radians(ra_deg), math.radians(dec_deg)
        v = np.array([math.cos(dec) * math.cos(ra), math.cos(dec) * math.sin(ra), math.sin(dec)])
        w = P @ v
        out.append({'name': name, 'raJ2000Deg': ra_deg, 'decJ2000Deg': dec_deg,
                    'raDateDeg': math.degrees(math.atan2(w[1], w[0])) % 360.0,
                    'decDateDeg': math.degrees(math.asin(max(-1.0, min(1.0, w[2]))))})
    return {'ms': ms, 'stars': out}


def main():
    OUT_OMM.parent.mkdir(parents=True, exist_ok=True)
    OUT_REF.parent.mkdir(parents=True, exist_ok=True)
    OUT_OMM.write_text(json.dumps(REF_OBJECTS, indent=1) + '\n')
    ref = {
        'meta': {
            'generator': 'tools/reference/gen_refs.py',
            'skyfield': skyfield.__version__, 'sgp4': sgp4.__version__, 'numpy': np.__version__,
            'python': platform.python_version(), 'ephemeris': 'DE421 (skyfield-data)',
            'observer': OBS,
            'notes': 'Times are UTC ms since 1970. Altitudes are geometric (no refraction). '
                     'Pass times are refined by bisection/golden-section to ~1 ms.',
        },
        'gmst': gen_gmst(),
        'sun': gen_sun(),
        'satellites': gen_satellites(),
        'passes10': gen_passes(10.0),
        'passes0': gen_passes(0.0),
        'sunlit': gen_sunlit(),
        'stars': gen_stars(),
    }
    OUT_REF.write_text(json.dumps(ref, indent=1) + '\n')
    n10 = sum(len(p['passes']) for p in ref['passes10'])
    print(f'wrote {OUT_OMM.relative_to(ROOT)} ({len(REF_OBJECTS)} objects) and {OUT_REF.relative_to(ROOT)} '
          f'({n10} passes ≥10°)')


if __name__ == '__main__':
    main()
