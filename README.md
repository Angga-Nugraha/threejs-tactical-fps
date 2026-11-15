# SABLE YARD

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Angga-Nugraha/threejs-tactical-fps/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Angga-Nugraha/threejs-tactical-fps/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A round-based tactical FPS in the browser, built on three.js 0.187.0. Vanguard
attacks two sites in a dusk freight yard; the Wardens hold them. Plant the beacon
or eliminate the other team, earn money, buy better guns, and do it again.

The yard is fully dressed: every surface is a seeded procedural texture —
corrugated container steel with rust and stencil codes, cracked concrete, plank
crates, labelled barrels — under a gradient dusk sky with a skyline, cranes,
drifting clouds, warm lamp pools, tire marks and wet puddles. Bots are helmeted
soldiers with team shoulder pads, vest stripes and held guns, and firefights
read: longer, brighter tracers, spark bursts, scorch decals, and a bigger muzzle
flash. Bot balance is tuned so rounds last — wider aim error with range falloff,
a settle delay on first contact, and bot-vs-bot damage scaled to 0.7×, so
firefights develop instead of ending in the first five seconds.

## The game

- **First-person combat** — mouse look, WASD movement with acceleration, crouch,
  jump, collision with the map. Hitscan guns with recoil and spread that punish
  firing on the move; headshots deal 2.5x damage.
- **Two teams, short rounds** — you plus four Vanguard bots against five Warden
  bots. A round ends on elimination, a beacon detonation, a defuse, or the timer.
  First to 4 rounds takes the match (max 7).
- **An objective beyond killing** — hold E inside Site A (Foundry) or Site B
  (Silos) for 3 seconds to plant the beacon; it detonates 35 seconds later unless
  a Warden channels a 4-second defuse.
- **Money and a buy menu** — $800 to start, +$300 per kill, +$325 for a round
  win, +$150 for a loss, +$300 for a plant. Press B during the buy phase: a
  shotgun, a full-auto rifle, a DMR, a spark grenade and a plated vest.
- **Bots that play** — they walk waypoint routes to the sites, hold angles,
  react to what they see and hear, strafe and burst-fire with per-bot skill,
  lob grenades at positions they lost sight of, and go for the defuse.
- **HUD** — health, ammunition, round timer, score, money, alive counts, kill
  feed, hitmarkers, a spread-reactive crosshair, and plant/defuse progress.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look (click the game to lock the pointer) |
| Click | Fire |
| Right-click | Aim down sights (rifle / DMR) |
| R | Reload |
| 1–4 | Picket P9 / Broom-12 / Pike AR / Needle DMR |
| 5 | Select grenade (click to throw) |
| E (hold) | Plant the beacon inside a site |
| B | Buy menu (buy phase) |
| Ctrl / C | Crouch |
| Space | Jump |

## Run it

```sh
node serve.ts
# open http://localhost:8080
```

No build step, no network requests: `game/` is plain static files, and three.js
0.187.0 is vendored under `game/vendor/three/`.

## How it is built

- `game/src/main.js` — boot, the fixed 60 Hz simulation loop, shooting, the
  beacon, and the round flow; `?shot=start|play|buy|end&seed=N` stages a
  deterministic frame for screenshots.
- `game/src/world.js` — the yard: geometry, colliders, the two sites, the
  waypoint graph, and the line-of-sight test; plus the visual layer — dusk sky
  dome, skyline and cranes, lamp posts with light pools and sagging wires,
  stacked containers, sandbags, fences, pipes, signage and site decals.
  Gameplay boxes keep their exact round-1 positions and sizes.
- `game/src/player.js` — one mover shared by the player and the bots:
  acceleration, friction, gravity, crouch, jump, axis-separated collision.
- `game/src/weapons.js` — four guns and a grenade: numbers, view models,
  spread/recoil, reloads, the shop. View models are built as real guns —
  barrels, handguards, rails, magazines, a scoped DMR — with a star-sprite
  muzzle flash and a slower, readable recoil kick.
- `game/src/bots.js` — bot AI: routes, holds, perception, burst fire, grenades,
  defuse duty. Tuned so rounds breathe: aim error, reaction and burst pauses
  per skill tier, a settle delay on acquiring a target, and shared geometries
  so nine soldiers cost ~106 geometries instead of ~121.
- `game/src/combat.js` — hitscan shooting, tracers, impacts, grenade physics;
  pooled meshes, no per-frame allocation in hot loops. Tracers live 180 ms,
  impacts burst into seeded spark shards and leave dark scorch decals.
- `game/src/textures.js` — the procedural texture painters: container steel,
  concrete, crate planks, barrels, hazard stripes, site letters, signs, sky,
  glow, clouds, muzzle flash, chain-link fence and tire marks. All seeded,
  zero network requests.
- `game/src/rounds.js` — the match state machine and the economy.
- `game/src/hud.js` — every DOM readout, the kill feed, the buy menu.
- `game/src/input.js`, `game/src/audio.js`, `game/src/rng.js`, `game/src/palette.js`
  — input, synthesised sound, seeded random, the palette.

## Entry

Built for the make.fun competition "Make the best three.js tactical FPS"
(threejs-fps-02): https://make.fun/bounty/threejs-fps-02. `main.ts` copies
`game/` and `screenshots/` to `/output` and writes `dossier.json` with the
vendored `vendor/makefun-threejs.ts` library.
