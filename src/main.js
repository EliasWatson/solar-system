import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildBodyList, TYPE_LABEL } from './bodies.js';
import { jdFromMs, helioPos, orbitPoints, periodDays, moonGeo, toThree, poleEcliptic, gmst, AU_KM, OBLIQ, elementsAt } from './orbits.js';
import { Satellites, SAT_GROUPS } from './satellites.js';
import { Galaxy, LY_PC } from './galaxy.js';
import './style.css';

const AU = 50;                 // scene units per AU
const KM = AU / AU_KM;         // scene units per km
const BASE = import.meta.env.BASE_URL + 'textures/';

// ---------- renderer / scene ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1e-7, 1e12);
camera.position.set(0, 260, 420);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
labelRenderer.domElement.className = 'labels';
document.body.appendChild(labelRenderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.zoomSpeed = 1.4;
controls.rotateSpeed = 0.6;
controls.minDistance = 0.00001;
controls.maxDistance = 4e10;
controls.zoomToCursor = false;

const loader = new THREE.TextureLoader();
const loadingEl = document.getElementById('loading');
const manager = THREE.DefaultLoadingManager;
manager.onLoad = () => loadingEl.classList.add('done');
const texCache = {};
function tex(name, srgb = true) {
  if (!texCache[name]) {
    const t = loader.load(BASE + name);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    texCache[name] = t;
  }
  return texCache[name];
}

// Milky Way background (equatorial equirect → rotate to ecliptic frame)
const sky = tex('2k_stars_milky_way.jpg');
sky.mapping = THREE.EquirectangularReflectionMapping;
scene.background = sky;
scene.backgroundIntensity = 0.35;
scene.backgroundRotation = new THREE.Euler(-OBLIQ, 0, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.035));
const sunLight = new THREE.PointLight(0xffffff, 3.2, 0, 0);
scene.add(sunLight);

// ---------- bodies ----------
const state = {
  scale: 'enlarged', // or 'true'
  showOrbits: true, showLabels: true, showSmall: true, showMoons: true,
  simMs: Date.now(), rate: 1, playing: true,
};
const bodies = buildBodyList();
const earthSunView = { value: new THREE.Vector3() };
const byName = Object.fromEntries(bodies.map(b => [b.name, b]));
const sphereGeo = new THREE.SphereGeometry(1, 96, 64);
const lowGeo = new THREE.SphereGeometry(1, 32, 24);
const pickables = [];

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,240,200,1)');
  grd.addColorStop(0.15, 'rgba(255,200,110,0.55)');
  grd.addColorStop(0.4, 'rgba(255,150,60,0.12)');
  grd.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function displayRadius(b) {
  if (b.trueR !== undefined) return galaxy.displayRadius(b);
  if (b.type === 'satellite') return state.scale === 'true' ? 40 * KM : 0.004;
  if (state.scale === 'true') return b.r * KM;
  if (b.type === 'star') return 4.0;
  return Math.max(0.05, 0.16 * Math.sqrt(b.r / 1000));
}

