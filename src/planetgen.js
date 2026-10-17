// Procedural "artist's estimate" planet appearance from radius, mass and equilibrium temperature.
import * as THREE from 'three';

function hash(n) { let x = Math.sin(n) * 43758.5453; return x - Math.floor(x); }
export function seedFrom(str) { let h = 2166136261; for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; }

function noise3(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const h = (a, b, c) => hash(a * 127.1 + b * 311.7 + c * 74.7 + s * 1013.3);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
    l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v), w);
}
function fbm(x, y, z, s, oct = 5) { let a = 0, f = 1, amp = 0.5; for (let i = 0; i < oct; i++) { a += amp * noise3(x * f, y * f, z * f, s + i); f *= 2.03; amp *= 0.5; } return a; }

// Fill in missing radius/mass (Earth units) with simple mass–radius relations
export function completePlanet(p, star) {
  let r = p.rade, m = p.masse;
  if (r == null && m != null) r = m < 2 ? Math.pow(m, 0.28) : m < 130 ? 0.8 * Math.pow(m, 0.59) : 11.5;
  if (m == null && r != null) m = r < 1.5 ? Math.pow(r, 3.6) : r < 12 ? Math.pow(r / 0.8, 1 / 0.59) : 300;
  if (r == null) { r = 1; m = 1; }
  let a = p.a, per = p.per;
  const ms = star.mass || 1;
  if (a == null && per != null) a = Math.cbrt(ms * Math.pow(per / 365.25, 2));
  if (per == null && a != null) per = 365.25 * Math.sqrt(Math.pow(a, 3) / ms);
  // irradiation temperature (albedo 0.3) drives the appearance class; archive Teq is shown when available
  const tirr = a && star.teff && star.rad ? star.teff * Math.sqrt((star.rad * 0.00465047) / (2 * a)) * Math.pow(0.7, 0.25) : null;
  const teq = p.eqt ?? tirr;
  return { ...p, r, m, a, per, teq, tirr: tirr ?? teq, e: p.e || 0, estR: p.rade == null, estM: p.masse == null };
}

export function classify(p, inHZ) {
  const { r, m } = p; const teq = p.tirr ?? p.teq ?? 300;
  if (r > 7 || m > 60) {
    if (teq > 2000) return 'Ultra-hot Jupiter';
    if (teq > 1000) return 'Hot Jupiter';
    if (teq > 350) return 'Warm gas giant';
    if (teq < 150) return 'Cold gas giant';
    return 'Gas giant';
  }
  if (r > 4) return teq > 700 ? 'Hot Neptune' : 'Ice giant';
  if (r > 1.6) {
    if (teq > 700) return 'Hot sub-Neptune';
    if (r < 2.8 && teq > 200 && teq < 380) return 'Possible water world';
    return 'Sub-Neptune';
  }
  if (teq > 1100) return 'Lava world';
  if (teq > 550) return 'Hot rocky world';
  if (teq > 330) return 'Arid rocky world';
  if (teq > 180 || inHZ) return 'Temperate rocky world';
  return 'Frozen rocky world';
}

const PAL = {
  'Ultra-hot Jupiter': [[60, 20, 10], [255, 120, 40], [255, 200, 120]],
  'Hot Jupiter': [[40, 30, 35], [120, 60, 50], [200, 110, 70]],
  'Warm gas giant': [[70, 90, 120], [140, 160, 190], [220, 225, 235]],
  'Gas giant': [[150, 110, 70], [210, 175, 130], [240, 225, 200]],
  'Cold gas giant': [[160, 170, 180], [205, 210, 210], [235, 235, 225]],
  'Hot Neptune': [[90, 80, 90], [150, 130, 120], [200, 180, 160]],
  'Ice giant': [[40, 90, 160], [80, 150, 210], [170, 220, 240]],
  'Hot sub-Neptune': [[110, 100, 90], [170, 150, 130], [215, 200, 180]],
  'Sub-Neptune': [[60, 110, 150], [110, 160, 190], [190, 215, 230]],
};

