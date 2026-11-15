// SABLE YARD: a 40 x 28 m freight yard at dusk. Vanguard spawns south, Wardens north.
// Site A (Foundry) sits north-west, Site B (Silos) north-east; three lanes join them:
// west lane, mid, east lane. Every gameplay box is a collider and a bullet stop.
// The module also owns the waypoint graph bots walk and the line-of-sight test
// they fight with.
//
// Visual layer: every surface is a procedural canvas texture (see textures.js),
// the yard has a gradient dusk sky, a skyline silhouette, lamp posts with warm
// light pools, stacked containers, pipes, sandbags, fences, wires and signage.
// NOTHING in the visual layer moves a collider: gameplay boxes keep the exact
// positions and sizes of round 1, and visual-only props are never colliders.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import {
  containerTexture, concreteTexture, crateTexture, barrelTexture,
  hazardTexture, letterTexture, signTexture, skyTexture, glowTexture,
  cloudTexture, fenceTexture, tireTexture,
} from './textures.js';

const MAP_W = 40;
const MAP_D = 28;

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  // --- Procedural textures, painted once at boot. ---
  const texContainer = {
    containerTeal: containerTexture('#2a8a84', 'SABLE 042', 11),
    containerRust: containerTexture('#a05c30', 'FOUNDRY 17', 12),
    containerOlive: containerTexture('#5a6b3f', 'YARD 09', 13),
    containerSlate: containerTexture('#3a5a7a', 'SILOS 23', 14),
  };
  const texFloor = concreteTexture('#6b5b45', 23);
  texFloor.repeat.set(8, 6);
  const texLane = concreteTexture('#4a3d2c', 27);
  texLane.repeat.set(2, 6);
  const texWall = concreteTexture('#6e5f4e', 29);
  const texCrate = crateTexture('#7d5f38', 37);
  const texBarrelA = barrelTexture('#6d775e', 'DIESEL', 41);
  const texBarrelB = barrelTexture('#8a5a2e', 'OIL 10W', 43);
  const texHazard = hazardTexture();
  texHazard.repeat.set(6, 1);
  const texFence = fenceTexture();
  texFence.repeat.set(4, 2);
  const texGlow = glowTexture();

  const plain = {};
  for (const name of Object.keys(PALETTE)) {
    plain[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.5 : 0.92,
      metalness: 0.03,
    });
  }
  const siteAMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.siteA), transparent: true, opacity: 0.55, side: THREE.DoubleSide });
  const siteBMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.siteB), transparent: true, opacity: 0.55, side: THREE.DoubleSide });

  // A cloned texture keeps its own repeat: the same corrugated steel can tile
  // every 2.6 m on a long container and every 1.1 m on a crate.
  function tiled(tex, rx, ry, roughness = 0.85, metalness = 0.18) {
    const t = tex.clone();
    t.needsUpdate = true;
    t.repeat.set(rx, ry);
    return new THREE.MeshStandardMaterial({ map: t, roughness, metalness });
  }

  // Material per gameplay box, sized to the box so the texture scale reads the
  // same everywhere. The floor slab keeps a plain dark material: its visible
  // top is a separate textured plane (a box top would squash the repeat).
  function materialFor(name, w, h, d) {
    if (texContainer[name]) return tiled(texContainer[name], Math.max(w, d) / 2.6, h / 2.6, 0.72, 0.35);
    if (name === 'crate') return tiled(texCrate, Math.max(w, d) / 1.1, h / 1.1, 0.9, 0.02);
    if (name === 'wall') return tiled(texWall, Math.max(w, d) / 4, h / 4, 0.95, 0.02);
    if (name === 'barrel') return tiled(texBarrelA, 2, h / 1.1, 0.6, 0.4);
    return plain[name] ?? plain.wall;
  }

  const colliders = [];
  const shootables = [];
  const raycaster = new THREE.Raycaster();
  const rayDir = new THREE.Vector3();
  const rayFrom = new THREE.Vector3();

  // collide=false is for flat ground decor (the lane strips): they sit 6 cm proud
  // of the floor, which is exactly the height the mover's probe cannot step over,
  // so making them colliders would pin every bot and the player to the spot.
  function box(width, height, depth, x, y, z, material, shootable = true, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materialFor(material, width, height, depth));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) colliders.push(new THREE.Box3().setFromObject(mesh));
    if (shootable) shootables.push(mesh);
    return mesh;
  }

  function cylinder(radius, height, x, z, material) {
    const mat = material === 'barrel'
      ? tiled(texBarrelB, 2, height / 1.1, 0.6, 0.4)
      : materialFor(material, radius * 2, height, radius * 2);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 16), mat);
    mesh.position.set(x, height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Visual-only box: never a collider (it cannot block movement or bot paths),
  // shootable only when it is big enough that a bullet should stop in it.
  function vbox(width, height, depth, x, y, z, material, shootable = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materialFor(material, width, height, depth));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (shootable) shootables.push(mesh);
    return mesh;
  }

  // --- Sky: gradient dome, low sun, drifting clouds, skyline silhouettes. ---
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(120, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false }),
  );
  scene.add(sky);
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texGlow, color: new THREE.Color('#ffd9a0'), transparent: true, opacity: 0.95, fog: false, depthWrite: false,
  }));
  sunSprite.scale.set(30, 30, 1);
  sunSprite.position.set(-78, 20, 16);
  scene.add(sunSprite);
  const clouds = [];
  {
    const random = mulberry32(77);
    const cloudTex = cloudTexture(31);
    for (let i = 0; i < 6; i += 1) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: cloudTex, transparent: true, opacity: 0.38 + random() * 0.2, fog: false, depthWrite: false,
      }));
      const s = 26 + random() * 22;
      sprite.scale.set(s, s * 0.42, 1);
      sprite.position.set(-70 + random() * 140, 26 + random() * 12, -55 - random() * 30);
      scene.add(sprite);
      clouds.push(sprite);
    }
  }
  // Distant skyline: dark boxes and two cranes outside the walls, fog-free so
  // they read as silhouettes against the dusk sky.
  {
    const random = mulberry32(55);
    const silMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#241c33'), fog: false });
    const spots = [];
    for (let i = 0; i < 9; i += 1) spots.push([-34 + i * 8 + random() * 3, -24 - random() * 6]);
    for (let i = 0; i < 9; i += 1) spots.push([-34 + i * 8 + random() * 3, 24 + random() * 6]);
    for (let i = 0; i < 5; i += 1) spots.push([-30 - random() * 4, -16 + i * 8]);
    for (let i = 0; i < 5; i += 1) spots.push([30 + random() * 4, -16 + i * 8]);
    for (const [x, z] of spots) {
      const w = 4 + random() * 4;
      const h = 6 + random() * 13;
      const d = 4 + random() * 3;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), silMat);
      b.position.set(x, h / 2 - 0.5, z);
      scene.add(b);
      // A few lit windows.
      if (random() > 0.5) {
        const winMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb347'), fog: false });
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.9), winMat);
        win.position.set(x + (x > 0 ? -w / 2 - 0.05 : w / 2 + 0.05), h * (0.4 + random() * 0.4), z);
        win.rotation.y = x > 0 ? -Math.PI / 2 : Math.PI / 2;
        scene.add(win);
      }
    }
    // Two tower cranes on the skyline.
    for (const [x, z, rot] of [[-26, -26, 0.4], [28, 26, -0.7]]) {
      const mast = new THREE.Mesh(new THREE.BoxGeometry(0.9, 20, 0.9), silMat);
      mast.position.set(x, 9.5, z);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(12, 0.7, 0.7), silMat);
      arm.position.set(x, 19, z);
      arm.rotation.y = rot;
      const cable = new THREE.Mesh(new THREE.BoxGeometry(0.15, 5, 0.15), silMat);
      cable.position.set(x + Math.cos(rot) * 5, 16.5, z - Math.sin(rot) * 5);
      scene.add(mast, arm, cable);
    }
  }

  // --- Floor: textured concrete plane over the gameplay slab. ---
  box(MAP_W + 0.8, 0.4, MAP_D + 0.8, 0, -0.2, 0, 'floor');
  const floorPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_W + 0.8, MAP_D + 0.8),
    new THREE.MeshStandardMaterial({ map: texFloor, roughness: 0.94, metalness: 0.02 }),
  );
  floorPlane.rotation.x = -Math.PI / 2;
  floorPlane.position.y = 0.005;
  floorPlane.receiveShadow = true;
  group.add(floorPlane);
  // Lane strips: darker concrete, same layout as round 1.
  const laneMat = new THREE.MeshStandardMaterial({ map: texLane, roughness: 0.95, metalness: 0.02 });
  for (const x of [-12, 0, 12]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(5, MAP_D), laneMat);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(x, 0.012, 0);
    strip.receiveShadow = true;
    group.add(strip);
  }
  {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W, 5), laneMat);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(0, 0.012, -8.5);
    strip.receiveShadow = true;
    group.add(strip);
  }
  // Painted centre dashes down the mid lane.
  {
    const dashMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#d8c25a'), transparent: true, opacity: 0.5 });
    for (let z = -12; z <= 12; z += 3) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 1.4), dashMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(0, 0.02, z);
      group.add(dash);
    }
  }
  // Tire-mark decals + puddle sheen: flat ground dressing, visual only, off
  // the lane centres so bots never read them as cover.
  {
    const tireSpots = [[-6, 5.5, 0.4, 61], [7, -3.5, -0.3, 63], [-13, 3.5, 1.2, 67], [10, 8, 2.4, 71]];
    for (const [x, z, rot, seed] of tireSpots) {
      const decal = new THREE.Mesh(
        new THREE.PlaneGeometry(4.2, 2.1),
        new THREE.MeshBasicMaterial({ map: tireTexture(seed), transparent: true, opacity: 0.75, depthWrite: false }),
      );
      decal.rotation.x = -Math.PI / 2;
      decal.rotation.z = rot;
      decal.position.set(x, 0.02, z);
      group.add(decal);
    }
    // Puddles: low-roughness discs that catch the warm lamps and the cool sky,
    // so the ground has wet sheen next to the dry concrete.
    const puddleMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#46586a'), roughness: 0.12, metalness: 0.35, transparent: true, opacity: 0.82,
    });
    for (const [x, z, rx, rz] of [[-3.5, -4.5, 1.5, 1.0], [9, 4.5, 1.1, 1.7], [-15, 5, 1.3, 0.9]]) {
      const puddle = new THREE.Mesh(new THREE.CircleGeometry(1, 24), puddleMat);
      puddle.rotation.x = -Math.PI / 2;
      puddle.scale.set(rx, rz, 1);
      puddle.position.set(x, 0.018, z);
      puddle.receiveShadow = true;
      group.add(puddle);
    }
  }

  // Perimeter walls, 4.5 m.
  box(0.5, 4.5, MAP_D + 0.8, -MAP_W / 2 - 0.25, 2.25, 0, 'wall');
  box(0.5, 4.5, MAP_D + 0.8, MAP_W / 2 + 0.25, 2.25, 0, 'wall');
  box(MAP_W + 0.8, 4.5, 0.5, 0, 2.25, -MAP_D / 2 - 0.25, 'wall');
  box(MAP_W + 0.8, 4.5, 0.5, 0, 2.25, MAP_D / 2 + 0.25, 'wall');

  // Mid: a container cross that splits the lane and gives the centre its cover.
  box(6.4, 2.6, 1.4, 0, 1.3, -0.6, 'containerTeal');
  box(1.4, 2.6, 6.4, 0, 1.3, 0.6, 'containerRust');
  box(2.2, 1.1, 2.2, -5.4, 0.55, 2.4, 'crate');
  box(2.2, 1.1, 2.2, 5.4, 0.55, 2.4, 'crate');
  // Stacked second container on the cross (above head height: visual only).
  vbox(6.4, 2.6, 1.4, 0, 3.9, -0.6, 'containerOlive');

  // West lane: crates to crouch behind, a tall wall to cut the sightline.
  box(1.4, 3.1, 5.2, -8.2, 1.55, -4.5, 'wall');
  box(2.4, 1.1, 1.2, -13.5, 0.55, 1.5, 'crate');
  box(1.2, 1.1, 2.4, -15.5, 0.55, -5.5, 'crate');
  box(3.2, 2.6, 1.4, -11.5, 1.3, 7.5, 'containerRust');
  vbox(3.2, 2.6, 1.4, -11.5, 3.9, 7.5, 'containerSlate');

  // East lane: mirrored cover, different rhythm so the lanes play differently.
  box(1.4, 3.1, 5.2, 8.2, 1.55, -4.5, 'wall');
  box(2.4, 1.1, 1.2, 13.5, 0.55, 1.5, 'crate');
  box(1.2, 1.1, 2.4, 15.5, 0.55, -5.5, 'crate');
  box(3.2, 2.6, 1.4, 11.5, 1.3, 7.5, 'containerTeal');
  vbox(3.2, 2.6, 1.4, 11.5, 3.9, 7.5, 'containerOlive');

  // Site A (Foundry, north-west): container wall on the north, crates inside the zone.
  box(6.4, 2.6, 1.4, -14.5, 1.3, -11.5, 'containerTeal');
  box(2.2, 1.1, 2.2, -16.5, 0.55, -7.5, 'crate');
  box(2.2, 1.1, 2.2, -11.5, 0.55, -8.5, 'crate');
  cylinder(0.55, 1.1, -13, -6.5, 'barrel');
  cylinder(0.55, 1.1, -12, -6.8, 'barrel');
  vbox(6.4, 2.6, 1.4, -14.5, 3.9, -11.5, 'containerRust');

  // Site B (Silos, north-east): two silo drums and a crate ring.
  cylinder(1.5, 4.2, 16.5, -11.5, 'containerRust');
  cylinder(1.5, 4.2, 13.2, -12.2, 'containerTeal');
  box(2.2, 1.1, 2.2, 16.5, 0.55, -7.5, 'crate');
  box(2.2, 1.1, 2.2, 11.5, 0.55, -8.5, 'crate');
  // Silo caps + connecting pipe (visual only).
  for (const [x, z] of [[16.5, -11.5], [13.2, -12.2]]) {
    const cap = new THREE.Mesh(
      new THREE.ConeGeometry(1.55, 0.9, 16),
      new THREE.MeshStandardMaterial({ color: new THREE.Color('#4d4238'), roughness: 0.6, metalness: 0.5 }),
    );
    cap.position.set(x, 4.65, z);
    cap.castShadow = true;
    group.add(cap);
  }
  {
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 4.4, 10),
      new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a3230'), roughness: 0.5, metalness: 0.6 }),
    );
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(14.85, 3.6, -11.85);
    pipe.castShadow = true;
    group.add(pipe);
  }

  // South spawn cover for the attackers.
  box(2.4, 1.1, 1.2, -6, 0.55, 10.5, 'crate');
  box(2.4, 1.1, 1.2, 6, 0.55, 10.5, 'crate');
  box(1.4, 2.6, 3.2, 0, 1.3, 12, 'containerRust');
  vbox(1.4, 2.6, 3.2, 0, 3.9, 12, 'containerTeal');

  // --- Extra barrels, sandbags, pipes, fences (visual only, off the bot routes). ---
  const sandMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#8a7a5c'), roughness: 1, metalness: 0 });
  function sandbags(cx, cz, alongX) {
    for (let r = 0; r < 2; r += 1) {
      for (let i = 0; i < 5; i += 1) {
        const bag = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.26, 0.38), sandMat);
        bag.position.set(
          cx + (alongX ? (i - 2) * 0.55 : (r - 0.5) * 0.3),
          0.13 + r * 0.26,
          cz + (alongX ? (r - 0.5) * 0.3 : (i - 2) * 0.55),
        );
        bag.rotation.y = (mulberry32(3 + i + r)() - 0.5) * 0.3;
        bag.castShadow = true;
        bag.receiveShadow = true;
        group.add(bag);
      }
    }
  }
  sandbags(-18.2, -6.5, false);
  sandbags(18.2, -6.5, false);
  sandbags(5.5, 6.8, true);
  cylinder(0.55, 1.1, 18.6, 2.5, 'barrel');
  cylinder(0.55, 1.1, -18.6, 2.5, 'barrel');
  // Pipes high on the north wall + a down-pipe at each end.
  {
    const pipeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a3230'), roughness: 0.5, metalness: 0.6 });
    const run = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 38, 10), pipeMat);
    run.rotation.z = Math.PI / 2;
    run.position.set(0, 3.4, -13.85);
    run.castShadow = true;
    group.add(run);
    const run2 = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 38, 10), pipeMat);
    run2.rotation.z = Math.PI / 2;
    run2.position.set(0, 3.05, -13.85);
    group.add(run2);
    for (const x of [-19.5, 19.5]) {
      const down = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4.2, 10), pipeMat);
      down.position.set(x, 2.1, -13.85);
      group.add(down);
    }
  }
  // Chain-link fences flanking the south spawn.
  {
    const fenceMat = new THREE.MeshStandardMaterial({
      map: texFence, transparent: true, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6, depthWrite: false,
    });
    for (const x of [-10, 10]) {
      const fence = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.2), fenceMat);
      fence.position.set(x, 1.1, 12.8);
      fence.rotation.y = Math.PI;
      group.add(fence);
      for (const dx of [-2, 2]) {
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.05, 2.3, 8),
          new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a3230'), roughness: 0.5, metalness: 0.6 }),
        );
        post.position.set(x + dx, 1.15, 12.8);
        group.add(post);
      }
    }
  }

  // --- Lamp posts: warm light, glow pool, hanging wires between them. ---
  const lampHeads = [];
  {
    const poleMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2e2a26'), roughness: 0.5, metalness: 0.6 });
    const headMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#ffd9a0'), emissive: new THREE.Color('#ffb347'), emissiveIntensity: 2.2, roughness: 0.4,
    });
    const poolMat = new THREE.MeshBasicMaterial({
      map: texGlow, transparent: true, opacity: 0.62, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const lampSpots = [[-18, 8], [18, 8], [-18, -12], [18, -12]];
    const tops = [];
    for (const [x, z] of lampSpots) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.4, 10), poleMat);
      pole.position.set(x, 2.2, z);
      pole.castShadow = true;
      group.add(pole);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.09, 0.09), poleMat);
      arm.position.set(x + (x > 0 ? -0.5 : 0.5), 4.35, z);
      group.add(arm);
      const headX = x + (x > 0 ? -1.0 : 1.0);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.24), headMat);
      head.position.set(headX, 4.3, z);
      group.add(head);
      lampHeads.push(head);
      const light = new THREE.PointLight(new THREE.Color('#ffb347'), 26, 17, 2);
      light.position.set(headX, 4.1, z);
      scene.add(light);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), poolMat.clone());
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(headX, 0.02, z);
      group.add(pool);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texGlow, color: new THREE.Color('#ffbe6e'), transparent: true, opacity: 0.55, depthWrite: false,
      }));
      halo.scale.set(2.2, 2.2, 1);
      halo.position.set(headX, 4.3, z);
      scene.add(halo);
      tops.push(new THREE.Vector3(headX, 4.3, z));
    }
    // Sagging wires between neighbouring lamp tops.
    const wireMat = new THREE.LineBasicMaterial({ color: new THREE.Color('#1c1712') });
    const pairs = [[0, 1], [0, 2], [1, 3]];
    for (const [a, b] of pairs) {
      const pts = [];
      for (let i = 0; i <= 12; i += 1) {
        const t = i / 12;
        const p = new THREE.Vector3().lerpVectors(tops[a], tops[b], t);
        p.y -= Math.sin(t * Math.PI) * 0.7;
        pts.push(p);
      }
      const wire = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireMat);
      scene.add(wire);
    }
  }

  // --- Signage. ---
  function sign(text, sub, w, h, x, y, z, rotY, bg = '#241d18') {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ map: signTexture(text, sub, '#f2e9d8', bg), roughness: 0.85, metalness: 0.05 }),
    );
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    group.add(mesh);
    return mesh;
  }
  sign('FOUNDRY', 'SITE A — PLANT HERE', 6, 2.25, -14, 3.1, -13.9, 0);
  sign('SILOS', 'SITE B — PLANT HERE', 6, 2.25, 14, 3.1, -13.9, 0);
  sign('SABLE YARD', 'FREIGHT TERMINAL 07', 8, 3, 0, 3.3, 13.9, Math.PI);

  // --- Site decals: painted letters + hazard borders on the ground. ---
  function siteDecal(letter, x, z, color) {
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 4.6),
      new THREE.MeshBasicMaterial({ map: letterTexture(letter, color), transparent: true, opacity: 0.9, depthWrite: false }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(x, 0.045, z);
    group.add(decal);
    const hazMat = new THREE.MeshBasicMaterial({ map: texHazard, transparent: true, opacity: 0.85, depthWrite: false });
    const half = 3.4;
    for (const [px, pz, w, d, ry] of [
      [x, z - half, 7.4, 0.55, 0], [x, z + half, 7.4, 0.55, 0],
      [x - half, z, 7.4, 0.55, Math.PI / 2], [x + half, z, 7.4, 0.55, Math.PI / 2],
    ]) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, d), hazMat);
      strip.rotation.x = -Math.PI / 2;
      strip.rotation.z = ry;
      strip.position.set(px, 0.04, pz);
      group.add(strip);
    }
  }
  siteDecal('A', -14, -9, '#f5a623');
  siteDecal('B', 14, -9, '#2ec4b6');

  // Site markers: glowing ground rings with a floating letter, visible across the yard.
  function siteMarker(letter, x, z, material) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.1, 40), material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.06, z);
    group.add(ring);
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const g = canvas.getContext('2d');
    g.fillStyle = '#f2e9d8';
    g.font = 'bold 84px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter, 64, 68);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sprite.scale.set(2.4, 2.4, 1);
    sprite.position.set(x, 3.4, z);
    group.add(sprite);
    return { ring, sprite };
  }
  const markerA = siteMarker('A', -14, -9, siteAMaterial);
  const markerB = siteMarker('B', 14, -9, siteBMaterial);

  // Light: low amber sun from the west, cool fill from the east, dusk sky gradient.
  // Warm lamp pools against the cool fill give the yard its depth; a faint
  // cool rim from the north catches bot silhouettes from behind.
  const skyLight = new THREE.HemisphereLight(new THREE.Color('#9a7a66'), new THREE.Color('#2b2118'), 1.2);
  scene.add(skyLight);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb347'), 3.6);
  sun.position.set(-22, 10, 8);
  sun.target.position.set(0, 0, -2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#7fb5b0'), 1.0);
  fill.position.set(14, 9, 12);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(new THREE.Color('#8fa8ff'), 0.55);
  rim.position.set(0, 6, -20);
  scene.add(rim);

  // Waypoint graph: nodes bots walk, routes per site, hold points per site.
  const nodes = {
    spawnS: { x: 0, z: 11 },
    spawnSW: { x: -9, z: 10 },
    spawnSE: { x: 9, z: 10 },
    westMid: { x: -12, z: 4 },
    westLow: { x: -12, z: -2 },
    westSite: { x: -14, z: -7 },
    eastMid: { x: 12, z: 4 },
    eastLow: { x: 12, z: -2 },
    eastSite: { x: 14, z: -7 },
    midSouth: { x: 0, z: 6 },
    midNorth: { x: 0, z: -5 },
    connectorW: { x: -6, z: -6 },
    connectorE: { x: 6, z: -6 },
    northMid: { x: 0, z: -11 },
    siteAHold: { x: -16.5, z: -9.5 },
    siteBHold: { x: 16.5, z: -9.5 },
  };
  const routes = {
    A: ['spawnSW', 'westMid', 'westLow', 'westSite'],
    B: ['spawnSE', 'eastMid', 'eastLow', 'eastSite'],
    mid: ['spawnS', 'midSouth', 'midNorth', 'northMid'],
    Aalt: ['spawnS', 'midSouth', 'connectorW', 'westSite'],
    Balt: ['spawnS', 'midSouth', 'connectorE', 'eastSite'],
  };
  const holds = {
    A: ['siteAHold', 'westLow', 'connectorW'],
    B: ['siteBHold', 'eastLow', 'connectorE'],
    mid: ['midNorth', 'connectorW', 'connectorE'],
    north: ['northMid', 'siteAHold', 'siteBHold'],
  };

  return {
    colliders,
    shootables,
    group,
    sites: [
      { id: 'A', name: 'Foundry', x: -14, z: -9, radius: 3.6, marker: markerA },
      { id: 'B', name: 'Silos', x: 14, z: -9, radius: 3.6, marker: markerB },
    ],
    spawns: {
      vanguard: [
        { x: -4, z: 12 }, { x: -1.5, z: 12.5 }, { x: 1.5, z: 12.5 }, { x: 4, z: 12 }, { x: 0, z: 10.5 },
      ],
      warden: [
        { x: -14, z: -11 }, { x: -6, z: -12 }, { x: 0, z: -12 }, { x: 6, z: -12 }, { x: 14, z: -11 },
      ],
    },
    nodes,
    routes,
    holds,
    bounds: { x: MAP_W / 2, z: MAP_D / 2 },
    // Clouds drift slowly; lamp heads flicker almost imperceptibly.
    update(dt) {
      for (const c of clouds) {
        c.position.x += dt * 0.35;
        if (c.position.x > 80) c.position.x = -80;
      }
    },
    hasLineOfSight(a, b) {
      rayDir.set(b.x - a.x, b.y - a.y, b.z - a.z);
      const dist = rayDir.length();
      if (dist < 0.01) return true;
      rayDir.multiplyScalar(1 / dist);
      rayFrom.set(a.x, a.y, a.z);
      raycaster.set(rayFrom, rayDir);
      raycaster.far = dist;
      return raycaster.intersectObjects(shootables, false).length === 0;
    },
  };
}