for (const b of bodies) {
  b.group = new THREE.Group();             // positioned (not rotated)
  b.tilt = new THREE.Group();              // pole orientation
  b.group.add(b.tilt);
  scene.add(b.group);
  if (b.pole) {
    const p = poleEcliptic(b.pole[0], b.pole[1]);
    b.poleVec = toThree(p, new THREE.Vector3()).normalize();
    b.tilt.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.poleVec);
  } else b.poleVec = new THREE.Vector3(0, 1, 0);

  let mat;
  if (b.type === 'star') {
    mat = new THREE.MeshBasicMaterial({ map: tex(b.tex), color: new THREE.Color(1.6, 1.35, 1.0) });
  } else {
    mat = new THREE.MeshStandardMaterial({ map: tex(b.tex), roughness: 1, metalness: 0, color: b.tint ?? 0xffffff });
  }
  if (b.name === 'Earth') {
    const night = tex('2k_earth_nightmap.jpg');
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.nightMap = { value: night };
      sh.uniforms.uSunView = earthSunView;
      sh.fragmentShader = 'uniform sampler2D nightMap;\nuniform vec3 uSunView;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float sunDot = dot(normal, normalize(uSunView + vViewPosition));
        totalEmissiveRadiance += texture2D(nightMap, vMapUv).rgb * smoothstep(0.1, -0.2, sunDot) * 1.4;`);
    };
  }
  b.mesh = new THREE.Mesh(b.type === 'planet' || b.type === 'star' || b.name === 'Moon' ? sphereGeo : lowGeo, mat);
  b.mesh.userData.body = b;
  b.spin = new THREE.Group();
  b.spin.add(b.mesh);
  b.tilt.add(b.spin);
  if (b.squash) b.mesh.scale.set(...b.squash);
  pickables.push(b.mesh);

  if (b.type === 'star') {
    b.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    b.group.add(b.glow);
  }
  if (b.ring) {
    const [rin, rout] = b.ring;
    const g = new THREE.RingGeometry(rin / b.r, rout / b.r, 180, 1);
    const pos = g.attributes.position, uv = g.attributes.uv, v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      uv.setXY(i, (v.length() - rin / b.r) / ((rout - rin) / b.r), 0.5);
    }
    const ringTex = tex('saturn_ring.png');
    const rm = new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, color: new THREE.Color(0.85, 0.82, 0.78) });
    b.ringMesh = new THREE.Mesh(g, rm);
    b.ringMesh.rotation.x = -Math.PI / 2;
    b.tilt.add(b.ringMesh);
  }

  // label
  const el = document.createElement('div');
  el.className = `label t-${b.type}`;
  el.innerHTML = `<span class="dot" style="background:#${new THREE.Color(b.color).getHexString()}"></span><span class="txt">${b.name}</span>`;
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('click', (e) => { e.stopPropagation(); select(b, true); });
  b.labelEl = el;
  b.label = new CSS2DObject(el);
  b.label.center.set(-0.02, 0.5);
  b.group.add(b.label);
}

// orbit lines
const orbitColor = { planet: 0x5d8fd6, dwarf: 0x9a7fd6, asteroid: 0x7a6f62, kbo: 0x7a6f62, moon: 0x667788 };
function makeLine(pts, b) {
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  const m = new THREE.LineBasicMaterial({ color: orbitColor[b.type], transparent: true, opacity: b.type === 'planet' ? 0.55 : 0.35, depthWrite: false });
  return new THREE.Line(g, m);
}
function buildHelioOrbits(jd) {
  for (const b of bodies) {
    if (!b.kind) continue;
    if (b.orbitLine) { scene.remove(b.orbitLine); b.orbitLine.geometry.dispose(); }
    const n = b.osc && b.osc.a > 100 ? 2048 : 720;
    const pts = orbitPoints(b, jd, n).map(p => toThree(p, new THREE.Vector3()).multiplyScalar(AU));
    b.orbitLine = makeLine(pts, b);
    scene.add(b.orbitLine);
  }
}

// moon local position in km (three frame) relative to parent
const tmpA = [0, 0, 0];
function moonLocalKm(b, jd, out) {
  if (b.name === 'Moon') return toThree(moonGeo(jd, tmpA), out);
  const p = byName[b.parent];
  const L = (b.L0 + (360 / b.period) * (jd - 2451545.0)) * Math.PI / 180;
  // circular orbit in parent's equatorial plane
  out.set(Math.cos(L) * b.dist, 0, -Math.sin(L) * b.dist);
  return out.applyQuaternion(p.tilt.quaternion);
}
function moonScale(b, vKm, out) {
  const p = byName[b.parent];
  if (state.scale === 'true') return out.copy(vKm).multiplyScalar(KM);
  const d = vKm.length();
  const R = displayRadius(p);
  const disp = R * (1.6 + 0.55 * Math.sqrt(d / p.r)) + displayRadius(b);
  return out.copy(vKm).multiplyScalar(disp / d);
}
function buildMoonOrbits(jd) {
  for (const b of bodies) {
    if (b.type !== 'moon') continue;
    const p = byName[b.parent];
    if (b.orbitLine) { p.group.remove(b.orbitLine); b.orbitLine.geometry.dispose(); }
    const pts = [], v = new THREE.Vector3(), period = b.name === 'Moon' ? 27.32 : Math.abs(b.period);
    for (let k = 0; k <= 256; k++) pts.push(moonScale(b, moonLocalKm(b, jd + (k / 256) * period, v), new THREE.Vector3()));
    b.orbitLine = makeLine(pts, b);
    p.group.add(b.orbitLine);
  }
}

function applyScale() {
  for (const b of bodies) {
    const r = displayRadius(b);
    b.spin.scale.setScalar(r);
    if (b.ringMesh) b.ringMesh.scale.setScalar(r);
    if (b.glow) b.glow.scale.setScalar(state.scale === 'true' ? r * 12 : r * 6);
  }
  buildMoonOrbits(jdFromMs(state.simMs));
}

// ---------- satellites ----------
const sats = new Satellites({
  scene, earth: byName.Earth, kmToUnits: KM, displayRadiusEarth: () => displayRadius(byName.Earth), getScaleMode: () => state.scale,
  onChange: () => { renderList(search.value); renderSatGroups(); maybeSelectFromHash(); },
});
sats.onSelect = s => selectSat(s);
function selectSat(s) { sats.ensureObject(s); sats.update(state.simMs, camera, 0, s); select(s, true); }

// ---------- other star systems ----------
const galaxy = new Galaxy({
  scene, camera, controls, AU, tex, sunLight, getScaleMode: () => state.scale,
  onSelectBody: b => select(b, true),
  onSystemChange: () => {
    selected = null; flight = null; info.classList.add('hidden');
    document.querySelectorAll('.label.sel').forEach(e => e.classList.remove('sel'));
    applyVisibility(); renderList(search.value); updateNavButtons();
  },
  onArrive: s => {
    const star = s.sol ? byName.Sun : galaxy.exoBodies[0];
    select(star, false);
    history.replaceState(null, '', s.sol ? '#Sun' : '#sys-' + s.id);
  },
});
function startSystemFlight(s, opts) { selected = null; flight = null; info.classList.add('hidden'); galaxy.flyToSystem(s, opts); }

// ---------- update positions ----------
const tmp = [0, 0, 0], tv = new THREE.Vector3(), tv2 = new THREE.Vector3();
function updatePositions(jd) {
  for (const b of bodies) {
    if (b.kind) {
      helioPos(b, jd, tmp);
      toThree(tmp, b.group.position).multiplyScalar(AU);
      b.helioAU = tmp.slice();
    }
  }
  for (const b of bodies) {
    if (b.type !== 'moon') continue;
    const p = byName[b.parent];
    moonLocalKm(b, jd, tv);
    b.localKm = tv.clone();
    moonScale(b, tv, tv2);
    b.group.position.copy(p.group.position).add(tv2);
    // tidally locked: face the parent (texture lon 0 = local +X)
    b.spin.rotation.y = Math.atan2(tv.z, -tv.x);
  }
  for (const b of bodies) {
    if (b.type === 'moon') continue;
    if (b.name === 'Earth') b.spin.rotation.y = gmst(jd);
    else b.spin.rotation.y = ((jd * 24) / b.rot) * 2 * Math.PI % (2 * Math.PI);
  }
}

// ---------- selection / camera flight ----------
let selected = null, flight = null;
const lastPos = new THREE.Vector3();
function select(b, fly = true) {
  selected = b;
  document.querySelectorAll('.label.sel').forEach(e => e.classList.remove('sel'));
  b.labelEl.classList.add('sel');
  lastPos.copy(b.group.position);
  if (fly) {
    const r = displayRadius(b) * (b.ring ? 1.6 : 1);
    const dist = Math.max(r * 5 * Math.max(1, 1.3 / camera.aspect), 1e-5);
    const dir = camera.position.clone().sub(controls.target).normalize();
    // nice viewing angle: slightly above, sun-lit side partially visible
    if (b.type === 'satellite') {
      const R = displayRadius(byName.Earth);
      const out = b.group.position.clone().sub(byName.Earth.group.position).normalize();
      dir.copy(out).add(new THREE.Vector3(0, 0.35, 0)).normalize();
      flight = { t: 0, dur: 1.8, fromTarget: controls.target.clone(), fromCam: camera.position.clone(), dir, dist: state.scale === 'true' ? 1500 * KM : R * 0.9 };
    } else if (b.type !== 'star') {
      const toSun = b.group.position.clone().negate().normalize();
      dir.lerp(toSun, 0.35).add(new THREE.Vector3(0, 0.25, 0)).normalize();
    }
    if (!flight || flight.t > 0 || b.type !== 'satellite') flight = { t: 0, dur: 1.8, fromTarget: controls.target.clone(), fromCam: camera.position.clone(), dir, dist };
  }
  controls.minDistance = displayRadius(b) * 1.15;
  updateInfo();
  history.replaceState(null, '', '#' + (b.type === 'satellite' ? 'sat-' + b.id : b.sys ? 'sys-' + b.sys.id + (b.type === 'exoplanet' ? '/' + encodeURIComponent(b.name) : '') : encodeURIComponent(b.name)));
}
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function updateCamera(dt) {
  if (!selected) return;
  const pos = selected.group.position;
  if (flight) {
    flight.t += dt / flight.dur;
    const k = ease(Math.min(flight.t, 1));
    const endCam = pos.clone().addScaledVector(flight.dir, flight.dist);
    // log-interpolate distance to cover huge scale differences smoothly
    const d0 = flight.fromCam.distanceTo(flight.fromTarget), d1 = flight.dist;
    const d = Math.exp(Math.log(d0) + (Math.log(d1) - Math.log(d0)) * k);
    controls.target.lerpVectors(flight.fromTarget, pos, k);
    const dir0 = flight.fromCam.clone().sub(flight.fromTarget).normalize();
    const dirk = dir0.lerp(flight.dir, k).normalize();
    camera.position.copy(controls.target).addScaledVector(dirk, d);
    if (flight.t >= 1) { flight = null; camera.position.copy(endCam); controls.target.copy(pos); }
  } else {
    const delta = tv.copy(pos).sub(lastPos);
    camera.position.add(delta);
    controls.target.copy(pos);
  }
  lastPos.copy(pos);
}

// click picking (ignore drags)
const ray = new THREE.Raycaster();
let downXY = null;
renderer.domElement.addEventListener('pointerdown', e => { downXY = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', e => {
  if (!downXY || Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]) > 6) return;
  const m = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  const gs = galaxy.pick(m, innerWidth, innerHeight);
  if (gs) { startSystemFlight(gs); return; }
  const sp = sats.pick(m, camera, 9, innerWidth, innerHeight);
  if (sp) { selectSat(sp); return; }
  ray.setFromCamera(m, camera);
  const exoMeshes = galaxy.exoBodies.map(b => b.mesh);
  const hits = ray.intersectObjects(pickables.filter(p => p.visible && p.parent.parent.parent.visible).concat(exoMeshes), false);
  if (hits.length) select(hits[0].object.userData.body, true);
});
renderer.domElement.addEventListener('dblclick', () => { if (selected) select(selected, true); });

// ---------- UI ----------
const $ = s => document.querySelector(s);
const info = $('#info');
function fmtKm(km) {
  if (km > 0.05 * AU_KM) return `${(km / AU_KM).toFixed(km / AU_KM > 10 ? 2 : 3)} AU`;
  return `${Math.round(km).toLocaleString()} km`;
}
function fmtPeriod(days) {
  days = Math.abs(days);
  if (days > 700) return `${(days / 365.25).toFixed(days > 3650 ? 1 : 2)} years`;
  if (days < 2) return `${(days * 24).toFixed(1)} hours`;
  return `${days.toFixed(1)} days`;
}
function worldKm(b) {
  // physical position in km (heliocentric ecliptic → three frame)
  if (b.kind) return new THREE.Vector3(b.group.position.x, b.group.position.y, b.group.position.z).multiplyScalar(AU_KM / AU);
  if (b.type === 'moon') return worldKm(byName[b.parent]).add(b.localKm);
  if (b.type === 'satellite') return worldKm(byName.Earth).add(b.km);
  return new THREE.Vector3();
}
function updateInfo() {
  const b = selected;
  if (!b) { info.classList.add('hidden'); return; }
  info.classList.remove('hidden');
  const jd = jdFromMs(state.simMs);
  const p = worldKm(b), e = worldKm(byName.Earth);
  const rows = [];
  if (b.sys) { exoInfo(b, rows); return; }
  if (b.type === 'satellite') {
    const alt = b.km.length() - 6371;
    const grp = SAT_GROUPS.find(g => g[0] === b.groupKey);
    rows.push(['Type', 'Earth satellite' + (grp ? ` · ${grp[1]}` : '')]);
    rows.push(['NORAD ID', b.id]);
    rows.push(['Altitude', b.ok ? `${Math.round(alt).toLocaleString()} km` : 'n/a (decayed?)']);
    rows.push(['Speed', b.ok ? `${b.vel.toFixed(2)} km/s` : 'n/a']);
    rows.push(['Period', b.periodMin < 120 ? `${b.periodMin.toFixed(1)} min` : `${(b.periodMin / 60).toFixed(2)} h`]);
    rows.push(['Perigee / apogee', `${Math.round(b.peri).toLocaleString()} / ${Math.round(b.apo).toLocaleString()} km`]);
    rows.push(['Inclination', `${b.inc.toFixed(2)}°`]);
    rows.push(['Eccentricity', b.ecc.toFixed(5)]);
    const age = (state.simMs - b.epoch) / 86400000;
    rows.push(['Elements epoch', `${Math.abs(age).toFixed(1)} d ${age >= 0 ? 'old' : 'ahead'}`]);
    info.querySelector('.name').textContent = b.name;
    info.querySelector('.sub').textContent = `${b.objName} · ${b.cospar}`;
    info.querySelector('.rows').innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    return;
  }
  rows.push(['Type', b.type === 'moon' ? `Moon of ${b.parent}` : TYPE_LABEL[b.type]]);
  rows.push(['Radius', `${b.r < 10 ? b.r.toFixed(2) : Math.round(b.r).toLocaleString()} km`]);
  if (b.type !== 'star') rows.push(['From Sun', fmtKm(p.length())]);
  if (b.name !== 'Earth') {
    const de = p.distanceTo(e);
    rows.push(['From Earth', fmtKm(de)]);
    const lt = de / 299792.458;
    rows.push(['Light time', lt > 3600 ? `${(lt / 3600).toFixed(2)} h` : lt > 60 ? `${(lt / 60).toFixed(1)} min` : `${lt.toFixed(2)} s`]);
  }
  if (b.kind) {
    const el = elementsAt(b, jd);
    rows.push(['Orbital period', fmtPeriod(periodDays(b, jd))]);
    rows.push(['Semi-major axis', `${el.a.toFixed(3)} AU`]);
    rows.push(['Eccentricity', el.e.toFixed(4)]);
    rows.push(['Inclination', `${el.i.toFixed(2)}°`]);
  }
  if (b.type === 'moon') {
    rows.push([`From ${b.parent}`, fmtKm(b.localKm.length())]);
    rows.push(['Orbital period', fmtPeriod(b.name === 'Moon' ? 27.3217 : b.period) + (b.period < 0 ? ' (retrograde)' : '')]);
  }
  if (b.rot && b.type !== 'moon') rows.push(['Day length', fmtPeriod(Math.abs(b.rot) / 24) + (b.rot < 0 ? ' (retrograde)' : '')]);
  info.querySelector('.name').textContent = b.name;
  info.querySelector('.sub').textContent = b.fullname || '';
  info.querySelector('.rows').innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
}
function exoInfo(b, rows) {
  const s = b.sys, ly = (s.dist_pc * LY_PC);
  const lyS = ly < 100 ? ly.toFixed(2) : Math.round(ly).toLocaleString();
  const fmt = (v, d = 2) => v == null ? '—' : Number(v).toFixed(d);
  let sub = '';
  if (b.type === 'exostar') {
    const st = b.st;
    rows.push(['Type', 'Star' + (st.spec ? ` · ${st.spec}` : '')]);
    rows.push(['Distance', `${lyS} light-years`]);
    rows.push(['Temperature', st.teff ? `${Math.round(st.teff).toLocaleString()} K` : '—']);
    rows.push(['Radius', st.rad ? `${fmt(st.rad, 3)} R☉` : '—']);
    rows.push(['Mass', st.mass ? `${fmt(st.mass, 3)} M☉` : '—']);
    rows.push(['Luminosity', `${(st.lum != null ? Math.pow(10, st.lum) : s.L).toPrecision(3)} L☉`]);
    if (!b.isCompanion) {
      rows.push(['Known planets', String(s.planets.length)]);
      rows.push(['Habitable zone', `${fmt(s.hz[0], 3)} – ${fmt(s.hz[1], 3)} AU`]);
    }
    if (b.isCompanion) rows.push(['Orbit around A', `${b.orbit.a} AU · ${(b.orbit.per / 365.25).toFixed(1)} yr · e ${b.orbit.e}`]);
    sub = s.note || (s.nstars > 1 ? `${s.nstars}-star system (companions not shown)` : '');
  } else {
    rows.push(['Type', `Exoplanet · ${b.kind}`]);
    rows.push(['Host star', s.name]);
    rows.push(['Distance', `${lyS} light-years`]);
    rows.push(['Radius', `${fmt(b.r)} R⊕${b.estR ? ' (est.)' : ''}`]);
    rows.push(['Mass', `${b.m >= 100 ? (b.m / 317.8).toFixed(2) + ' MJ' : fmt(b.m) + ' M⊕'}${b.estM ? ' (est.)' : ''}`]);
    rows.push(['Orbit', `${fmt(b.a, 4)} AU`]);
    rows.push(['Period', fmtPeriod(b.per)]);
    rows.push(['Eccentricity', fmt(b.e, 3)]);
    rows.push(['Equilibrium temp', b.teq ? `${Math.round(b.teq)} K (${Math.round(b.teq - 273)} °C)${b.eqt == null ? ' est.' : ''}` : '—']);
    rows.push(['Habitable zone', b.inHZ ? 'Yes (conservative)' : 'No']);
    if (b.year) rows.push(['Discovered', `${b.year} · ${b.method || ''}`]);
    sub = "Appearance is an artist's estimate from radius, mass and temperature. Orbital phase and orientation are estimated.";
  }
  info.querySelector('.name').textContent = b.name;
  info.querySelector('.sub').textContent = sub;
  info.querySelector('.rows').innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
}
$('#info .close').onclick = () => { selected = null; flight = null; document.querySelectorAll('.label.sel').forEach(e => e.classList.remove('sel')); info.classList.add('hidden'); controls.minDistance = 1e-5; };
$('#info .refocus').onclick = () => selected && select(selected, true);

// body list + search
const listEl = $('#list');
const groups = [['Star', b => b.type === 'star'], ['Planets', b => b.type === 'planet'], ['Dwarf planets', b => b.type === 'dwarf'], ['Moons', b => b.type === 'moon'], ['Asteroids & KBOs', b => b.type === 'asteroid' || b.type === 'kbo']];
function renderList(q = '') {
  q = q.trim().toLowerCase();
  listEl.innerHTML = '';
  for (const [title, f] of groups) {
    if (!galaxy.current.sol) continue;
    const items = bodies.filter(f).filter(b => !q || b.name.toLowerCase().includes(q) || (b.parent || '').toLowerCase().includes(q));
    if (!items.length) continue;
    const h = document.createElement('div'); h.className = 'group'; h.textContent = title; listEl.appendChild(h);
    for (const b of items) {
      const it = document.createElement('button'); it.className = 'item';
      it.innerHTML = `<span class="dot" style="background:#${new THREE.Color(b.color).getHexString()}"></span>${b.name}${b.parent ? `<small>${b.parent}</small>` : ''}`;
      it.onclick = () => { select(b, true); if (innerWidth < 700) $('#sidebar').classList.remove('open'); };
      listEl.appendChild(it);
    }
  }
  if (!galaxy.current.sol && galaxy.exoBodies.length) {
    const h = document.createElement('div'); h.className = 'group'; h.textContent = 'This system: ' + galaxy.current.name; listEl.prepend(h);
    let after = h;
    for (const b of galaxy.exoBodies) {
      if (q && !b.name.toLowerCase().includes(q)) continue;
      const it = document.createElement('button'); it.className = 'item';
      it.innerHTML = `<span class="dot" style="background:#${b.color.getHexString()}"></span>${b.name}<small>${b.type === 'exoplanet' ? b.kind : 'star'}</small>`;
      it.onclick = () => { select(b, true); if (innerWidth < 700) $('#sidebar').classList.remove('open'); };
      after.after(it); after = it;
    }
  }
  const sysItems = galaxy.systems.filter(s => q ? (s.name.toLowerCase().includes(q) || (s.sol && 'sun solar'.includes(q)) || s.planets.some(p => p.name.toLowerCase().includes(q))) : s.curated);
  if (sysItems.length) {
    const h = document.createElement('div'); h.className = 'group'; h.textContent = q ? 'Star systems' : `Star systems (${galaxy.systems.length} — search for more)`; listEl.appendChild(h);
    for (const s of sysItems.slice(0, 60)) {
      const it = document.createElement('button'); it.className = 'item';
      const ly = s.dist_pc * LY_PC;
      it.innerHTML = `<span class="dot" style="background:#${s.sol ? 'ffcc66' : '6fe3ff'}"></span>${s.name}<small>${s.sol ? 'home' : (ly < 100 ? ly.toFixed(1) : Math.round(ly)) + ' ly'}</small>`;
      it.onclick = () => { startSystemFlight(s); if (innerWidth < 700) $('#sidebar').classList.remove('open'); };
      listEl.appendChild(it);
    }
  }
  const satItems = !galaxy.current.sol ? [] : q ? sats.search(q) : sats.featured;
  if (satItems.length) {
    const h = document.createElement('div'); h.className = 'group'; h.textContent = 'Satellites'; listEl.appendChild(h);
    for (const s of satItems) {
      const it = document.createElement('button'); it.className = 'item';
      it.innerHTML = `<span class="dot" style="background:#ffe08a"></span>${s.name}<small>${s.featured ? 'Earth orbit' : s.id}</small>`;
      it.onclick = () => { selectSat(s); if (innerWidth < 700) $('#sidebar').classList.remove('open'); };
      listEl.appendChild(it);
    }
  }
}
const satGroupsEl = document.getElementById('sat-groups');
function renderSatGroups() {
  satGroupsEl.innerHTML = '';
  for (const [key, title, color] of SAT_GROUPS) {
    const g = sats.groups[key];
    const lab = document.createElement('label');
    const status = !g ? '' : g.loading ? ' <small>loading…</small>' : g.error ? ' <small class="err">failed</small>' : ` <small>${g.sats.length.toLocaleString()}</small>`;
    lab.innerHTML = `<input type="checkbox" ${g && g.enabled ? 'checked' : ''}/> <span class="dot" style="background:#${new THREE.Color(color).getHexString()}"></span>${title}${status}`;
    lab.querySelector('input').onchange = e => sats.setGroup(key, e.target.checked);
    satGroupsEl.appendChild(lab);
  }
}
let hashDone = false;
function maybeSelectFromHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (hashDone || !h.startsWith('sat-')) return;
  const s = sats.byId.get(+h.slice(4));
  if (s) { hashDone = true; selectSat(s); }
}
renderList();
renderSatGroups();
if (innerWidth < 700) $('#sidebar').classList.remove('open');
const search = $('#search');
search.addEventListener('input', () => renderList(search.value));
search.addEventListener('keydown', e => {
  if (e.key === 'Enter') { const first = listEl.querySelector('.item'); if (first) first.click(); search.blur(); }
  if (e.key === 'Escape') { search.value = ''; renderList(); search.blur(); }
});
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === '/') { e.preventDefault(); $('#sidebar').classList.add('open'); search.focus(); }
  if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  if (e.key === 'Escape') $('#info .close').click();
});
$('#menu').onclick = () => $('#sidebar').classList.toggle('open');

// toggles
function bindToggle(id, key, fn) { const el = $(id); el.checked = state[key]; el.onchange = () => { state[key] = el.checked; fn && fn(); applyVisibility(); }; }
bindToggle('#t-orbits', 'showOrbits');
state.showSats = true; state.showTrail = true;
bindToggle('#t-sats', 'showSats');
bindToggle('#t-trail', 'showTrail', () => { sats.showTrail = state.showTrail; }); bindToggle('#t-labels', 'showLabels'); bindToggle('#t-small', 'showSmall'); bindToggle('#t-moons', 'showMoons');
const scaleSel = $('#t-scale');
scaleSel.onchange = () => { state.scale = scaleSel.value; applyScale(); galaxy.applyScaleExo(); updatePositions(jdFromMs(state.simMs)); sats.markAllFresh(); if (selected) select(selected, true); };
function applyVisibility() {
  const inSol = !!galaxy.current.sol;
  sats.visible = state.showSats && inSol;
  for (const b of bodies) {
    const isSmall = b.type === 'asteroid' || b.type === 'kbo';
    const vis = (!isSmall || state.showSmall) && (b.type !== 'moon' || state.showMoons);
    b.group.visible = vis || b.type === 'planet' || b.type === 'star' || b.type === 'dwarf';
    if (b.type === 'moon' || isSmall) b.group.visible = vis;
    if (b.orbitLine) b.orbitLine.visible = vis && state.showOrbits && inSol;
    if (!inSol) b.group.visible = false;
  }
  for (const b of galaxy.exoBodies) if (b.orbitLine) b.orbitLine.visible = state.showOrbits;
}

// time controls
const RATES = [
  [-31557600, '−1 yr/s'], [-2629800, '−1 mo/s'], [-604800, '−1 wk/s'], [-86400, '−1 day/s'], [-3600, '−1 hr/s'],
  [1, 'Real time'], [60, '1 min/s'], [3600, '1 hr/s'], [86400, '1 day/s'], [604800, '1 wk/s'], [2629800, '1 mo/s'], [31557600, '1 yr/s'],
];
const rateEl = $('#rate'), rateLbl = $('#rate-label'), dateEl = $('#date'), playBtn = $('#play');
rateEl.max = RATES.length - 1; rateEl.value = 5;
function setRate() { state.rate = RATES[rateEl.value][0]; rateLbl.textContent = RATES[rateEl.value][1]; }
rateEl.oninput = setRate; setRate();
function togglePlay() { state.playing = !state.playing; playBtn.textContent = state.playing ? '❚❚' : '▶'; }
playBtn.onclick = togglePlay;
$('#now').onclick = () => { state.simMs = Date.now(); rateEl.value = 5; setRate(); if (!state.playing) togglePlay(); };
dateEl.addEventListener('change', () => { const t = Date.parse(dateEl.value); if (!isNaN(t)) state.simMs = t; });

// ---------- postprocessing ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.9, 0.55, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight);
});

// ---------- label declutter ----------
function updateLabels() {
  const camDist = camera.position.distanceTo(controls.target);
  let occluder = null;
  const occ = selected && selected.type === 'satellite' ? byName.Earth : selected;
  if (occ) {
    const dist = occ.group.position.distanceTo(camera.position), r = displayRadius(occ);
    const c = tv2.copy(occ.group.position).project(camera);
    // angular radius in NDC (x units)
    const sr = (r / Math.sqrt(Math.max(dist * dist - r * r, 1e-30))) / Math.tan(camera.fov * Math.PI / 360);
    occluder = { dist, sx: c.x, sy: c.y, sr };
  }
  for (const b of bodies) {
    let show = state.showLabels && b.group.visible;
    if (show && b.type === 'moon') {
      const p = byName[b.parent];
      const d = camera.position.distanceTo(p.group.position);
      const orbitR = b.group.position.distanceTo(p.group.position);
      show = d < orbitR * 12 || selected === b;
    }
    if (show && (b.type === 'asteroid' || b.type === 'kbo') && selected !== b) {
      show = camera.position.distanceTo(b.group.position) < Math.max(camDist * 3, 400);
    }
    if (show && occluder && b !== selected && b !== occ && b.group.position.distanceTo(camera.position) > occluder.dist) {
      tv.copy(b.group.position).project(camera);
      if (tv.z < 1 && Math.hypot((tv.x - occluder.sx) * camera.aspect, tv.y - occluder.sy) < occluder.sr) show = false;
    }
    if (galaxy.galactic > 0.5) show = false;
    b.label.visible = show;
  }
  for (const b of galaxy.exoBodies) b.label.visible = state.showLabels && galaxy.galactic < 0.5;
  // fade orbit lines when zoomed in close
  const f = Math.min(1, Math.max(0.12, camDist / 3));
  for (const b of bodies) if (b.orbitLine) b.orbitLine.material.opacity = (b.type === 'planet' ? 0.55 : 0.35) * (b.type === 'moon' ? 1 : f);
}

// ---------- loop ----------
const clock = new THREE.Timer();
let lastOrbitRebuild = state.simMs, infoTick = 0, lastDateStr = '', navTick = 0;
function fmtLocal(ms) { const d = new Date(ms); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
function frame() {
  clock.update(); const dt = Math.min(clock.getDelta(), 0.1);
  if (state.playing) state.simMs += dt * 1000 * state.rate;
  state.simMs = Math.max(Date.UTC(1600, 0, 1), Math.min(Date.UTC(2500, 0, 1), state.simMs));
  const jd = jdFromMs(state.simMs);
  updatePositions(jd);
  if (Math.abs(state.simMs - lastOrbitRebuild) > 86400000 * 30) { buildHelioOrbits(jd); buildMoonOrbits(jd); applyVisibility(); lastOrbitRebuild = state.simMs; }
  sats.update(state.simMs, camera, dt, selected);
  galaxy.update(jd, dt);
  if (!galaxy.updateFlight(dt)) updateCamera(dt);
  const cd = camera.position.distanceTo(controls.target);
  controls.zoomSpeed = 1.4 + 0.45 * Math.min(6, Math.max(0, Math.log10(cd / 2000)));
  navTick += dt; if (navTick > 0.3) { navTick = 0; updateNavButtons(); }
  controls.update();
  updateLabels();
  if ((infoTick += dt) > 0.25) { infoTick = 0; if (selected) updateInfo(); }
  const ds = fmtLocal(state.simMs);
  if (ds !== lastDateStr && document.activeElement !== dateEl) { dateEl.value = ds; lastDateStr = ds; }
  earthSunView.value.set(0, 0, 0).applyMatrix4(camera.matrixWorldInverse);
  composer.render();
  labelRenderer.render(scene, camera);
  requestAnimationFrame(frame);
}

const homeBtn = $('#btn-home'), galBtn = $('#btn-galaxy'), sysName = $('#sys-name');
function updateNavButtons() {
  const away = !galaxy.current.sol || galaxy.galactic > 0.5;
  homeBtn.style.display = away ? '' : 'none';
  sysName.textContent = galaxy.galactic > 0.5 ? 'Interstellar view' : galaxy.current.sol ? 'Solar System' : `${galaxy.current.name} · ${(galaxy.current.dist_pc * LY_PC).toFixed(galaxy.current.dist_pc * LY_PC < 100 ? 1 : 0)} ly`;
  galBtn.style.display = galaxy.galactic > 0.5 ? 'none' : '';
}
homeBtn.onclick = () => startSystemFlight(galaxy.byId.sol);
galBtn.onclick = () => startSystemFlight(galaxy.current, { galactic: true });
const jd0 = jdFromMs(state.simMs);
buildHelioOrbits(jd0);
applyScale();
updatePositions(jd0);
applyVisibility();
const hash = decodeURIComponent(location.hash.slice(1));
if (byName[hash]) setTimeout(() => select(byName[hash], true), 50);
if (hash.startsWith('sys-')) {
  const [sid, pname] = hash.slice(4).split('/');
  const s = galaxy.byId[sid];
  if (s) {
    galaxy.setCurrent(s); galaxy.onArrive(s);
    camera.position.set(0, s.viewDist * 0.45, s.viewDist * 0.9); controls.target.set(0, 0, 0);
    const pb = pname && galaxy.exoBodies.find(b => b.name === decodeURIComponent(pname));
    setTimeout(() => select(pb || galaxy.exoBodies[0], !!pb), 50);
  }
}
updateNavButtons();
window.__solar = { state, bodies, byName, select, camera, controls, galaxy, startSystemFlight };
frame();
