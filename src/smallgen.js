// Deterministic procedural surfaces + shapes for bodies without real global maps.
// Colours/albedos follow published spacecraft and telescope results; maps are estimates, not data.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { seedFrom } from './planetgen.js';

// ---- noise ----
function hash3(x, y, z, s) { let h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1274126177) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function vnoise(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a, b, t) => a + (b - a) * t, h = (a, b, c) => hash3(xi + a, yi + b, zi + c, s);
  return L(L(L(h(0, 0, 0), h(1, 0, 0), u), L(h(0, 1, 0), h(1, 1, 0), u), v), L(L(h(0, 0, 1), h(1, 0, 1), u), L(h(0, 1, 1), h(1, 1, 1), u), v), w);
}
export function fbm(p, f, s, oct = 5) { let a = 0, amp = 0.5, n = 0; for (let i = 0; i < oct; i++) { a += amp * vnoise(p[0] * f + 31.7, p[1] * f + 17.3, p[2] * f + 5.1, s + i * 7); n += amp; f *= 2.02; amp *= 0.5; } return a / n; }
const ridge = (p, f, s, oct = 4) => 1 - Math.abs(fbm(p, f, s, oct) * 2 - 1);
function rng(seed) { let a = Math.floor(seed * 4294967296) >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const D = Math.PI / 180;
// lat/lon (deg) → unit vector in SphereGeometry's convention (u = lon/360)
function dirLL(lat, lon) { const th = (90 - lat) * D, ph = lon * D; return [-Math.cos(ph) * Math.sin(th), Math.cos(th), Math.sin(ph) * Math.sin(th)]; }
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const ang = (p, q) => Math.acos(Math.max(-1, Math.min(1, dot(p, q))));
const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const hex = h => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255];

function makeCraters(seed, n, rmin, rmax, opts = {}) {
  const r = rng(seed), out = [];
  for (let i = 0; i < n; i++) {
    const z = r() * 2 - 1, t = r() * 2 * Math.PI, s = Math.sqrt(1 - z * z);
    const c = [s * Math.cos(t), z, s * Math.sin(t)];
    if (opts.avoid && opts.avoid(c)) continue;
    const R = rmin * Math.pow(rmax / rmin, Math.pow(r(), 2.2)); // many small, few large
    out.push({ c, R, cosR: Math.cos(R * 1.6), fresh: r() < (opts.fresh ?? 0.15), depth: 0.6 + r() * 0.5 });
  }
  return out;
}
function craterField(p, list) {
  let h = 0, ray = 0, fresh = 0;
  for (const k of list) {
    const cd = dot(p, k.c); if (cd < k.cosR) continue;
    const d = Math.acos(Math.min(1, cd)) / k.R;
    if (d < 1) h += (d * d - 1) * k.depth * k.R; // bowl
    h += Math.exp(-1 * ((d - 1) / 0.18) ** 2) * 0.35 * k.R * k.depth; // rim
    if (k.fresh) { ray = Math.max(ray, d < 1.6 ? (1 - d / 1.6) : 0); if (d < 1) fresh = 1; }
  }
  return { h, ray, fresh };
}

// ---------- per-body recipes ----------
// surface(p, lat, lon, ctx) → [colour rgb 0..1, height]
const R = {};
const rocky = (base, alt, { craters = 60, rmax = 0.25, f = 3, varAmt = 0.25, seedName } = {}) => ({ base, alt, craters, rmax, f, varAmt });

