// Weapons: four guns and a grenade, each with its own numbers, view model and feel.
// Accuracy is a resource: spread grows with movement speed, with sustained fire and
// with firing while airborne, and shrinks when crouched or aiming down sights. The
// rig owns ammo, reloads and the view models; main.js owns the ray and the damage.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  p9: {
    id: 'p9', name: 'Picket P9', kind: 'pistol', price: 0,
    damage: 26, headMult: 2.5, mag: 12, reserve: 48, auto: false,
    gap: 0.16, reload: 1.15, spreadStill: 0.004, spreadMove: 0.02, range: 60, kick: 0.006,
  },
  scatter: {
    id: 'scatter', name: 'Broom-12', kind: 'shotgun', price: 700,
    damage: 9, pellets: 8, headMult: 2, mag: 6, reserve: 24, auto: false,
    gap: 0.85, reload: 2.3, spreadStill: 0.045, spreadMove: 0.06, range: 26, kick: 0.028,
  },
  pike: {
    id: 'pike', name: 'Pike AR', kind: 'rifle', price: 1400,
    damage: 30, headMult: 2.5, mag: 30, reserve: 90, auto: true,
    gap: 0.1, reload: 1.9, spreadStill: 0.0022, spreadMove: 0.028, range: 80, kick: 0.009,
  },
  longshot: {
    id: 'longshot', name: 'Needle DMR', kind: 'dmr', price: 2000,
    damage: 85, headMult: 2.5, mag: 5, reserve: 20, auto: false,
    gap: 0.95, reload: 2.6, spreadStill: 0.0008, spreadMove: 0.05, range: 120, kick: 0.02,
  },
};

export const GRENADE = { id: 'spark', name: 'Spark grenade', price: 300, fuse: 1.8, radius: 7, maxDamage: 120 };
export const VEST = { id: 'vest', name: 'Plated vest', price: 400, bonusHp: 25 };

const ORDER = ['p9', 'scatter', 'pike', 'longshot'];

