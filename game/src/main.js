// SABLE YARD — boot, the fixed-step loop, shooting, the beacon, and the round flow.
// The simulation runs at a fixed 60 Hz and renders at the display's rate. All state
// lives in one place (the match object, the player actor, the bot list); modules own
// their own jobs and talk through the callbacks wired up here.
// ?shot=start|play|buy|end with &seed=N sets up a deterministic frame for a capture,
// renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32, shuffle } from './rng.js';
import { createWorld } from './world.js';
import { createPlayer } from './player.js';
import { createWeaponRig, WEAPONS, GRENADE } from './weapons.js';
import { createBots } from './bots.js';
import { createCombat } from './combat.js';
import { createMatch } from './rounds.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color('#4a3547'), 32, 88);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const audio = createAudio();
const world = createWorld(scene);
const combat = createCombat(scene, world);
const bots = createBots(scene, world, random);
const rig = createWeaponRig(camera, audio);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 120;

const player = createPlayer(world.colliders, world.spawns.vanguard[0]);
const body = player.state;
const playerActor = {
  id: 'player', name: 'You', team: 'vanguard', alive: true,
  hp: 100, maxHp: 100, eyePos: new THREE.Vector3(), crouching: false,
  mover: player.mover,
};
let vestActive = false;
let grenadeSelected = false;
let lastHudWeapon = 'p9';
let lastHudGrenades = 0;
let started = false;
let frozen = false;
let elapsed = 0;
let accumulator = 0;
let lastTime = performance.now();
let gameTime = 0;
let fovTarget = 74;

const shootables = world.shootables;
const dirVec = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const eyePos = new THREE.Vector3();

// Beacon visual: a glowing post that appears where the beacon is planted.
const beaconMesh = new THREE.Group();
const beaconPole = new THREE.Mesh(
  new THREE.CylinderGeometry(0.12, 0.16, 1.1, 10),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.beacon), emissive: new THREE.Color(PALETTE.beacon), emissiveIntensity: 1.4 }),
);
beaconPole.position.y = 0.55;
const beaconLight = new THREE.PointLight(new THREE.Color(PALETTE.beacon), 8, 10);
beaconLight.position.y = 1.2;
beaconMesh.add(beaconPole, beaconLight);
beaconMesh.visible = false;
scene.add(beaconMesh);

const match = createMatch(onMatchEvent);
const hud = createHud({
  onPlay: () => {
    audio.unlock();
    if (match.state.over) restartMatch();
    else if (match.state.phase === 'end') skipEnd();
    input.requestLock();
  },
  onBuy: (id) => buyItem(id),
});

function onMatchEvent(type, data) {
  if (type === 'round-start') {
    resetRound();
    hud.banner(`ROUND ${match.state.round}`, match.state.round === 1 ? 'Plant the beacon or eliminate the Wardens' : 'Buy phase — press B to shop');
    hud.setScore(match.state.score.vanguard, match.state.score.warden, match.state.round);
  } else if (type === 'round-live') {
    hud.banner('GO', 'Eliminate the Wardens or plant the beacon');
    hud.showBuy(false);
  } else if (type === 'round-win') {
    audio.roundEnd(true);
    hud.banner('VANGUARD WINS', data.reason, 3600);
  } else if (type === 'round-lose') {
    audio.roundEnd(false);
    hud.banner('WARDENS WIN', data.reason, 3600);
  } else if (type === 'planted') {
    audio.plantDone();
    hud.banner('BEACON PLANTED', `Site ${data.site} — defend it for 35 seconds`, 3000);
    beaconMesh.position.set(match.state.beacon.x, 0, match.state.beacon.z);
    beaconMesh.visible = true;
  } else if (type === 'match-over') {
    const w = data.winner;
    hud.showOverlay('end', {
      title: w === 'vanguard' ? 'VANGUARD TAKES THE MATCH' : w === 'warden' ? 'WARDENS TAKE THE MATCH' : 'DRAW',
      sub: `Final score Vanguard ${match.state.score.vanguard} — ${match.state.score.warden} Wardens`,
      matchOver: true,
    });
    input.releaseLock();
  }
}

