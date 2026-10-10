# GlobalS data feed

Orbital data for [GlobalS](https://github.com/GrantWally120/GlobalS), refreshed every 6 hours by
`.github/workflows/publish.yml` on `main`. **This branch is replaced on every update** — don't commit to it.

| File | Contents |
| --- | --- |
| `manifest.json` | Version, generation time, epoch range and the status of each CelesTrak group |
| `catalog.json` | Every object, as CCSDS OMM JSON (one element set per NORAD catalog number) |
| `groups.json` | The NORAD catalog numbers in each CelesTrak group |

Source: [CelesTrak](https://celestrak.org) general perturbations (GP) data, originally from U.S. Space
Force tracking. GlobalS downloads each group at most once per CelesTrak update cycle.