export function createWeaponRig(camera, audio) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#211a15'), roughness: 0.55, metalness: 0.3 });
  const steel = new THREE.MeshStandardMaterial({ color: new THREE.Color('#6b6259'), roughness: 0.45, metalness: 0.4 });

  function part(w, h, d, x, y, z, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    return mesh;
  }

  // One view model per gun, all built from boxes, each with its own silhouette.
  const models = {};
  const p9 = new THREE.Group();
  p9.add(part(0.07, 0.09, 0.3, 0, 0, -0.1, steel));
  p9.add(part(0.06, 0.12, 0.08, 0, -0.08, 0.05, grip));
  models.p9 = p9;
  const scatter = new THREE.Group();
  scatter.add(part(0.09, 0.1, 0.5, 0, 0, -0.15, dark));
  scatter.add(part(0.07, 0.07, 0.42, 0, -0.045, -0.2, steel));
  scatter.add(part(0.07, 0.09, 0.2, 0, -0.02, 0.28, grip));
  models.scatter = scatter;
  const pike = new THREE.Group();
  pike.add(part(0.09, 0.1, 0.42, 0, 0, -0.08, steel));
  pike.add(part(0.045, 0.045, 0.4, 0, 0.025, -0.44, grip));
  pike.add(part(0.075, 0.08, 0.22, 0, -0.02, 0.28, grip));
  pike.add(part(0.05, 0.06, 0.12, 0, 0.07, -0.12, dark));
  models.pike = pike;
  const longshot = new THREE.Group();
  longshot.add(part(0.08, 0.09, 0.55, 0, 0, -0.15, dark));
  longshot.add(part(0.04, 0.04, 0.5, 0, 0.02, -0.5, steel));
  longshot.add(part(0.06, 0.05, 0.14, 0, 0.07, -0.1, steel));
  longshot.add(part(0.07, 0.09, 0.2, 0, -0.02, 0.3, grip));
  models.longshot = longshot;
  for (const id of ORDER) {
    models[id].position.set(0.3, -0.25, -0.55);
    models[id].scale.setScalar(0.78);
    models[id].visible = false;
    camera.add(models[id]);
  }

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.muzzle), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.3, -0.22, -1.0);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.muzzle), 0, 5);
  flashLight.position.set(0.3, -0.21, -0.7);
  camera.add(flashLight);

  const state = {
    current: 'p9',
    owned: { p9: true },
    ammo: {},
    grenades: 0,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    heat: 0,
    bobPhase: 0,
  };
  for (const id of ORDER) state.ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };

  function def() {
    return WEAPONS[state.current];
  }

  function step(dt, moving) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.heat = Math.max(0, state.heat - dt * 1.6);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[state.current];
    state.bobPhase += dt * (2 + moving * 1.6);
    const bob = moving > 0.5 ? Math.sin(state.bobPhase * 2) * 0.006 : 0;
    model.position.set(0.3 + bob, -0.25 + Math.abs(Math.cos(state.bobPhase)) * (moving > 0.5 ? 0.008 : 0), -0.55 + state.kick);
    model.rotation.x = state.kick * 1.4;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (def().reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const ammo = state.ammo[state.current];
        const need = def().mag - ammo.mag;
        const take = Math.min(need, ammo.reserve);
        ammo.mag += take;
        ammo.reserve -= take;
      }
    }
  }

  return {
    state,
    def,
    step,
    ready() {
      return state.ammo[state.current].mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    hasAmmo() {
      return state.ammo[state.current].mag > 0;
    },
    pullTrigger() {
      state.cooldown = def().gap;
      state.flash = 0.06;
      state.kick = 0.055;
      state.heat = Math.min(1, state.heat + (def().kind === 'rifle' ? 0.14 : 0.08));
      audio.shot(def().kind);
    },
    takeRound() {
      const ammo = state.ammo[state.current];
      if (ammo.mag <= 0) return false;
      ammo.mag -= 1;
      return true;
    },
    reload() {
      const ammo = state.ammo[state.current];
      if (state.reloadLeft > 0 || ammo.mag === def().mag || ammo.reserve === 0) return false;
      state.reloadLeft = def().reload;
      audio.reload();
      return true;
    },
    // Spread in radians: still < moving < airborne, crouch and ADS shrink it, heat grows it.
    spread(speed, opts = {}) {
      const d = def();
      const moveFrac = Math.min(1, speed / 5.4);
      let spread = d.spreadStill + moveFrac * d.spreadMove;
      if (opts.airborne) spread += 0.02;
      if (opts.crouching) spread *= 0.6;
      if (opts.aiming) spread *= 0.45;
      return spread * (1 + state.heat * 0.9);
    },
    select(id) {
      if (!state.owned[id] || state.current === id) return false;
      state.current = id;
      state.reloadLeft = 0;
      state.cooldown = Math.max(state.cooldown, 0.25);
      for (const key of ORDER) models[key].visible = key === id;
      audio.click();
      return true;
    },
    buy(id, money) {
      const item = id === 'spark' ? GRENADE : id === 'vest' ? VEST : WEAPONS[id];
      if (!item) return null;
      if (id === 'spark' && state.grenades >= 2) return null;
      if (WEAPONS[id] && state.owned[id]) return null;
      if (money < item.price) return null;
      if (WEAPONS[id]) {
        state.owned[id] = true;
        state.ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
      } else if (id === 'spark') {
        state.grenades += 1;
      }
      audio.buy();
      return item.price;
    },
    refill() {
      for (const id of ORDER) state.ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
      state.grenades = 0;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.heat = 0;
    },
    resetToPistol() {
      state.owned = { p9: true };
      state.current = 'p9';
      for (const key of ORDER) models[key].visible = key === 'p9';
      this.refill();
    },
    show() {
      for (const key of ORDER) models[key].visible = key === state.current;
    },
    // Test helper: world position of the current view model's centre.
    modelPos() {
      const v = new THREE.Vector3();
      models[state.current].getWorldPosition(v);
      return v;
    },
  };
}