function roundPlan() {
  const plan = {};
  const atk = shuffle(random, ['A', 'B', 'mid', 'Aalt']);
  const atkRoutes = { A: world.routes.A, B: world.routes.B, mid: world.routes.mid, Aalt: world.routes.Aalt };
  const van = bots.list.filter((b) => b.team === 'vanguard');
  van.forEach((bot, i) => { plan[bot.id] = atkRoutes[atk[i % atk.length]]; });
  const war = bots.list.filter((b) => b.team === 'warden');
  const holds = [['siteAHold'], ['siteBHold'], ['midNorth'], ['northMid'], ['siteAHold']];
  war.forEach((bot, i) => { plan[bot.id] = holds[i % holds.length]; });
  return plan;
}

function resetRound() {
  bots.reset(roundPlan());
  combat.clear();
  beaconMesh.visible = false;
  vestActive = false;
  grenadeSelected = false;
  playerActor.alive = true;
  playerActor.hp = 100;
  playerActor.maxHp = 100;
  player.teleport(world.spawns.vanguard[0].x, world.spawns.vanguard[0].z, Math.PI);
  rig.resetToPistol();
  hud.setHealth(100, 100);
  hud.setAmmo(rig.state.ammo.p9.mag, rig.state.ammo.p9.reserve, false);
  hud.setWeapon('p9', 0);
  hud.setOwned({ p9: true });
  hud.setMoney(match.state.money);
  hud.setAlive(5, 5);
  hud.plantProgress(null);
  hud.showBuy(false);
}

function restartMatch() {
  match.state.round = 1;
  match.state.score.vanguard = 0;
  match.state.score.warden = 0;
  match.state.money = 800;
  match.state.kills = 0;
  match.state.over = false;
  match.state.matchWinner = null;
  match.startRound();
}

function skipEnd() {
  match.state.phaseTime = 0;
}

function buyItem(id) {
  if (match.state.phase !== 'buy') return;
  const price = rig.buy(id, match.state.money);
  if (price === null) {
    audio.dryFire();
    return;
  }
  match.state.money -= price;
  if (id === 'vest') {
    vestActive = true;
    playerActor.maxHp += 25;
    playerActor.hp += 25;
    hud.setHealth(playerActor.hp, playerActor.maxHp);
  }
  if (WEAPONS[id]) rig.select(id);
  hud.setMoney(match.state.money);
  hud.setOwned(rig.state.owned);
  hud.setWeapon(rig.state.current, rig.state.grenades);
  hud.setAmmo(rig.state.ammo[rig.state.current].mag, rig.state.ammo[rig.state.current].reserve, false);
}

function damageActor(actor, dmg, part, attacker) {
  if (!actor.alive) return null;
  // Bot-vs-bot damage is scaled down (polish pass 2026-11-15): with full Pike
  // damage a veteran burst deleted a bot in ~0.4 s and 3 Vanguard bots died
  // in the first 5 s of the round. Player damage is untouched — the player
  // still kills (and is killed) at full weapon numbers.
  if (actor.id !== 'player' && attacker && attacker.id !== 'player' && attacker.id !== 'grenade' && part !== 'blast') {
    dmg *= 0.7;
  }
  if (actor.id === 'player') {
    playerActor.hp -= dmg;
    hud.setHealth(playerActor.hp, playerActor.maxHp);
    hud.damageFlash();
    audio.hit(false);
    if (playerActor.hp <= 0) {
      playerActor.hp = 0;
      playerActor.alive = false;
      hud.banner('YOU ARE DOWN', 'Your team fights on', 2600);
      if (bots.aliveCount('vanguard') === 0) match.endRound('warden', 'Vanguard eliminated.');
      return 'kill';
    }
    return 'hit';
  }
  const result = bots.damage(actor, dmg, part, attacker, { time: gameTime, onDeath: onBotDeath });
  if (result === 'kill') {
    const killerIsPlayer = attacker && attacker.id === 'player';
    match.onKill('warden', 'vanguard', killerIsPlayer);
    hud.killFeed(attacker ? attacker.name : '?', actor.name, part === 'head', attacker ? attacker.team : 'vanguard');
    if (killerIsPlayer) audio.hit(true);
    hud.setMoney(match.state.money);
    if (bots.aliveCount('warden') === 0) match.endRound('vanguard', 'Wardens eliminated.');
  } else if (result === 'hit' && attacker && attacker.id === 'player') {
    audio.hit(false);
  }
  hud.setAlive((playerActor.alive ? 1 : 0) + bots.aliveCount('vanguard'), bots.aliveCount('warden'));
  return result;
}

function onBotDeath(bot) {
  hud.setAlive((playerActor.alive ? 1 : 0) + bots.aliveCount('vanguard'), bots.aliveCount('warden'));
}

