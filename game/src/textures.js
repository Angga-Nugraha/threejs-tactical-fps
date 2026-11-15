// Procedural textures for SABLE YARD — every surface is painted on a canvas at
// boot, so game/ stays self-contained with zero network requests. All randomness
// comes from fixed seeds, so the same build always paints the same yard.
import * as THREE from 'three';
import { mulberry32 } from './rng.js';

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return [canvas, canvas.getContext('2d')];
}

function toTexture(canvas, repeatX = 1, repeatY = 1) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  return tex;
}

// Speckle noise over the whole canvas: the grime that stops a flat colour.
function speckle(g, w, h, random, n, alpha, dark = true) {
  for (let i = 0; i < n; i += 1) {
    const v = Math.floor(random() * 60);
    g.fillStyle = dark
      ? `rgba(${20 + v},${16 + v},${12 + v},${alpha * random()})`
      : `rgba(${200 + v},${190 + v},${170 + v},${alpha * random()})`;
    g.fillRect(random() * w, random() * h, 1 + random() * 3, 1 + random() * 3);
  }
}

// Rust streaks running down from the top edge, plus a few blotches.
function rust(g, w, h, random, count, strength = 0.5) {
  for (let i = 0; i < count; i += 1) {
    const x = random() * w;
    const len = h * (0.15 + random() * 0.6);
    const grad = g.createLinearGradient(0, 0, 0, len);
    grad.addColorStop(0, `rgba(122,62,28,${0.55 * strength})`);
    grad.addColorStop(1, 'rgba(122,62,28,0)');
    g.fillStyle = grad;
    g.fillRect(x, 0, 2 + random() * 7, len);
  }
  for (let i = 0; i < count / 2; i += 1) {
    const x = random() * w;
    const y = random() * h;
    const r = 4 + random() * 16;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(110,58,26,${0.35 * strength})`);
    grad.addColorStop(1, 'rgba(110,58,26,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
}

// Corrugated container metal: vertical ribs, top/bottom rails, rust, stencil label.
export function containerTexture(base, label, seed = 11) {
  const random = mulberry32(seed);
  const [canvas, g] = makeCanvas(512, 256);
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 256);
  // Corrugation: alternating light/dark vertical bands, ~24 ribs across.
  for (let x = 0; x < 512; x += 21) {
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.fillRect(x, 0, 5, 256);
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect(x + 10, 0, 6, 256);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(x + 16, 0, 5, 256);
  }
  // Horizontal rails top and bottom.
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(0, 0, 512, 14);
  g.fillRect(0, 242, 512, 14);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fillRect(0, 14, 512, 3);
  g.fillRect(0, 239, 512, 3);
  // Wear: scratches and chips.
  for (let i = 0; i < 40; i += 1) {
    g.strokeStyle = `rgba(30,20,14,${0.15 + random() * 0.25})`;
    g.lineWidth = 1 + random() * 2;
    const x = random() * 512;
    const y = random() * 256;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (random() * 30 - 15), y + (random() * 10 - 5));
    g.stroke();
  }
  rust(g, 512, 256, random, 26, 0.7);
  speckle(g, 512, 256, random, 900, 0.25);
  // Weathering variation per container (seeded): dark grime patches and a
  // grime band along the bottom edge, so no two container colours read alike.
  for (let i = 0; i < 5; i += 1) {
    const px = random() * 460;
    const py = 30 + random() * 180;
    const pw = 30 + random() * 90;
    const ph = 14 + random() * 40;
    const grad = g.createRadialGradient(px + pw / 2, py + ph / 2, 0, px + pw / 2, py + ph / 2, Math.max(pw, ph) / 2);
    grad.addColorStop(0, `rgba(24,16,10,${0.16 + random() * 0.18})`);
    grad.addColorStop(1, 'rgba(24,16,10,0)');
    g.fillStyle = grad;
    g.fillRect(px, py, pw, ph);
  }
  {
    const grad = g.createLinearGradient(0, 200, 0, 256);
    grad.addColorStop(0, 'rgba(20,14,8,0)');
    grad.addColorStop(1, 'rgba(20,14,8,0.34)');
    g.fillStyle = grad;
    g.fillRect(0, 200, 512, 56);
  }
  // Stencil label, faded white. The unit code varies with the seed so the
  // four container colours carry different stencils.
  const codes = ['22G1', '45R1', '22U1', '31G0'];
  const code = codes[seed % codes.length];
  if (label) {
    g.fillStyle = 'rgba(242,233,216,0.82)';
    g.font = 'bold 44px system-ui, sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(label, 28, 128);
    g.font = 'bold 22px system-ui, sans-serif';
    g.fillStyle = 'rgba(242,233,216,0.55)';
    g.fillText(`SABLE YARD  •  ${code}`, 28, 168);
    // Second stencil: a small faded handling mark, seeded position.
    g.fillStyle = 'rgba(242,233,216,0.4)';
    g.font = 'bold 20px system-ui, sans-serif';
    g.fillText(seed % 2 === 0 ? 'MAX 30480 KG' : 'TARE 2250 KG', 28 + random() * 120, 205);
  }
  return toTexture(canvas);
}

// Concrete: patchy pour, stains, hairline cracks, expansion joints.
export function concreteTexture(base, seed = 23, joints = true) {
  const random = mulberry32(seed);
  const [canvas, g] = makeCanvas(512, 512);
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 512);
  // Pour patches: large soft blotches of slightly different tone.
  for (let i = 0; i < 26; i += 1) {
    const x = random() * 512;
    const y = random() * 512;
    const r = 40 + random() * 110;
    const light = random() > 0.5;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, light ? 'rgba(255,250,240,0.06)' : 'rgba(20,14,10,0.10)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // Oil stains.
  for (let i = 0; i < 9; i += 1) {
    const x = random() * 512;
    const y = random() * 512;
    const r = 14 + random() * 42;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(18,14,10,0.42)');
    grad.addColorStop(0.7, 'rgba(18,14,10,0.18)');
    grad.addColorStop(1, 'rgba(18,14,10,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // Hairline cracks.
  for (let i = 0; i < 12; i += 1) {
    g.strokeStyle = 'rgba(25,18,12,0.5)';
    g.lineWidth = 1;
    let x = random() * 512;
    let y = random() * 512;
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < 6; s += 1) {
      x += random() * 40 - 20;
      y += random() * 40 - 20;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  if (joints) {
    g.strokeStyle = 'rgba(20,14,10,0.55)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(256, 0);
    g.lineTo(256, 512);
    g.moveTo(0, 256);
    g.lineTo(512, 256);
    g.stroke();
  }
  speckle(g, 512, 512, random, 2600, 0.28);
  speckle(g, 512, 512, random, 500, 0.2, false);
  return toTexture(canvas);
}

// Wooden crate planks: horizontal boards, grain, gaps, nails, stencil.
export function crateTexture(base, seed = 37) {
  const random = mulberry32(seed);
  const [canvas, g] = makeCanvas(256, 256);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  const plankH = 256 / 5;
  for (let p = 0; p < 5; p += 1) {
    const y = p * plankH;
    const shade = 0.9 + random() * 0.2;
    g.fillStyle = `rgba(${Math.floor(125 * shade)},${Math.floor(93 * shade)},${Math.floor(56 * shade)},1)`;
    g.fillRect(0, y + 2, 256, plankH - 4);
    // Grain lines.
    for (let i = 0; i < 9; i += 1) {
      g.strokeStyle = `rgba(60,40,20,${0.15 + random() * 0.2})`;
      g.lineWidth = 1;
      const gy = y + 4 + random() * (plankH - 8);
      g.beginPath();
      g.moveTo(0, gy);
      g.bezierCurveTo(85, gy + random() * 6 - 3, 170, gy + random() * 6 - 3, 256, gy);
      g.stroke();
    }
    // Nails at the ends.
    g.fillStyle = 'rgba(40,28,18,0.8)';
    g.beginPath();
    g.arc(12, y + plankH / 2, 3, 0, Math.PI * 2);
    g.arc(244, y + plankH / 2, 3, 0, Math.PI * 2);
    g.fill();
  }
  // Board gaps.
  g.fillStyle = 'rgba(30,20,12,0.85)';
  for (let p = 1; p < 5; p += 1) g.fillRect(0, p * plankH - 1, 256, 3);
  // Frame battens.
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(0, 0, 14, 256);
  g.fillRect(242, 0, 14, 256);
  rust(g, 256, 256, random, 6, 0.35);
  speckle(g, 256, 256, random, 500, 0.22);
  g.fillStyle = 'rgba(242,233,216,0.6)';
  g.font = 'bold 30px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText('SABLE', 128, 128);
  return toTexture(canvas);
}

// Barrel: horizontal ribs, a label band, rust at the rims.
export function barrelTexture(base, label, seed = 41) {
  const random = mulberry32(seed);
  const [canvas, g] = makeCanvas(256, 256);
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  // Vertical brushed shading.
  for (let x = 0; x < 256; x += 8) {
    g.fillStyle = random() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
    g.fillRect(x, 0, 4, 256);
  }
  // Ribs.
  for (const y of [42, 84, 172, 214]) {
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.fillRect(0, y, 256, 7);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(0, y + 7, 256, 3);
  }
  // Label band.
  g.fillStyle = 'rgba(232,220,196,0.92)';
  g.fillRect(0, 104, 256, 58);
  g.fillStyle = 'rgba(30,22,16,0.9)';
  g.font = 'bold 26px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText(label, 128, 128);
  g.font = 'bold 15px system-ui, sans-serif';
  g.fillStyle = 'rgba(30,22,16,0.65)';
  g.fillText('SABLE YARD', 128, 150);
  rust(g, 256, 256, random, 14, 0.6);
  speckle(g, 256, 256, random, 500, 0.25);
  return toTexture(canvas);
}

// Diagonal hazard stripes, yellow on near-black.
export function hazardTexture() {
  const [canvas, g] = makeCanvas(128, 128);
  g.fillStyle = '#191411';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#f5a623';
  for (let x = -128; x < 256; x += 64) {
    g.beginPath();
    g.moveTo(x, 128);
    g.lineTo(x + 32, 128);
    g.lineTo(x + 160, 0);
    g.lineTo(x + 128, 0);
    g.closePath();
    g.fill();
  }
  speckle(g, 128, 128, mulberry32(5), 200, 0.2);
  return toTexture(canvas);
}

// Big painted letter on transparent ground, for the site decals.
export function letterTexture(letter, color) {
  const [canvas, g] = makeCanvas(256, 256);
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = color;
  g.globalAlpha = 0.85;
  g.font = 'bold 200px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, 128, 138);
  // Worn paint: knock out speckles.
  g.globalCompositeOperation = 'destination-out';
  const random = mulberry32(9);
  for (let i = 0; i < 500; i += 1) {
    g.globalAlpha = 0.12 + random() * 0.25;
    g.fillRect(random() * 256, random() * 256, 1 + random() * 4, 1 + random() * 4);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Stencil sign: big text, small subtext, on a solid or transparent plate.
export function signTexture(text, sub, fg = '#f2e9d8', bg = null) {
  const [canvas, g] = makeCanvas(512, 192);
  if (bg) {
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 192);
    // Rivets.
    g.fillStyle = 'rgba(0,0,0,0.4)';
    for (const [x, y] of [[14, 14], [498, 14], [14, 178], [498, 178]]) {
      g.beginPath();
      g.arc(x, y, 5, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    g.clearRect(0, 0, 512, 192);
  }
  g.fillStyle = fg;
  g.font = 'bold 72px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, sub ? 78 : 96);
  if (sub) {
    g.font = 'bold 30px system-ui, sans-serif';
    g.globalAlpha = 0.75;
    g.fillText(sub, 256, 148);
    g.globalAlpha = 1;
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Dusk sky gradient: amber horizon, orange band, violet, deep blue top, with a
// low sun glow and a few soft cloud smudges painted in.
export function skyTexture() {
  const [canvas, g] = makeCanvas(1024, 512);
  const grad = g.createLinearGradient(0, 512, 0, 0);
  grad.addColorStop(0.0, '#e8935a');
  grad.addColorStop(0.18, '#c96f4e');
  grad.addColorStop(0.38, '#7a4a63');
  grad.addColorStop(0.62, '#3d3358');
  grad.addColorStop(1.0, '#1c2340');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 512);
  // Sun glow low on the horizon (west = left of the texture's centre-left).
  const sun = g.createRadialGradient(300, 400, 0, 300, 400, 220);
  sun.addColorStop(0, 'rgba(255,214,140,0.95)');
  sun.addColorStop(0.25, 'rgba(255,170,90,0.55)');
  sun.addColorStop(1, 'rgba(255,170,90,0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, 1024, 512);
  // Cloud smudges, lit from below.
  const random = mulberry32(17);
  for (let i = 0; i < 22; i += 1) {
    const x = random() * 1024;
    const y = 60 + random() * 220;
    const w = 90 + random() * 190;
    const h = 10 + random() * 22;
    const cg = g.createRadialGradient(x, y, 0, x, y, w / 2);
    cg.addColorStop(0, `rgba(255,190,150,${0.10 + random() * 0.12})`);
    cg.addColorStop(1, 'rgba(255,190,150,0)');
    g.fillStyle = cg;
    g.beginPath();
    g.ellipse(x, y, w / 2, h, 0, 0, Math.PI * 2);
    g.fill();
  }
  // First stars near the top.
  for (let i = 0; i < 90; i += 1) {
    g.fillStyle = `rgba(255,255,255,${0.15 + random() * 0.4})`;
    g.fillRect(random() * 1024, random() * 130, 1.5, 1.5);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Soft radial glow: lamp pools, sun sprite, muzzle flash star base.
export function glowTexture(inner = 'rgba(255,200,120,1)') {
  const [canvas, g] = makeCanvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.4, 'rgba(255,170,90,0.45)');
  grad.addColorStop(1, 'rgba(255,170,90,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Scorch mark: dark centre fading to transparent, no warm halo.
export function scorchTexture() {
  const [canvas, g] = makeCanvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(18,12,8,0.95)');
  grad.addColorStop(0.55, 'rgba(18,12,8,0.55)');
  grad.addColorStop(1, 'rgba(18,12,8,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Puffy cloud sprite texture.
export function cloudTexture(seed = 31) {
  const random = mulberry32(seed);
  const [canvas, g] = makeCanvas(256, 128);
  g.clearRect(0, 0, 256, 128);
  for (let i = 0; i < 14; i += 1) {
    const x = 40 + random() * 176;
    const y = 50 + random() * 30;
    const r = 18 + random() * 30;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,205,170,0.35)');
    grad.addColorStop(1, 'rgba(255,205,170,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Muzzle flash: a 4-point star on transparent ground.
export function flashTexture() {
  const [canvas, g] = makeCanvas(128, 128);
  g.clearRect(0, 0, 128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,240,200,1)');
  grad.addColorStop(0.35, 'rgba(255,180,70,0.9)');
  grad.addColorStop(1, 'rgba(255,140,40,0)');
  g.fillStyle = grad;
  g.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const ang = (i * Math.PI) / 4;
    const r = i % 2 === 0 ? 62 : 14;
    const x = 64 + Math.cos(ang) * r;
    const y = 64 + Math.sin(ang) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Chain-link fence: diamond mesh on transparent ground.
export function fenceTexture() {
  const [canvas, g] = makeCanvas(128, 128);
  g.clearRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(180,185,190,0.85)';
  g.lineWidth = 2;
  for (let i = -128; i < 256; i += 16) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 128, 128);
    g.stroke();
    g.beginPath();
    g.moveTo(i + 128, 0);
    g.lineTo(i, 128);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Tire marks: two curved rubber arcs on transparent ground, laid flat on the
// concrete as decals. Seeded so the arcs differ per placement.
export function tireTexture(seed = 61) {
  const random = mulberry32(seed);
  const [canvas, g] = makeCanvas(256, 128);
  g.clearRect(0, 0, 256, 128);
  for (let t = 0; t < 2; t += 1) {
    const y0 = 30 + t * 52 + random() * 10;
    g.strokeStyle = `rgba(16,12,8,${0.5 + random() * 0.2})`;
    g.lineWidth = 13 + random() * 5;
    g.beginPath();
    g.moveTo(-10, y0);
    g.bezierCurveTo(80, y0 + (random() * 24 - 12), 170, y0 + (random() * 24 - 12), 266, y0 + (random() * 16 - 8));
    g.stroke();
    // Tread ticks across the arc.
    g.strokeStyle = 'rgba(16,12,8,0.35)';
    g.lineWidth = 2;
    for (let x = 10; x < 250; x += 14) {
      g.beginPath();
      g.moveTo(x, y0 - 7);
      g.lineTo(x + 3, y0 + 7);
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
