# SGP4 verification suite

`SGP4-VER.TLE` and `tcppver.out` are David Vallado's SGP4 verification cases and C++ output from
"Revisiting Spacetrack Report #3" (Vallado, Crawford, Hujsak & Kelso, AIAA 2006-6753), taken
unchanged from the python-sgp4 2.27 source distribution (MIT licence, see `LICENSE-python-sgp4`).
`tests/sgp4-conformance.test.mjs` runs them against the vendored satellite.js exactly the way
python-sgp4's own suite does.
