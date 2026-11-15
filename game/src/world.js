// SABLE YARD: a 40 x 28 m freight yard at dusk. Vanguard spawns south, Wardens north.
// Site A (Foundry) sits north-west, Site B (Silos) north-east; three lanes join them:
// west lane, mid, east lane. Every box is a collider and a bullet stop. The module
// also owns the waypoint graph bots walk and the line-of-sight test they fight with.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const MAP_W = 40;
const MAP_D = 28;

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.5 : 0.92,
      metalness: 0.03,
    });
  }
  const siteAMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.siteA), transparent: true, opacity: 0.55, side: THREE.DoubleSide });
  const siteBMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.siteB), transparent: true, opacity: 0.55, side: THREE.DoubleSide });

  const colliders = [];
  const shootables = [];
  const raycaster = new THREE.Raycaster();
  const rayDir = new THREE.Vector3();
  const rayFrom = new THREE.Vector3();

  // collide=false is for flat ground decor (the lane strips): they sit 6 cm proud
  // of the floor, which is exactly the height the mover's probe cannot step over,
  // so making them colliders would pin every bot and the player to the spot.
  function box(width, height, depth, x, y, z, material, shootable = true, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) colliders.push(new THREE.Box3().setFromObject(mesh));
    if (shootable) shootables.push(mesh);
    return mesh;
  }

  function cylinder(radius, height, x, z, material) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 12), materials[material]);
    mesh.position.set(x, height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Floor: one slab, plus darker lane strips so the three lanes read at a glance.
  box(MAP_W + 0.8, 0.4, MAP_D + 0.8, 0, -0.2, 0, 'floor');
  box(5, 0.06, MAP_D, -12, 0.03, 0, 'lane', false, false);
  box(5, 0.06, MAP_D, 0, 0.03, 0, 'lane', false, false);
  box(5, 0.06, MAP_D, 12, 0.03, 0, 'lane', false, false);
  box(MAP_W, 0.06, 5, 0, 0.03, -8.5, 'lane', false, false);

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

  // West lane: crates to crouch behind, a tall wall to cut the sightline.
  box(1.4, 3.1, 5.2, -8.2, 1.55, -4.5, 'wall');
  box(2.4, 1.1, 1.2, -13.5, 0.55, 1.5, 'crate');
  box(1.2, 1.1, 2.4, -15.5, 0.55, -5.5, 'crate');
  box(3.2, 2.6, 1.4, -11.5, 1.3, 7.5, 'containerRust');

  // East lane: mirrored cover, different rhythm so the lanes play differently.
  box(1.4, 3.1, 5.2, 8.2, 1.55, -4.5, 'wall');
  box(1.2, 1.1, 2.4, 15.5, 0.55, -5.5, 'crate');
  box(2.4, 1.1, 1.2, 13.5, 0.55, 1.5, 'crate');
  box(3.2, 2.6, 1.4, 11.5, 1.3, 7.5, 'containerTeal');

  // Site A (Foundry, north-west): container wall on the north, crates inside the zone.
  box(6.4, 2.6, 1.4, -14.5, 1.3, -11.5, 'containerTeal');
  box(2.2, 1.1, 2.2, -16.5, 0.55, -7.5, 'crate');
  box(2.2, 1.1, 2.2, -11.5, 0.55, -8.5, 'crate');
  cylinder(0.55, 1.1, -13, -6.5, 'barrel');
  cylinder(0.55, 1.1, -12, -6.8, 'barrel');

  // Site B (Silos, north-east): two silo drums and a crate ring.
  cylinder(1.5, 4.2, 16.5, -11.5, 'containerRust');
  cylinder(1.5, 4.2, 13.2, -12.2, 'containerTeal');
  box(2.2, 1.1, 2.2, 16.5, 0.55, -7.5, 'crate');
  box(2.2, 1.1, 2.2, 11.5, 0.55, -8.5, 'crate');

  // South spawn cover for the attackers.
  box(2.4, 1.1, 1.2, -6, 0.55, 10.5, 'crate');
  box(2.4, 1.1, 1.2, 6, 0.55, 10.5, 'crate');
  box(1.4, 2.6, 3.2, 0, 1.3, 12, 'containerRust');

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
  const sky = new THREE.HemisphereLight(new THREE.Color('#8a7a66'), new THREE.Color(PALETTE.canvas), 1.25);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb347'), 2.8);
  sun.position.set(-18, 12, 6);
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
  const fill = new THREE.DirectionalLight(new THREE.Color('#7fb5b0'), 0.85);
  fill.position.set(14, 9, 12);
  scene.add(fill);

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