R.Pluto = {
  note: "New Horizons-inspired: bright N₂-ice Sputnik Planitia ('heart'), dark red Cthulhu Macula, grey-yellow north pole",
  res: 512, craters: 70, rmax: 0.12, albedo: 1,
  shape: { axes: [1, 1, 1], amp: 0.004 },
  surface(p, lat, lon, c) {
    const n = fbm(p, 4, c.s), n2 = fbm(p, 14, c.s + 3, 3);
    let col = mix(hex(0xc8a27a), hex(0xe2c9a6), n);                    // tholin-tinted ices
    let h = (n - 0.5) * 0.04;
    // Cthulhu Macula: dark reddish band west of the heart
    const cth = sm(0.55, 0.15, Math.abs(lat + 5) / 30) * sm(0, 25, lon - 15) * sm(0, 25, 160 - lon);
    col = mix(col, mul(hex(0x6a2e1c), 0.85 + 0.3 * n2), cth * 0.95);
    // north polar region: grey-yellow methane frost
    col = mix(col, hex(0xd9cfa8), sm(45, 70, lat) * 0.8);
    // Sputnik Planitia (left lobe of Tombaugh Regio) and the paler eastern lobe
    const sp = ang(p, dirLL(25, 177)), lobeE = ang(p, dirLL(5, 215));
    const heart = sm(0.42, 0.33, sp + 0.06 * Math.sin(lon * D * 6));
    const east = sm(0.5, 0.36, lobeE) * 0.75;
    const cells = ridge(p, 22, c.s + 9, 2);
    col = mix(col, mix(hex(0xf6efe2), hex(0xe9dcc4), cells * 0.6), Math.max(heart, east));
    h = h * (1 - heart) - heart * 0.03 + heart * cells * 0.004;
    return [col, h, heart];
  },
};
R.Charon = {
  note: 'New Horizons-inspired: grey water-ice surface with reddish Mordor Macula north pole and a canyon belt',
  res: 512, craters: 80, rmax: 0.15, shape: { axes: [1, 1, 1], amp: 0.006 },
  surface(p, lat, lon, c) {
    const n = fbm(p, 4, c.s);
    let col = mix(hex(0x8f8c88), hex(0xb9b5ae), n);
    col = mix(col, mul(hex(0x7b3d2b), 0.9 + 0.2 * n), sm(55, 78, lat + 8 * (n - 0.5)));
    const canyon = sm(0.06, 0.0, Math.abs(lat - 5 - 8 * Math.sin(lon * D * 2))) * (fbm(p, 9, c.s + 2) > 0.45 ? 1 : 0.3);
    col = mix(col, hex(0x5f5a55), canyon * 0.6);
    return [col, (n - 0.5) * 0.05 - canyon * 0.03];
  },
};
R.Ceres = {
  note: "Dawn-inspired: dark carbonaceous surface (albedo ~0.09) with Occator Crater's bright salt deposits and Ahuna Mons",
  res: 512, craters: 140, rmax: 0.2, shape: { axes: [1, 1, 0.93], amp: 0.008 },
  surface(p, lat, lon, c) {
    const n = fbm(p, 5, c.s);
    let col = mix(hex(0x3a3836), hex(0x5a5652), n);
    const oc = ang(p, dirLL(20, 239)), ah = ang(p, dirLL(-10, 316));
    const spot = sm(0.035, 0.012, oc) + 0.6 * sm(0.06, 0.03, ang(p, dirLL(21, 242))) * (fbm(p, 40, c.s) > 0.55 ? 1 : 0);
    col = mix(col, hex(0xf2f2ee), Math.min(1, spot));
    const occRim = Math.exp(-1 * (((oc / 0.075) - 1) / 0.15) ** 2), occFloor = sm(0.075, 0.05, oc);
    let h = (n - 0.5) * 0.04 - occFloor * 0.04 + occRim * 0.02;
    const am = sm(0.05, 0.0, ah); h += am * 0.05; col = mix(col, hex(0x9a9690), am * 0.7);
    return [col, h];
  },
};
R.Vesta = {
  note: 'Dawn-inspired: basaltic grey-tan surface, giant Rheasilvia impact basin with central peak at the south pole, equatorial troughs (Divalia Fossae)',
  res: 512, craters: 120, rmax: 0.18, shape: { axes: [1.03, 1.0, 0.8], amp: 0.03, fn: p => { const s = Math.acos(-p[1]); return -0.12 * sm(0.9, 0.2, s) + 0.08 * sm(0.25, 0.0, s); } },
  surface(p, lat, lon, c) {
    const n = fbm(p, 4, c.s);
    let col = mix(hex(0x7d7266), hex(0xa99a88), n);
    const s = Math.acos(-p[1]);
    const basin = sm(0.95, 0.5, s); col = mix(col, hex(0x8a8070), basin * 0.5);
    const troughs = Math.pow(Math.abs(Math.sin((lat + 3 * Math.sin(lon * D)) * D * 28)), 8) * sm(30, 5, Math.abs(lat));
    col = mix(col, hex(0x5e554b), troughs * 0.5);
    col = mix(col, hex(0x4a3f36), sm(0.6, 0.75, fbm(p, 2.5, c.s + 4)) * 0.4); // dark carbonaceous patches
    return [col, (n - 0.5) * 0.05 - troughs * 0.02 + 0.06 * sm(0.25, 0, s) - 0.05 * basin];
  },
};
R.Eris = {
  note: 'Telescopic data only: extremely reflective (albedo ~0.96), near-white methane frost; mottling is invented', res: 512, craters: 25, rmax: 0.1,
  shape: { axes: [1, 1, 1], amp: 0.003 },
  surface(p, lat, lon, c) { const n = fbm(p, 4, c.s); return [mix(hex(0xe8e6e2), hex(0xfbfaf7), n), (n - 0.5) * 0.02]; },
};
R.Makemake = {
  note: 'Telescopic data only: reddish-brown methane/ethane ices (albedo ~0.8) with brighter frost patches; details invented', res: 512, craters: 30, rmax: 0.1,
  shape: { axes: [1, 1, 0.97], amp: 0.004 },
  surface(p, lat, lon, c) { const n = fbm(p, 3.5, c.s), b = sm(0.55, 0.7, fbm(p, 6, c.s + 5)); return [mix(mix(hex(0x9a5a3c), hex(0xc58a63), n), hex(0xf0dcc8), b * 0.7), (n - 0.5) * 0.03]; },
};
R.Haumea = {
  note: 'Telescopic data: fast-spinning (3.9 h) elongated ellipsoid ~2100×1680×1070 km, crystalline water-ice surface with a dark red spot; details invented', res: 512, craters: 30, rmax: 0.1,
  shape: { axes: [2100, 1074, 1680], amp: 0.004 },
  surface(p, lat, lon, c) {
    const n = fbm(p, 4, c.s); let col = mix(hex(0xd8dde2), hex(0xf6f8fa), n);
    col = mix(col, hex(0x8a3a2a), sm(0.4, 0.25, ang(p, dirLL(10, 90))) * 0.8);
    return [col, (n - 0.5) * 0.02];
  },
};
R.Sedna = {
  note: 'Telescopic data only: one of the reddest objects known (tholins); albedo ~0.32; details invented', res: 256, craters: 30, rmax: 0.12,
  shape: { axes: [1, 1, 1], amp: 0.01 },
  surface(p, lat, lon, c) { const n = fbm(p, 4, c.s); return [mix(hex(0x7a2814), hex(0xb2482a), n), (n - 0.5) * 0.04]; },
};
R.Arrokoth = {
  note: 'New Horizons-inspired: reddish contact binary (Wenu + Weeyo lobes) with a brighter neck; shape approximated', res: 256, craters: 12, rmax: 0.12,
  surface(p, lat, lon, c) { const n = fbm(p, 5, c.s); return [mix(hex(0x7d3e2a), hex(0xa85e40), n), (n - 0.5) * 0.06]; },
  lobes: [{ axes: [21.2, 9.4, 19.9], off: [-0.6, 0, 0] }, { axes: [15.4, 9.8, 13.8], off: [0.88, 0, 0] }],
};
const stony = (note, lo, hi, axes, amp, extra = {}) => ({
  note, res: 256, craters: 70, rmax: 0.3, shape: { axes, amp }, ...extra,
  surface: extra.surface || ((p, lat, lon, c) => { const n = fbm(p, 4, c.s); return [mix(hex(lo), hex(hi), n), (n - 0.5) * 0.08]; }),
});
R.Pallas = stony('Shape from Hubble/VLT imaging (~568×532×448 km); grey, heavily cratered (B-type); map invented', 0x5f5c58, 0x86827c, [568, 448, 532], 0.04);
R.Juno = stony('Shape ~320×267×200 km; stony S-type, moderately bright; map invented', 0x8a7a68, 0xb3a28a, [320, 200, 267], 0.05);
R.Hygiea = stony('Nearly spherical (VLT/SPHERE, 2019); dark C-type surface (albedo ~0.07); map invented', 0x3d3a37, 0x5a5652, [450, 420, 430], 0.02);
R.Psyche = stony('Metal-rich M-type asteroid (~278×238×171 km); grey metallic surface rendered with partial metalness; map invented (NASA Psyche arrives 2029)', 0x7f7e7c, 0xb0aeaa, [278, 171, 238], 0.05, { metal: 0.55, rough: 0.55 });
R.Eros = stony('NEAR Shoemaker-inspired: elongated "saddle" shape (~34×11×11 km), tan S-type regolith', 0x8c7356, 0xb59a78, [34, 11, 13], 0.06, { peanut: 0.25 });
R.Apophis = stony('Radar shape ~450×340 m elongated; stony Sq-type; map invented', 0x7d705f, 0xa39480, [450, 300, 340], 0.08);
R.Itokawa = stony('Hayabusa-inspired: boulder-strewn rubble-pile "sea otter" (~535×294×209 m) with smooth Muses-C region', 0x77706a, 0xa29a90, [535, 209, 294], 0.06, { peanut: 0.35, craters: 15 });
const rubble = (note, axes) => ({
  note, res: 256, craters: 18, rmax: 0.25, shape: { axes, amp: 0.05, top: true }, boulders: 260,
  surface(p, lat, lon, c) { const n = fbm(p, 6, c.s); return [mul(mix(hex(0x2a2826), hex(0x45413d), n), 1), (n - 0.5) * 0.05]; },
});
R.Bennu = rubble('OSIRIS-REx-inspired: dark (albedo ~0.044) spinning-top rubble pile (~565×535×508 m) covered in boulders', [565, 508, 535]);
R.Ryugu = rubble('Hayabusa2-inspired: very dark spinning-top rubble pile (~1 km) covered in boulders', [1040, 880, 1000]);
R.Phobos = {
  note: 'Mars-orbiter-inspired: dark, ~27×22×18 km, giant Stickney crater and parallel grooves', res: 256, craters: 50, rmax: 0.25,
  shape: { axes: [27, 18, 22], amp: 0.06, fn: p => { const s = ang(p, dirLL(1, 50)); return -0.12 * sm(0.75, 0.2, s) + 0.05 * Math.exp(-1 * ((s / 0.75 - 1) / 0.15) ** 2); } },
  surface(p, lat, lon, c) {
    const n = fbm(p, 5, c.s); let col = mix(hex(0x4a4440), hex(0x6a625a), n);
    const groove = Math.pow(Math.abs(Math.sin((p[1] * 0.8 + p[2] * 0.6) * 40)), 10);
    col = mix(col, hex(0x34302d), groove * 0.5);
    const st = ang(p, dirLL(1, 50)); col = mix(col, hex(0x7a7068), sm(0.6, 0.3, st) * 0.3);
    return [col, (n - 0.5) * 0.06 - groove * 0.02];
  },
};
R.Deimos = stony('Mars-orbiter-inspired: dark, smooth regolith-blanketed body (~15×12×11 km) with few visible craters', 0x5a524c, 0x786e66, [15, 11, 12], 0.05, { craters: 20 });
R.Io = {
  note: 'Galileo/Juno-inspired: yellow sulfur plains, red/black volcanic centres, white SO₂ frost; volcano placement is random', res: 512, craters: 0, rmax: 0.1, shape: { axes: [1, 1, 1], amp: 0.004 },
  surface(p, lat, lon, c) {
    const n = fbm(p, 4, c.s), m = fbm(p, 9, c.s + 2);
    let col = mix(hex(0xd8c25a), hex(0xeee08a), n);
    col = mix(col, hex(0xb4703a), sm(55, 75, Math.abs(lat)) * 0.6);
    col = mix(col, hex(0xf4f2e2), sm(0.6, 0.75, m) * 0.6);
    let v = 0; for (const k of c.volc) { const d = ang(p, k.c) / k.R; if (d < 3) { v = Math.max(v, d < 1 ? 1 : 0); col = mix(col, hex(0xa83c1e), Math.max(0, 1 - d / 3) * 0.5); } }
    col = mix(col, hex(0x1e1612), v);
    return [col, (n - 0.5) * 0.02];
  },
  init(c) { c.volc = makeCraters(c.s + 0.3, 40, 0.01, 0.04); },
};
R.Europa = {
  note: 'Galileo-inspired: bright water-ice crust crossed by reddish-brown lineae; few craters', res: 512, craters: 6, rmax: 0.1, shape: { axes: [1, 1, 1], amp: 0.002 },
  surface(p, lat, lon, c) {
    const n = fbm(p, 3, c.s);
    let col = mix(hex(0xd8cfc0), hex(0xf2ece2), n);
    const l1 = Math.pow(ridge(p, 5, c.s + 1, 3), 14), l2 = Math.pow(ridge(p, 11, c.s + 2, 2), 18);
    col = mix(col, hex(0x8a5a3c), Math.min(1, l1 * 0.9 + l2 * 0.6));
    col = mix(col, hex(0xa08060), sm(0.6, 0.75, fbm(p, 4, c.s + 4)) * 0.4);
    return [col, (l1 + l2) * 0.01];
  },
};
R.Ganymede = {
  note: 'Galileo/Juno-inspired: dark ancient terrain (e.g. Galileo Regio) cut by bright grooved terrain, bright polar caps', res: 512, craters: 90, rmax: 0.15, shape: { axes: [1, 1, 1], amp: 0.003 },
  surface(p, lat, lon, c) {
    const n = fbm(p, 2.5, c.s), g = Math.pow(Math.abs(Math.sin(fbm(p, 6, c.s + 3) * 60)), 3);
    const dark = sm(0.52, 0.58, n);
    let col = mix(mix(hex(0xa69c90), hex(0xc9c1b4), g), hex(0x5e554b), dark);
    col = mix(col, hex(0xe6e4e0), sm(55, 75, Math.abs(lat)) * 0.6);
    return [col, (1 - dark) * g * 0.01 - dark * 0.01];
  },
};
R.Callisto = {
  note: 'Galileo-inspired: dark, the most heavily cratered surface in the Solar System, bright fresh craters (Valhalla basin)', res: 512, craters: 260, rmax: 0.12, fresh: 0.35, shape: { axes: [1, 1, 1], amp: 0.003 },
  surface(p, lat, lon, c) {
    const n = fbm(p, 5, c.s); let col = mix(hex(0x3e3730), hex(0x5e544a), n);
    const v = ang(p, dirLL(15, 304)); col = mix(col, hex(0x9a9088), Math.exp(-1 * (((v / 0.35) - 1) / 0.08) ** 2) * 0.4 + sm(0.12, 0, v) * 0.5);
    return [col, (n - 0.5) * 0.02];
  },
};
R.Titan = {
  note: 'Cassini-inspired: opaque orange organic haze (surface hidden at visible wavelengths)', res: 256, craters: 0, rmax: 0.1, shape: { axes: [1, 1, 1], amp: 0 },
  surface(p, lat, lon, c) { const n = fbm([p[0] * 0.3, p[1] * 3, p[2] * 0.3], 2, c.s, 3); let col = mix(hex(0xc58a3a), hex(0xe0a656), n); col = mix(col, hex(0x9a6a3a), sm(60, 80, lat) * 0.5); return [col, 0]; },
};
R.Enceladus = {
  note: 'Cassini-inspired: brightest body in the Solar System (albedo ~1.4), south-polar "tiger stripe" fractures', res: 256, craters: 50, rmax: 0.12, shape: { axes: [1.03, 0.97, 1], amp: 0.004 },
  avoid: c => c[1] < -0.5,
  surface(p, lat, lon, c) {
    const n = fbm(p, 4, c.s); let col = mix(hex(0xe8eef2), hex(0xffffff), n);
    const tiger = sm(-55, -75, lat) * Math.pow(Math.abs(Math.sin((p[0] * 0.8 + p[2] * 0.6) * 22)), 18);
    col = mix(col, hex(0x6f9fc0), tiger);
    return [col, -tiger * 0.01];
  },
};
R.Rhea = stony('Cassini-inspired: bright, heavily cratered water ice; map invented', 0xb4b0aa, 0xd8d4ce, [1, 1, 1], 0.003, { res: 256, craters: 140, rmax: 0.15, fresh: 0.2 });
R.Titania = stony('Voyager 2-inspired: grey icy surface with canyons; map largely invented', 0x8e8984, 0xaea8a2, [1, 1, 1], 0.003, { craters: 100, rmax: 0.15 });
R.Oberon = stony('Voyager 2-inspired: darker, reddish heavily cratered ice; map largely invented', 0x6c635c, 0x8e837a, [1, 1, 1], 0.003, { craters: 130, rmax: 0.15 });
R.Triton = {
  note: 'Voyager 2-inspired: pinkish nitrogen-frost south polar cap with dark plume streaks, "cantaloupe terrain" to the north', res: 512, craters: 15, rmax: 0.08, shape: { axes: [1, 1, 1], amp: 0.002 },
  surface(p, lat, lon, c) {
    const cant = ridge(p, 18, c.s, 2); let col = mix(hex(0x9a9a88), hex(0xbab4a0), cant);
    const cap = sm(-5, -25, lat + 6 * (fbm(p, 4, c.s + 1) - 0.5));
    col = mix(col, mix(hex(0xe8cfc2), hex(0xf6e8de), fbm(p, 6, c.s + 2)), cap);
    const streak = cap * sm(0.7, 0.8, fbm([p[0] * 6, p[1] * 1, p[2] * 6], 3, c.s + 3, 3)); col = mix(col, hex(0x5a4a40), streak * 0.7);
    return [col, (1 - cap) * cant * 0.01];
  },
};

