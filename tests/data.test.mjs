import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATEGORIES, CATEGORY_INDEX, buildSearchIndex, categorize, facetBits, membership, search } from '../js/core/catalog.js';
import { compactOmm, decodeAlpha5, dedupeById, parseTleText, sniffFormat, tleChecksum, validateOmm } from '../js/core/omm.js';
import { readJson } from './helpers.mjs';

const REF = readJson('tests/fixtures/omm/ref-objects.json');
const ISS1 = '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992';
const ISS2 = '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442';

test('Alpha-5 catalog numbers decode like the Space Force defines them (I and O skipped)', () => {
  assert.equal(decodeAlpha5('25544'), 25544);
  assert.equal(decodeAlpha5('    5'), 5);
  assert.equal(decodeAlpha5('A0000'), 100000);
  assert.equal(decodeAlpha5('A0001'), 100001);
  assert.equal(decodeAlpha5('H9999'), 179999);
  assert.equal(decodeAlpha5('J0000'), 180000);
  assert.equal(decodeAlpha5('P0000'), 230000);
  assert.equal(decodeAlpha5('Z9999'), 339999);
  assert.ok(Number.isNaN(decodeAlpha5('I0000')));
  assert.ok(Number.isNaN(decodeAlpha5('O0000')));
});

test('TLE checksums and 2LE/3LE parsing, including "0 " name prefixes and Alpha-5', () => {
  assert.equal(tleChecksum(ISS1), 2);
  assert.equal(tleChecksum(ISS2), 2);
  const a5l1 = `1 A0001U 26999A   ${ISS1.slice(18)}`;
  const a5l2 = `2 A0001 ${ISS2.slice(8)}`;
  const text = `0 ISS (ZARYA)\n${ISS1}\n${ISS2}\n${ISS1}\n${ISS2}\nNEW SAT\n${a5l1}\n${a5l2}\n`;
  const { sets, errors } = parseTleText(text);
  assert.equal(errors.length, 0);
  assert.equal(sets.length, 3);
  assert.equal(sets[0].name, 'ISS (ZARYA)');
  assert.ok(sets[0].checksumOk);
  assert.equal(sets[1].name, 'CATALOG 25544', 'unnamed 2LE sets get a placeholder name');
  assert.equal(sets[2].id, 100001);
  assert.equal(sets[2].name, 'NEW SAT');
  const broken = parseTleText(`${ISS1}\n2 25545 ${ISS2.slice(8)}`);
  assert.equal(broken.sets.length, 0);
  assert.equal(broken.errors.length, 1);
});

test('format sniffing', () => {
  assert.equal(sniffFormat('[{"OBJECT_NAME":"X"}]'), 'omm');
  assert.equal(sniffFormat(`ISS\n${ISS1}\n${ISS2}`), 'tle');
  assert.equal(sniffFormat('hello'), null);
});

test('OMM validation catches the mistakes that would break SGP4', () => {
  assert.equal(validateOmm(REF[0]), null);
  assert.match(validateOmm({ ...REF[0], ECCENTRICITY: 1 }), /ECCENTRICITY/);
  assert.match(validateOmm({ ...REF[0], MEAN_MOTION: 0 }), /MEAN_MOTION/);
  assert.match(validateOmm({ ...REF[0], NORAD_CAT_ID: 1.5 }), /NORAD/);
  assert.match(validateOmm({ ...REF[0], EPOCH: '2026-13-01' }), /EPOCH/);
  assert.match(validateOmm({ ...REF[0], EPHEMERIS_TYPE: 4 }), /SGP4/);
  assert.equal(validateOmm({ ...REF[0], NORAD_CAT_ID: 270001 }), null, 'six-digit ids are valid');
  assert.deepEqual(Object.keys(compactOmm(REF[0])).includes('ELEMENT_SET_NO'), false);
});

test('de-duplication keeps the newest element set', () => {
  const older = { ...REF[0], EPOCH: '2026-09-20T00:00:00.000000' };
  const kept = dedupeById([older, REF[0], REF[1]]);
  assert.equal(kept.length, 2);
  assert.equal(kept.find((o) => o.NORAD_CAT_ID === REF[0].NORAD_CAT_ID).EPOCH, REF[0].EPOCH);
});

test('categories: groups first, then names, then orbit regime', () => {
  const g = (...names) => new Set(names);
  assert.equal(CATEGORIES[categorize('ISS (ZARYA)', g('stations', 'visual'), 'LEO')].key, 'stations');
  assert.equal(CATEGORIES[categorize('NAVSTAR 81', g('gps-ops'), 'MEO')].key, 'gnss');
  assert.equal(CATEGORIES[categorize('STARLINK-1007', g(), 'LEO')].key, 'starlink');
  assert.equal(CATEGORIES[categorize('ONEWEB-0012', g(), 'LEO')].key, 'oneweb');
  assert.equal(CATEGORIES[categorize('HIMAWARI-9', g('weather'), 'GEO')].key, 'weather');
  assert.equal(CATEGORIES[categorize('SES-9', g(), 'GEO')].key, 'geo');
  assert.equal(CATEGORIES[categorize('SOMESAT', g(), 'LEO')].key, 'other');
  assert.equal(CATEGORIES[categorize('FLOCK 4Y-12', g(), 'LEO')].key, 'weather', 'Planet imaging fleet');
  assert.equal(CATEGORIES[categorize('QIANFAN-17', g(), 'LEO')].key, 'megacon');
  assert.equal(CATEGORIES[categorize('IRIDIUM 180', g(), 'LEO')].key, 'megacon');
  assert.equal(CATEGORY_INDEX.other, CATEGORIES.length - 1);
  assert.equal(facetBits(g('visual', 'last-30-days')), 0b11);
  const m = membership({ stations: [25544], visual: [25544, 20580] });
  assert.deepEqual([...m.get(25544)].sort(), ['stations', 'visual']);
});

test('search ranks exact ids and names first, then prefixes, word starts and COSPAR ids', () => {
  const names = ['ISS (ZARYA)', 'ISS DEB', 'HUBBLE SPACE TELESCOPE', 'STARLINK-1007', 'TIANGONG (CSS)', 'NOAA 19'];
  const ids = [25544, 47853, 20580, 44713, 48274, 33591];
  const cospars = ['1998-067A', '1998-067RZ', '1990-037B', '2019-074A', '2021-035A', '2009-005A'];
  const idx = buildSearchIndex(names, ids, cospars);
  assert.deepEqual(search(idx, '25544'), [0]);
  assert.equal(search(idx, 'iss')[0], 0);
  assert.deepEqual(search(idx, 'iss').slice(0, 2).sort(), [0, 1]);
  assert.equal(search(idx, 'telescope')[0], 2, 'word start inside a name');
  assert.equal(search(idx, '1998-067A')[0], 0);
  assert.equal(search(idx, '98067')[0] ?? null, null, 'COSPAR needs the 4-digit year');
  assert.deepEqual(search(idx, ''), []);
});
