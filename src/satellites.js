import * as THREE from 'three';
import { json2satrec, propagate } from 'satellite.js';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { OBLIQ } from './orbits.js';

export const SAT_GROUPS = [
  ['stations', 'Space stations', 0x7dffb0],
  ['visual', 'Brightest (visual)', 0xffffff],
  ['science', 'Science', 0xffa0ff],
  ['weather', 'Weather', 0x7fd0ff],
  ['gps-ops', 'GPS', 0xffd166],
  ['galileo', 'Galileo', 0xffb070],
  ['geo', 'Geostationary', 0xff7f7f],
  ['starlink', 'Starlink', 0x9fb4ff],
  ['oneweb', 'OneWeb', 0x80ffe0],
  ['active', 'All active', 0x8899aa],
];
// featured by default: [NORAD id, display name]
const FEATURED = [[25544, 'ISS'], [48274, 'Tiangong'], [20580, 'Hubble'], [41866, 'GOES-16'], [49260, 'Landsat 9'], [43013, 'NOAA-20']];

const RE = 6371.0, MU = 398600.4418;
const cE = Math.cos(OBLIQ), sE = Math.sin(OBLIQ);

async function fetchGP(q) {
  const tries = [`/api/gp?${q}`, `https://celestrak.org/NORAD/elements/gp.php?${q}&FORMAT=json`];
  for (const u of tries) {
    try {
      const r = await fetch(u);
      if (!r.ok) continue;
      const t = await r.text();
      if (t.trim().startsWith('[')) return JSON.parse(t);
    } catch (e) { /* try next */ }
  }
  throw new Error('Could not load satellite data');
}

// TEME (equatorial, km) → three.js ecliptic frame (km)
function temeToThree(p, out) {
  const ex = p.x, ey = p.y * cE + p.z * sE, ez = -p.y * sE + p.z * cE;
  return out.set(ex, ez, -ey);
}

function mkSat(omm, groupKey, name) {
  let satrec;
  try { satrec = json2satrec(omm); } catch { return null; }
  if (!satrec || satrec.error) return null;
  const n = omm.MEAN_MOTION; // rev/day
  const a = Math.cbrt(MU / Math.pow((n * 2 * Math.PI) / 86400, 2));
  return {
    name: name || omm.OBJECT_NAME, objName: omm.OBJECT_NAME, id: omm.NORAD_CAT_ID, cospar: omm.OBJECT_ID, groupKey,
    satrec, epoch: Date.parse(omm.EPOCH + 'Z'), inc: omm.INCLINATION, ecc: omm.ECCENTRICITY,
    periodMin: 1440 / n, apo: a * (1 + omm.ECCENTRICITY) - RE, peri: a * (1 - omm.ECCENTRICITY) - RE,
    km: new THREE.Vector3(), vel: 0, ok: false, type: 'satellite',
  };
}

export class Satellites {
  constructor({ scene, earth, kmToUnits, displayRadiusEarth, getScaleMode, onChange }) {
    Object.assign(this, { scene, earth, kmToUnits, displayRadiusEarth, getScaleMode, onChange });
    this.groups = {};          // key → {sats, points, loading, enabled}
    this.featured = [];
    this.byId = new Map();
    this.root = new THREE.Group();   // follows Earth position, unrotated
    scene.add(this.root);
    this.cursor = 0;
    this.visible = true;
    this.trail = null; this.showTrail = true;
    this.markerTex = this.makeDot();
    this.loadFeatured();
  }

