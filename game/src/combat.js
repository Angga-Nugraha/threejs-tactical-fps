// Combat: hitscan shooting, tracers, impacts and grenades. One raycaster, pooled
// vectors and pooled tracer/impact meshes: nothing is allocated per shot. Damage is
// applied through callbacks owned by main.js, so this module never knows who has
// how much health; it only resolves the geometry of a shot.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { scorchTexture } from './textures.js';

const TRACER_POOL = 24;
const IMPACT_POOL = 12;
const SPARK_SHARDS = 5;
const DECAL_POOL = 8;
const GRENADE_GRAVITY = 12;

export function createCombat(scene, world) {
  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const hitPoint = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const noise = [];

  // Tracer pool: one line per shot, fading over 180 ms (was 120 ms — the old
  // tracer expired before a screenshot could catch it).
  const tracers = [];
  const tracerMat = new THREE.LineBasicMaterial({ color: new THREE.Color('#ffe9a8'), transparent: true, opacity: 1.0 });
  for (let i = 0; i < TRACER_POOL; i += 1) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, tracerMat.clone());
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIdx = 0;

  // Impact pool: small flashing octahedra at bullet strike points.
  const impacts = [];
  const impactMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.muzzle), transparent: true, opacity: 1.0 });
  for (let i = 0; i < IMPACT_POOL; i += 1) {
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.11), impactMat.clone());
    mesh.visible = false;
    scene.add(mesh);
    impacts.push({ mesh, life: 0 });
  }
  let impactIdx = 0;

  // Spark bursts: a few hot shards that fly out of the strike point and fall.
  const sparkGeo = new THREE.TetrahedronGeometry(0.05);
  const sparkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffcf7a'), transparent: true, opacity: 0.95 });
  const sparks = [];
  for (let i = 0; i < IMPACT_POOL; i += 1) {
    const shards = [];
    for (let s = 0; s < SPARK_SHARDS; s += 1) {
      const mesh = new THREE.Mesh(sparkGeo, sparkMat.clone());
      mesh.visible = false;
      scene.add(mesh);
      shards.push({ mesh, vel: new THREE.Vector3(), life: 0 });
    }
    sparks.push(shards);
  }

  // Decal pool: dark scorch marks left on the surface where bullets struck.
  const decalTex = scorchTexture();
  const decals = [];
  for (let i = 0; i < DECAL_POOL; i += 1) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.55, 0.55),
      new THREE.MeshBasicMaterial({ map: decalTex, transparent: true, opacity: 0, depthWrite: false }),
    );
    mesh.visible = false;
    scene.add(mesh);
    decals.push({ mesh, life: 0 });
  }
  let decalIdx = 0;
  const tmpNormal = new THREE.Vector3();

  const grenades = [];
  const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.beacon), roughness: 0.4, metalness: 0.5 });
  const blastMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb347'), transparent: true, opacity: 0.8, side: THREE.DoubleSide });

  function spawnTracer(from, to) {
    const t = tracers[tracerIdx];
    tracerIdx = (tracerIdx + 1) % TRACER_POOL;
    const pos = t.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    t.line.visible = true;
    t.life = 0.18;
    t.line.material.opacity = 1.0;
  }

  function spawnImpact(point, normal, random) {
    const slot = impactIdx;
    impactIdx = (impactIdx + 1) % IMPACT_POOL;
    const im = impacts[slot];
    im.mesh.position.copy(point);
    im.mesh.visible = true;
    im.mesh.scale.setScalar(1.4);
    im.life = 0.26;
    im.mesh.material.opacity = 1.0;
    // Spark burst from the same pool slot. Seeded `random` (the shooter's),
    // not Math.random: impact feedback stays deterministic like the rest of
    // the sim.
    for (const shard of sparks[slot]) {
      shard.mesh.position.copy(point);
      shard.vel.set(
        (random() * 2 - 1) * 3.0 + (normal ? normal.x * 1.5 : 0),
        random() * 3.2 + 0.8,
        (random() * 2 - 1) * 3.0 + (normal ? normal.z * 1.5 : 0),
      );
      shard.mesh.visible = true;
      shard.mesh.material.opacity = 0.95;
      shard.life = 0.32;
    }
    // Scorch decal on the struck surface.
    if (normal) {
      const d = decals[decalIdx];
      decalIdx = (decalIdx + 1) % DECAL_POOL;
      d.mesh.position.copy(point).addScaledVector(normal, 0.015);
      d.mesh.lookAt(tmp.copy(point).addScaledVector(normal, 1));
      d.mesh.visible = true;
      d.mesh.material.opacity = 0.85;
      d.life = 5;
    }
  }

  // Fire one trigger pull. shooter: {eye: Vector3, team, id, name}. def: a WEAPONS
  // entry. damage(target, dmg, part, shooter) is main.js's: it returns 'kill' when
  // the target died. shootables: world meshes plus bot hitboxes.
  function shoot(shooter, def, spread, random, shootables, damage) {
    const pellets = def.pellets ?? 1;
    let anyHit = false;
    let killed = null;
    for (let p = 0; p < pellets; p += 1) {
      origin.copy(shooter.eye);
      dir.copy(shooter.dir);
      dir.x += (random() * 2 - 1) * spread;
      dir.y += (random() * 2 - 1) * spread;
      dir.z += (random() * 2 - 1) * spread;
      dir.normalize();
      raycaster.set(origin, dir);
      raycaster.far = def.range;
      const hits = raycaster.intersectObjects(shootables, false);
      const end = hits.length > 0 ? hits[0].point : tmp.copy(origin).addScaledVector(dir, def.range);
      spawnTracer(origin, end);
      if (hits.length > 0) {
        const hit = hits[0];
        hitPoint.copy(hit.point);
        const userData = hit.object.userData || {};
        if (userData.actor && userData.actor.team !== shooter.team && userData.actor.alive) {
          const part = userData.part || 'body';
          const dmg = def.damage * (part === 'head' ? def.headMult : 1);
          const result = damage(userData.actor, dmg, part, shooter);
          if (result === 'kill') killed = userData.actor;
          anyHit = true;
        } else {
          tmpNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
          spawnImpact(hitPoint, tmpNormal, random);
        }
      }
    }
    noise.push({ x: shooter.eye.x, y: shooter.eye.y, z: shooter.eye.z, time: performance.now() / 1000 });
    if (noise.length > 24) noise.splice(0, noise.length - 24);
    return { hit: anyHit, killed };
  }

  function throwGrenade(from, dirVec, team, ownerId) {
    const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
    mesh.position.copy(from);
    mesh.castShadow = true;
    scene.add(mesh);
    grenades.push({
      mesh,
      vel: new THREE.Vector3(dirVec.x * 15, dirVec.y * 15 + 4.5, dirVec.z * 15),
      team,
      ownerId,
      fuse: 1.8,
    });
  }

  function step(dt, damageArea) {
    for (const t of tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.18) * 1.0;
        if (t.life <= 0) t.line.visible = false;
      }
    }
    for (const im of impacts) {
      if (im.life > 0) {
        im.life -= dt;
        im.mesh.scale.setScalar(Math.max(0.01, im.life / 0.26) * 1.4);
        im.mesh.material.opacity = Math.max(0, im.life / 0.26) * 1.0;
        if (im.life <= 0) im.mesh.visible = false;
      }
    }
    for (const shards of sparks) {
      for (const shard of shards) {
        if (shard.life > 0) {
          shard.life -= dt;
          shard.vel.y -= 9 * dt;
          shard.mesh.position.addScaledVector(shard.vel, dt);
          shard.mesh.rotation.x += dt * 9;
          shard.mesh.rotation.y += dt * 7;
          shard.mesh.material.opacity = Math.max(0, shard.life / 0.32) * 0.95;
          if (shard.life <= 0) shard.mesh.visible = false;
        }
      }
    }
    for (const d of decals) {
      if (d.life > 0) {
        d.life -= dt;
        d.mesh.material.opacity = 0.75 * (d.life / 5);
        if (d.life <= 0) d.mesh.visible = false;
      }
    }
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const g = grenades[i];
      g.fuse -= dt;
      g.vel.y -= GRENADE_GRAVITY * dt;
      const next = tmp.copy(g.mesh.position).addScaledVector(g.vel, dt);
      // Cheap bounce: if the next step lands inside a collider, reflect the
      // dominant axis and dampen; the fuse, not the bounce, ends the throw.
      let bounced = false;
      for (const c of world.colliders) {
        if (next.x > c.min.x - 0.09 && next.x < c.max.x + 0.09 && next.y > c.min.y - 0.09 && next.y < c.max.y + 0.09 && next.z > c.min.z - 0.09 && next.z < c.max.z + 0.09) {
          const dx = Math.min(Math.abs(next.x - c.min.x), Math.abs(next.x - c.max.x));
          const dz = Math.min(Math.abs(next.z - c.min.z), Math.abs(next.z - c.max.z));
          const dy = Math.min(Math.abs(next.y - c.min.y), Math.abs(next.y - c.max.y));
          if (dx <= dy && dx <= dz) g.vel.x *= -0.45;
          else if (dz <= dy) g.vel.z *= -0.45;
          else g.vel.y *= -0.45;
          bounced = true;
          break;
        }
      }
      if (!bounced) g.mesh.position.copy(next);
      if (g.mesh.position.y < 0.09) {
        g.mesh.position.y = 0.09;
        g.vel.y = Math.abs(g.vel.y) * 0.4;
        g.vel.x *= 0.7;
        g.vel.z *= 0.7;
      }
      if (g.fuse <= 0) {
        const pos = g.mesh.position.clone();
        const team = g.team;
        scene.remove(g.mesh);
        grenades.splice(i, 1);
        explode(pos, damageArea, team);
      }
    }
  }

  function explode(pos, damageArea, team) {
    const flash = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), blastMat.clone());
    flash.position.copy(pos);
    scene.add(flash);
    let life = 0.35;
    const light = new THREE.PointLight(new THREE.Color('#ffb347'), 60, 18);
    light.position.copy(pos);
    scene.add(light);
    const tick = () => {
      life -= 0.016;
      flash.scale.setScalar(Math.max(0.01, (0.35 - life) * 18));
      flash.material.opacity = Math.max(0, life / 0.35) * 0.8;
      light.intensity = Math.max(0, life / 0.35) * 60;
      if (life > 0) requestAnimationFrame(tick);
      else {
        scene.remove(flash);
        scene.remove(light);
        flash.geometry.dispose();
        flash.material.dispose();
      }
    };
    tick();
    noise.push({ x: pos.x, y: pos.y, z: pos.z, time: performance.now() / 1000 });
    if (damageArea) damageArea(pos, team);
  }

  return {
    shoot,
    throwGrenade,
    step,
    noise,
    clear() {
      for (const g of grenades) scene.remove(g.mesh);
      grenades.length = 0;
      for (const t of tracers) { t.life = 0; t.line.visible = false; }
      for (const im of impacts) { im.life = 0; im.mesh.visible = false; }
      for (const shards of sparks) for (const s of shards) { s.life = 0; s.mesh.visible = false; }
      for (const d of decals) { d.life = 0; d.mesh.visible = false; }
      noise.length = 0;
    },
  };
}