function shootPlayer() {
  const def = rig.def();
  if (!rig.takeRound()) {
    audio.dryFire();
    return;
  }
  camera.getWorldDirection(dirVec);
  const spread = rig.spread(player.groundSpeed(), {
    airborne: !body.onGround,
    crouching: body.crouching,
    aiming: input.state.aiming && (def.kind === 'rifle' || def.kind === 'dmr'),
  });
  const eye = camera.position;
  const result = combat.shoot(
    { eye, dir: dirVec, team: 'vanguard', id: 'player', name: 'You' },
    def, spread, random, shootables.concat(bots.hitMeshes), damageActor,
  );
  if (result.hit) hud.hitMarker(!!result.killed);
  muzzle.copy(eye).addScaledVector(dirVec, 0.6);
  rig.pullTrigger();
  player.recoil(def.kick * (0.8 + random() * 0.4), (random() * 2 - 1) * def.kick * 0.35);
  hud.setAmmo(rig.state.ammo[rig.state.current].mag, rig.state.ammo[rig.state.current].reserve, rig.state.ammo[rig.state.current].mag === 0);
}

function shootBot(bot, eye, dir, err) {
  const def = WEAPONS[bot.weaponId];
  combat.shoot(
    { eye, dir, team: bot.team, id: bot.id, name: bot.name },
    def, err, random, shootables.concat(bots.hitMeshes), damageActor,
  );
}

function throwPlayerGrenade() {
  if (rig.state.grenades <= 0 || grenadeSelected === false) return;
  rig.state.grenades -= 1;
  camera.getWorldDirection(dirVec);
  muzzle.copy(camera.position).addScaledVector(dirVec, 0.7);
  combat.throwGrenade(muzzle, dirVec, 'vanguard', 'player');
  hud.setWeapon(rig.state.current, rig.state.grenades);
  grenadeSelected = false;
}