  makeDot() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,0.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); return t;
  }

  async loadFeatured() {
    const res = await Promise.allSettled(FEATURED.map(([id]) => fetchGP(`CATNR=${id}`)));
    res.forEach((r, i) => {
      if (r.status !== 'fulfilled' || !r.value[0]) return;
      const s = mkSat(r.value[0], 'featured', FEATURED[i][1]);
      if (!s) return;
      s.featured = true;
      this.attachObject(s, 0xffe08a);
      this.featured.push(s);
      this.byId.set(s.id, s);
    });
    this.onChange && this.onChange();
  }

  // a satellite that needs its own scene object (featured or selected)
  attachObject(s, color) {
    s.group = new THREE.Group();
    s.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.markerTex, color, sizeAttenuation: false, depthWrite: false, transparent: true }));
    s.sprite.scale.setScalar(0.012);
    s.group.add(s.sprite);
    const el = document.createElement('div');
    el.className = 'label t-satellite';
    el.innerHTML = `<span class="dot" style="background:#${new THREE.Color(color).getHexString()}"></span><span class="txt">${s.name}</span>`;
    el.addEventListener('pointerdown', e => e.stopPropagation());
    el.addEventListener('click', e => { e.stopPropagation(); this.onSelect && this.onSelect(s); });
    s.labelEl = el; s.label = new CSS2DObject(el); s.label.center.set(-0.05, 0.5);
    s.group.add(s.label);
    this.scene.add(s.group);
  }

  async setGroup(key, on) {
    let g = this.groups[key];
    if (!g) {
      const color = SAT_GROUPS.find(x => x[0] === key)[2];
      g = this.groups[key] = { sats: [], points: null, loading: true, enabled: on, color, error: null };
      this.onChange && this.onChange();
      try {
        const data = await fetchGP(`GROUP=${key}`);
        g.sats = data.map(o => this.byId.get(o.NORAD_CAT_ID) && this.byId.get(o.NORAD_CAT_ID).groupKey === key ? this.byId.get(o.NORAD_CAT_ID) : mkSat(o, key)).filter(Boolean);
        for (const s of g.sats) if (!this.byId.has(s.id)) this.byId.set(s.id, s);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(g.sats.length * 3), 3));
        geo.setDrawRange(0, g.sats.length);
        g.points = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: g.sats.length > 2000 ? 2.2 : 3.2, sizeAttenuation: false, transparent: true, opacity: 0.9, depthWrite: false }));
        g.points.frustumCulled = false;
        this.root.add(g.points);
        g.fresh = true;
      } catch (e) { g.error = e.message; }
      g.loading = false;
    }
    g.enabled = on;
    if (g.points) g.points.visible = on;
    this.onChange && this.onChange();
  }

  // km (three frame, Earth-centred) → scene units relative to Earth
  scalePos(km, out) {
    if (this.getScaleMode() === 'true') return out.copy(km).multiplyScalar(this.kmToUnits);
    const r = km.length();
    const alt = Math.max(r - RE, 0);
    const R = this.displayRadiusEarth();
    const d = R * (1.02 + 1.2 * Math.pow(alt / RE, 0.6));
    return out.copy(km).multiplyScalar(d / r);
  }

  propagateOne(s, date) {
    let pv;
    try { pv = propagate(s.satrec, date); } catch { pv = null; }
    if (!pv || !pv.position || typeof pv.position === 'boolean' || isNaN(pv.position.x)) { s.ok = false; return false; }
    temeToThree(pv.position, s.km);
    const v = pv.velocity; s.vel = Math.hypot(v.x, v.y, v.z);
    s.ok = true; return true;
  }

  update(simMs, camera, dtReal, selected) {
    this.root.position.copy(this.earth.group.position);
    const camToEarth = camera.position.distanceTo(this.earth.group.position);
    const R = this.displayRadiusEarth();
    // hide swarm when far away (tiny dots on top of Earth are noise + wasted CPU)
    const near = camToEarth < R * 400;
    const date = new Date(simMs);
    const tmp = new THREE.Vector3();

    for (const s of this.featured) {
      this.propagateOne(s, date);
      s.group.visible = this.visible && s.ok && (near || s === selected);
      if (s.ok) this.scalePos(s.km, s.group.position).add(this.root.position);
      s.label.visible = s.group.visible && camToEarth < R * 120;
    }
    if (selected && selected.type === 'satellite' && !selected.featured) {
      this.propagateOne(selected, date);
      if (selected.ok) this.scalePos(selected.km, selected.group.position).add(this.root.position);
      selected.group.visible = true; selected.label.visible = true;
    }
    if (this.lastTemp && this.lastTemp !== selected && this.lastTemp.group) this.lastTemp.group.visible = false;

    // round-robin swarm propagation with a per-frame budget
    const BUDGET = 3000;
    let budget = BUDGET;
    for (const g of Object.values(this.groups)) {
      if (!g.points) continue;
      g.points.visible = g.enabled && this.visible && near;
      if (!g.points.visible) continue;
      const arr = g.points.geometry.attributes.position.array;
      const n = g.sats.length;
      if (g.fresh) { g.cur = 0; }
      const count = g.fresh ? n : Math.min(n, budget);
      for (let k = 0; k < count; k++) {
        const i = (g.cur + k) % n, s = g.sats[i];
        if (this.propagateOne(s, date)) { this.scalePos(s.km, tmp); arr[i * 3] = tmp.x; arr[i * 3 + 1] = tmp.y; arr[i * 3 + 2] = tmp.z; }
        else { arr[i * 3] = arr[i * 3 + 1] = arr[i * 3 + 2] = 1e9; }
      }
      g.cur = (g.cur + count) % Math.max(n, 1);
      budget = Math.max(500, budget - count);
      g.fresh = false;
      g.points.geometry.attributes.position.needsUpdate = true;
    }
    this.updateTrail(simMs, selected);
  }

  markAllFresh() { for (const g of Object.values(this.groups)) g.fresh = true; if (this.trail) this.trailAt = -Infinity; }

  updateTrail(simMs, selected) {
    const want = this.showTrail && selected && selected.type === 'satellite' && selected.ok;
    if (!want) { if (this.trail) this.trail.visible = false; return; }
    if (this.trailSat === selected && Math.abs(simMs - this.trailAt) < selected.periodMin * 60000 * 0.02 && this.trailMode === this.getScaleMode()) { this.trail.visible = true; return; }
    const N = 240, pts = new Float32Array((N + 1) * 3), v = new THREE.Vector3(), o = new THREE.Vector3();
    const s = { ...selected, km: new THREE.Vector3() };
    for (let k = 0; k <= N; k++) {
      const t = simMs + (k / N - 0.5) * selected.periodMin * 60000;
      if (this.propagateOne(s, new Date(t))) { this.scalePos(s.km, o); pts.set([o.x, o.y, o.z], k * 3); }
    }
    if (!this.trail) {
      this.trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.6, depthWrite: false }));
      this.trail.frustumCulled = false;
      this.root.add(this.trail);
    }
    this.trail.geometry.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    this.trail.visible = true;
    this.trailSat = selected; this.trailAt = simMs; this.trailMode = this.getScaleMode();
  }

  // screen-space pick among visible satellites
  pick(ndc, camera, maxPx, w, h) {
    let best = null, bestD = maxPx;
    const v = new THREE.Vector3();
    const test = (s, pos, abs) => {
      v.copy(pos); if (!abs) v.add(this.root.position); v.project(camera);
      if (v.z > 1 || v.z < -1) return;
      const d = Math.hypot((v.x - ndc.x) * w / 2, (v.y - ndc.y) * h / 2);
      if (d < bestD) { bestD = d; best = s; }
    };
    for (const s of this.featured) if (s.group.visible) test(s, s.group.position, true);
    for (const g of Object.values(this.groups)) {
      if (!g.points || !g.points.visible) continue;
      const arr = g.points.geometry.attributes.position.array, p = new THREE.Vector3();
      for (let i = 0; i < g.sats.length; i++) { p.fromArray(arr, i * 3); if (p.x < 1e8) test(g.sats[i], p); }
    }
    return best;
  }

  // ensure a (possibly swarm) satellite has an object for follow/label
  ensureObject(s) {
    if (!s.group) this.attachObject(s, 0xffe08a);
    if (this.lastTemp && this.lastTemp !== s && !this.lastTemp.featured) { this.scene.remove(this.lastTemp.group); this.lastTemp.group = null; }
    if (!s.featured) this.lastTemp = s;
  }

  search(q, limit = 40) {
    q = q.toLowerCase();
    const out = [];
    for (const s of this.featured) if (s.name.toLowerCase().includes(q) || s.objName.toLowerCase().includes(q)) out.push(s);
    if (q.length < 2) return out;
    for (const s of this.byId.values()) {
      if (out.length >= limit) break;
      if (!s.featured && (s.name.toLowerCase().includes(q) || String(s.id) === q)) out.push(s);
    }
    return out;
  }
}