export function makePlanetTexture(kind, seed) {
  const W = 512, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'); const img = g.createImageData(W, H); const d = img.data;
  const em = document.createElement('canvas'); em.width = W; em.height = H;
  const ge = em.getContext('2d'); const eimg = ge.createImageData(W, H); const ed = eimg.data;
  let emissive = false;
  const s = seed * 100;
  const gasLike = PAL[kind];
  for (let y = 0; y < H; y++) {
    const lat = ((y + 0.5) / H - 0.5) * Math.PI; // texel centres
    for (let x = 0; x < W; x++) {
      const lon = ((x + 0.5) / W) * 2 * Math.PI;
      const px = Math.cos(lat) * Math.cos(lon), py = Math.sin(lat), pz = Math.cos(lat) * Math.sin(lon);
      let col, e = 0;
      const i = (y * W + x) * 4;
      if (gasLike) {
        const turb = fbm(px * 3, py * 3, pz * 3, s, 4);
        const band = Math.sin(py * (8 + seed * 10) + turb * 3.5 + Math.sin(py * 23) * 0.4);
        const t = 0.5 + 0.5 * band;
        const [a, b, cc] = gasLike;
        const k = t < 0.5 ? t * 2 : (t - 0.5) * 2;
        const c0 = t < 0.5 ? a : b, c1 = t < 0.5 ? b : cc;
        col = c0.map((v, j) => v + (c1[j] - v) * k);
        if (kind === 'Ultra-hot Jupiter') e = 0.6 + 0.4 * t;
        if (kind === 'Hot Jupiter') e = 0.25 * t;
        const shade = 0.9 + 0.2 * fbm(px * 12, py * 12, pz * 12, s + 7, 3);
        col = col.map(v => v * shade);
      } else {
        const h = fbm(px * 2.2, py * 2.2, pz * 2.2, s, 6);
        const detail = fbm(px * 9, py * 9, pz * 9, s + 3, 3);
        if (kind === 'Temperate rocky world' || kind === 'Possible water world') {
          const sea = kind === 'Possible water world' ? 0.72 : 0.52;
          const ice = Math.abs(py) > 0.82 - detail * 0.15;
          if (ice) col = [235, 240, 245];
          else if (h < sea) col = [20 + 30 * h, 50 + 60 * h, 110 + 90 * h];
          else col = h < sea + 0.06 ? [170, 160, 110] : [70 + 80 * detail, 100 + 50 * detail, 50 + 20 * detail];
          const cloud = fbm(px * 4 + 10, py * 6, pz * 4, s + 9, 5);
          if (cloud > 0.55) { const k = Math.min(1, (cloud - 0.55) * 4); col = col.map(v => v + (245 - v) * k); }
        } else if (kind === 'Lava world') {
          const crack = Math.abs(fbm(px * 5, py * 5, pz * 5, s + 5, 5) - 0.5);
          const hot = crack < 0.05 ? 1 - crack / 0.05 : 0;
          col = [30 + 25 * detail + 200 * hot, 25 + 15 * detail + 80 * hot, 25 + 10 * detail];
          e = hot;
        } else if (kind === 'Hot rocky world') {
          col = [150 + 60 * h, 110 + 50 * h, 70 + 30 * h].map(v => v * (0.8 + 0.3 * detail));
        } else if (kind === 'Arid rocky world') {
          col = [140 + 70 * h, 80 + 40 * h, 50 + 20 * h].map(v => v * (0.75 + 0.35 * detail));
        } else { // frozen
          col = [190 + 50 * h, 200 + 45 * h, 215 + 35 * h].map(v => v * (0.85 + 0.2 * detail));
        }
      }
      d[i] = Math.min(255, col[0]); d[i + 1] = Math.min(255, col[1]); d[i + 2] = Math.min(255, col[2]); d[i + 3] = 255;
      if (e > 0) { emissive = true; ed[i] = 255 * e; ed[i + 1] = 110 * e; ed[i + 2] = 30 * e; }
      ed[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0); ge.putImageData(eimg, 0, 0);
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = THREE.RepeatWrapping;
  let emap = null;
  if (emissive) { emap = new THREE.CanvasTexture(em); emap.colorSpace = THREE.SRGBColorSpace; emap.wrapS = THREE.RepeatWrapping; }
  return { map, emap };
}

// Blackbody-ish colour from effective temperature (Tanner Helland approximation)
export function tempToColor(T) {
  T = Math.max(1000, Math.min(40000, T || 5772)) / 100;
  let r, g, b;
  if (T <= 66) { r = 255; g = 99.47 * Math.log(T) - 161.12; b = T <= 19 ? 0 : 138.52 * Math.log(T - 10) - 305.04; }
  else { r = 329.7 * Math.pow(T - 60, -0.1332); g = 288.12 * Math.pow(T - 60, -0.0755); b = 255; }
  const cl = v => Math.max(0, Math.min(255, v)) / 255;
  return new THREE.Color().setRGB(cl(r), cl(g), cl(b), THREE.SRGBColorSpace);
}
export const bvToTemp = bv => 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