function grenadeDamageArea(pos, team) {
  audio.explosion();
  const actors = [playerActor, ...bots.list];
  for (const actor of actors) {
    if (!actor.alive) continue;
    const ap = actor.id === 'player'
      ? body.position
      : actor.mover.state.position;
    const dist = Math.hypot(ap.x - pos.x, ap.z - pos.z);
    if (dist > GRENADE.radius) continue;
    const dmg = GRENADE.maxDamage * Math.max(0.15, 1 - dist / GRENADE.radius);
    // A grenade only hurts the other team.
    if (actor.team === team) continue;
    damageActor(actor, dmg, 'blast', { id: 'grenade', name: 'Spark', team });
  }
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function syncActorPositions() {
  playerActor.eyePos.set(body.position.x, body.position.y + body.eye, body.position.z);
  playerActor.crouching = body.crouching;
  for (const bot of bots.list) {
    if (!bot.eyePos) bot.eyePos = new THREE.Vector3();
    bot.eyePos.set(bot.mover.state.position.x, bot.mover.state.position.y + bot.mover.state.eye, bot.mover.state.position.z);
    bot.crouching = bot.mover.state.crouching;
  }
}

function nearestSite(x, z) {
  for (const site of world.sites) {
    if (Math.hypot(site.x - x, site.z - z) <= site.radius) return site;
  }
  return null;
}

function step(dt) {
  elapsed += dt;
  gameTime = performance.now() / 1000;
  match.update(dt);
  syncActorPositions();

  // Player movement and plant channel.
  if (playerActor.alive && match.state.phase !== 'end') {
    player.step(dt, input.state.keys);
    const site = nearestSite(body.position.x, body.position.z);
    if (match.state.phase === 'live' && site && input.state.keys.has('KeyE')) {
      match.state.plant.active = true;
      match.state.plant.siteId = site.id;
      match.state.plant.progress += dt / 3;
      hud.plantProgress(Math.min(1, match.state.plant.progress), `PLANTING BEACON — SITE ${site.id}`);
      if (Math.floor(match.state.plant.progress * 10) !== Math.floor((match.state.plant.progress - dt / 3) * 10)) audio.plantTick();
      if (match.state.plant.progress >= 1) {
        match.plantBeacon(site);
        hud.plantProgress(null);
        match.state.plant.progress = 0;
      }
    } else {
      if (match.state.plant.progress > 0) match.state.plant.progress = Math.max(0, match.state.plant.progress - dt / 2);
      hud.plantProgress(match.state.plant.progress > 0.05 ? match.state.plant.progress : null, 'PLANTING BEACON');
    }
  }

  // Bots.
  const ctx = {
    time: gameTime,
    live: match.state.phase === 'live' || match.state.phase === 'planted',
    enemies: [playerActor, ...bots.list],
    noise: combat.noise,
    recentShot: combat.noise.length > 0 ? combat.noise[combat.noise.length - 1] : null,
    beacon: match.state.beacon.planted ? match.state.beacon : null,
    shootBot,
    throwGrenade: (bot, targetPos) => {
      const eye = bot.eyePos;
      dirVec.set(targetPos.x - eye.x, targetPos.y - eye.y + 2, targetPos.z - eye.z).normalize();
      combat.throwGrenade(eye, dirVec, bot.team, bot.id);
    },
    onDefused: () => {
      match.endRound('warden', 'The beacon was defused.');
      hud.plantProgress(null);
    },
  };
  bots.step(dt, ctx);
  // A defusing Warden shows progress on the player's HUD.
  const defuser = bots.list.find((b) => b.alive && b.state === 'defuse');
  if (defuser && match.state.beacon.planted) {
    hud.plantProgress(defuser.channel, 'WARDEN DEFUSING THE BEACON');
  } else if (match.state.phase === 'planted' && match.state.plant.progress <= 0.05) {
    hud.plantProgress(null);
  }

  rig.step(dt, player.groundSpeed());
  combat.step(dt, grenadeDamageArea);
  if (world.update) world.update(dt);
  // Weapon-slot HUD follows the rig from every path that can change it
  // (buy menu, 1–4 keys, __sable direct calls, ?shot staging): the old code
  // only called setWeapon from buyItem, so switching with the number keys
  // left the P9 slot highlighted while the Pike was equipped.
  if (rig.state.current !== lastHudWeapon || rig.state.grenades !== lastHudGrenades) {
    lastHudWeapon = rig.state.current;
    lastHudGrenades = rig.state.grenades;
    hud.setWeapon(rig.state.current, rig.state.grenades);
  }

  // HUD readouts.
  hud.setTimer(match.phaseTime(), match.state.phase === 'planted');
  hud.setAlive((playerActor.alive ? 1 : 0) + bots.aliveCount('vanguard'), bots.aliveCount('warden'));
  const spreadPx = rig.spread(player.groundSpeed(), { airborne: !body.onGround, crouching: body.crouching, aiming: input.state.aiming }) * 900;
  hud.crosshairSpread(4 + Math.min(26, spreadPx));
  const def = rig.def();
  const aiming = input.state.aiming && (def.kind === 'rifle' || def.kind === 'dmr');
  fovTarget = aiming ? 55 : 74;
  camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 10);
  camera.updateProjectionMatrix();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (playerActor.alive) player.look(look.x, look.y);
    for (const code of input.takePressed()) handleKey(code);
    if (input.state.firing && rig.ready() && playerActor.alive
      && (match.state.phase === 'live' || match.state.phase === 'planted')) {
      if (grenadeSelected) throwPlayerGrenade();
      else shootPlayer();
    }
    if (input.state.keys.has('KeyR')) rig.reload();
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    hud.setAmmo(rig.state.ammo[rig.state.current].mag, rig.state.ammo[rig.state.current].reserve, rig.state.ammo[rig.state.current].mag === 0);
  }
  renderer.render(scene, camera);
}