export const PROC = R;

// ---- geometry ----
// SphereGeometry duplicates vertices along the u=0/1 seam and at the poles. computeVertexNormals() treats
// each copy separately (half a fan at the seam, one sliver triangle at a pole), so after displacement the
// copies get different normals → a lit/dark line from pole to pole. Weld by position for normal purposes.
function weldNormals(g) {
  const P = g.attributes.position, n = P.count, idx = g.index ? g.index.array : null;
  const grp = new Int32Array(n), keys = new Map(); let ng = 0;
  for (let i = 0; i < n; i++) {
    const k = Math.round(P.getX(i) * 1e5) + ',' + Math.round(P.getY(i) * 1e5) + ',' + Math.round(P.getZ(i) * 1e5);
    let gi = keys.get(k); if (gi === undefined) { gi = ng++; keys.set(k, gi); } grp[i] = gi;
  }
  const acc = new Float64Array(ng * 3), tri = idx ? idx.length : n;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < tri; t += 3) {
    const i0 = idx ? idx[t] : t, i1 = idx ? idx[t + 1] : t + 1, i2 = idx ? idx[t + 2] : t + 2;
    if (grp[i0] === grp[i1] || grp[i1] === grp[i2] || grp[i0] === grp[i2]) continue; // degenerate (pole slivers)
    a.fromBufferAttribute(P, i0); b.fromBufferAttribute(P, i1); c.fromBufferAttribute(P, i2);
    c.sub(b); b.sub(a); b.cross(c); // area-weighted face normal
    for (const i of [i0, i1, i2]) { const o = grp[i] * 3; acc[o] += b.x; acc[o + 1] += b.y; acc[o + 2] += b.z; }
  }
  const N = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const o = grp[i] * 3, l = Math.hypot(acc[o], acc[o + 1], acc[o + 2]) || 1; N[i * 3] = acc[o] / l; N[i * 3 + 1] = acc[o + 1] / l; N[i * 3 + 2] = acc[o + 2] / l; }
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  return g;
}
function shapeFactor(spec, p, s) {
  const sh = spec.shape || {}; let r = 1 + (sh.amp || 0) * (fbm(p, 2.2, s + 50, 4) - 0.5) * 2;
  if (sh.fn) r += sh.fn(p);
  if (sh.top) r *= 1 + 0.16 * Math.pow(1 - Math.abs(p[1]), 6) - 0.1 * p[1] * p[1];
  if (spec.peanut) r *= 1 - spec.peanut * Math.exp(-1 * (p[0] * 3.2) ** 2) * (1 - Math.abs(p[1]));
  return r;
}
function buildGeometry(spec, s, hi) {
  const make = (axes, off, seedOff, sc = 1) => {
    const g = new THREE.SphereGeometry(1, hi ? 128 : 72, hi ? 96 : 48);
    const pos = g.attributes.position, v = new THREE.Vector3();
    const mx = Math.max(...axes);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      const f = shapeFactor(spec, [v.x, v.y, v.z], s + seedOff);
      pos.setXYZ(i, sc * v.x * f * axes[0] / mx + off[0], sc * v.y * f * axes[1] / mx + off[1], sc * v.z * f * axes[2] / mx + off[2]);
    }
    return weldNormals(g);
  };
  if (spec.lobes) {
    const big = Math.max(...spec.lobes.flatMap(l => l.axes));
    const parts = spec.lobes.map((l, i) => make(l.axes, l.off.map(o => o / 1.6), i * 13, Math.max(...l.axes) / big / 1.6));
    return weldNormals(mergeGeometries(parts));
  }
  return make(spec.shape?.axes || [1, 1, 1], [0, 0, 0], 0);
}