function handleKey(code) {
  if (match.state.phase === 'buy' || hud.isBuyOpen()) {
    if (code === 'KeyB') {
      hud.showBuy(!hud.isBuyOpen());
      if (hud.isBuyOpen()) input.releaseLock();
      else input.requestLock();
      return;
    }
    if (hud.isBuyOpen()) {
      const buyKeys = { Digit2: 'scatter', Digit3: 'pike', Digit4: 'longshot', Digit5: 'spark', Digit6: 'vest' };
      if (buyKeys[code]) buyItem(buyKeys[code]);
      return;
    }
  } else if (code === 'KeyB' && match.state.phase === 'buy') {
    hud.showBuy(true);
    input.releaseLock();
    return;
  }
  if (code === 'Digit1') { rig.select('p9'); grenadeSelected = false; }
  if (code === 'Digit2') { if (rig.select('scatter')) grenadeSelected = false; }
  if (code === 'Digit3') { if (rig.select('pike')) grenadeSelected = false; }
  if (code === 'Digit4') { if (rig.select('longshot')) grenadeSelected = false; }
  if (code === 'Digit5') {
    if (rig.state.grenades > 0) {
      grenadeSelected = true;
      hud.setWeapon(rig.state.current, rig.state.grenades);
    }
  }
  if (code === 'KeyG') {
    grenadeSelected = false;
    hud.setWeapon(rig.state.current, rig.state.grenades);
  }
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    hud.showBuy(false);
  } else if (!match.state.over && match.state.phase !== 'end') {
    hud.showOverlay(started ? 'paused' : 'start');
  }
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function runShot(name) {
  hud.hideOverlay();
  hud.showBuy(false);
  match.state.phase = 'live';
  match.state.phaseTime = 95;
  if (name === 'start') {
    player.teleport(-4, 11.5, Math.PI);
    settle(20);
    aimAt(new THREE.Vector3(0, 1.4, -6));
    hud.showOverlay('start');
    hud.setScore(0, 0, 1);
    hud.setMoney(800);
  } else if (name === 'buy') {
    match.state.phase = 'buy';
    match.state.phaseTime = 14;
    match.state.money = 2300;
    player.teleport(-4, 11.5, Math.PI);
    settle(20);
    aimAt(new THREE.Vector3(0, 1.4, -6));
    hud.setMoney(2300);
    hud.setOwned({ p9: true });
    hud.showBuy(true);
  } else if (name === 'play') {
    rig.buy('pike', 100000);
    rig.select('pike');
    // Stand just north of the mid container cross, so the sightline down the mid
    // lane is clear of it and the Wardens read against the north wall, not the
    // teal containers they would blend into.
    player.teleport(3, 3.5, 0);
    const wardens = bots.list.filter((b) => b.team === 'warden');
    wardens[0].mover.teleport(-3, -7, 0);
    wardens[1].mover.teleport(2.5, -6, 0);
    wardens[2].mover.teleport(0, -8, 0);
    const van = bots.list.filter((b) => b.team === 'vanguard');
    van[0].mover.teleport(-4, 9, Math.PI);
    settle(15);
    aimAt(new THREE.Vector3(-3, 1.3, -7));
    shootPlayer();
    settle(6);
    aimAt(new THREE.Vector3(2.5, 1.3, -6));
    shootPlayer();
    // Final shot right before the capture: the muzzle flash (0.09 s) and the
    // tracer (0.18 s) are still lit when the frame is painted, instead of
    // having expired during a long settle.
    settle(2);
    hud.clearBanner();
    // The hitmarker from that shot stays on for the capture (it auto-hides after 120 ms).
  } else if (name === 'end') {
    match.state.score.vanguard = 1;
    match.state.score.warden = 0;
    match.state.phase = 'end';
    const wardens = bots.list.filter((b) => b.team === 'warden');
    wardens[0].mover.teleport(-12, -4, 0);
    wardens[0].hp = 0;
    wardens[0].alive = false;
    wardens[0].state = 'dead';
    wardens[0].fallT = 1;
    wardens[0].mesh.rotation.x = -Math.PI / 2;
    wardens[0].mesh.position.set(-12, 0.15, -4);
    // Stand south-east of Site A looking in: the site containers, hazard
    // decals and the lamp glow read around the overlay, and the fallen
    // Warden lies in the sightline instead of behind the west wall.
    player.teleport(-10, 2, Math.PI * 0.85);
    settle(10);
    aimAt(new THREE.Vector3(-14, 1.5, -9));
    hud.setScore(1, 0, 1);
    hud.showOverlay('end', { title: 'VANGUARD WINS THE ROUND', sub: 'Wardens eliminated — Site A is ours', matchOver: false });
  }
  hud.setAmmo(rig.state.ammo[rig.state.current].mag, rig.state.ammo[rig.state.current].reserve, false);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

hud.setHealth(100, 100);
hud.setScore(0, 0, 1);
hud.setMoney(match.state.money);
hud.setOwned({ p9: true });
hud.setWeapon('p9', 0);
hud.setAlive(5, 5);
rig.show();
syncCamera();
match.startRound();
// Debug/testing hook: read-only handles for automated play-tests.
window.__sable = {
  player, playerActor, match, bots, rig, world, camera, step, renderer, scene, audio, hud, buyItem,
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return { x: v.x, y: v.y, z: v.z };
  },
};
if (shot) runShot(shot);
else requestAnimationFrame(frame);