// ---- textures ----
function buildTextures(spec, name, s) {
  const W = spec.res || 256, H = W / 2;
  const col = new Uint8ClampedArray(W * H * 4), bump = new Uint8ClampedArray(W * H * 4);
  const ctx = { s: Math.floor(s * 1e6) };
  if (spec.init) spec.init(ctx);
  const craters = spec.craters ? makeCraters(s, spec.craters, 0.012, spec.rmax || 0.2, { fresh: spec.fresh, avoid: spec.avoid }) : [];
  const boulders = spec.boulders ? makeCraters(s + 0.5, spec.boulders, 0.006, 0.05) : [];
  const hs = new Float32Array(W * H);
  let hmin = Infinity, hmax = -Infinity;
  for (let y = 0; y < H; y++) {
    const th = (y + 0.5) / H * Math.PI, lat = 90 - th * 180 / Math.PI, st = Math.sin(th), ct = Math.cos(th);
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W, lon = u * 360, ph = u * 2 * Math.PI;
      const p = [-Math.cos(ph) * st, ct, Math.sin(ph) * st];
      let [c, h, smooth = 0] = spec.surface(p, lat, lon, ctx);
      if (craters.length && smooth < 0.5) {
        const k = craterField(p, craters);
        h += k.h * (1 - smooth);
        c = mul(c, 1 + k.h * 1.2);                                   // shaded floors
        if (k.ray) c = mix(c, mul(c, 1.5), k.ray * 0.35);             // bright ejecta of fresh craters
      }
      for (const b of boulders) {
        const cd = dot(p, b.c); if (cd < Math.cos(b.R)) continue;
        const d = Math.acos(Math.min(1, cd)) / b.R; const bh = Math.sqrt(Math.max(0, 1 - d * d));
        h += bh * b.R * 0.8; c = mix(c, b.fresh ? mul(c, 1.6) : mul(c, 0.75), bh * 0.6);
      }
      const i = (y * W + x) * 4;
      col[i] = Math.min(255, Math.pow(c[0], 1) * 255); col[i + 1] = Math.min(255, c[1] * 255); col[i + 2] = Math.min(255, c[2] * 255); col[i + 3] = 255;
      hs[y * W + x] = h; if (h < hmin) hmin = h; if (h > hmax) hmax = h;
    }
  }
  const span = hmax - hmin || 1;
  for (let i = 0; i < W * H; i++) { const v = (hs[i] - hmin) / span * 255; bump[i * 4] = bump[i * 4 + 1] = bump[i * 4 + 2] = v; bump[i * 4 + 3] = 255; }
  const mk = (data, srgb) => { const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').putImageData(new ImageData(data, W, H), 0, 0); const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4; return t; }; // repeat in u so filtering, mipmaps and bump taps wrap across the seam
  return { map: mk(col, true), bumpMap: mk(bump, false) };
}

// Generate lazily, one body per idle slice, nearest/most important first.
export function applyProcedural(bodies, order = []) {
  const todo = bodies.filter(b => PROC[b.name]);
  todo.sort((a, b) => (order.indexOf(a.name) + 1 || 99) - (order.indexOf(b.name) + 1 || 99));
  const step = () => {
    const b = todo.shift(); if (!b) return;
    const spec = PROC[b.name], s = seedFrom(b.name);
    const hi = (spec.res || 256) >= 512;
    const geo = buildGeometry(spec, s, hi);
    const { map, bumpMap } = buildTextures(spec, b.name, s);
    b.mesh.geometry = geo; b.mesh.scale.set(1, 1, 1);
    const m = b.mesh.material;
    m.map = map; m.bumpMap = bumpMap; m.bumpScale = spec.res >= 512 ? 2.5 : 4; m.color.set(0xffffff);
    if (spec.metal) { m.metalness = spec.metal; m.roughness = spec.rough; }
    m.needsUpdate = true;
    b.procNote = spec.note;
    (window.requestIdleCallback || (f => setTimeout(f, 16)))(step, { timeout: 200 });
  };
  setTimeout(step, 300);
}
