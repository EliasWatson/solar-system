import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import exo from './data/exoplanets.json';
import { OBLIQ, keplerPos } from './orbits.js';
import { completePlanet, classify, makePlanetTexture, tempToColor, bvToTemp, seedFrom } from './planetgen.js';

const PC_AU = 206264.806;
const LY_PC = 3.26156;

// equatorial xyz (pc) → three.js ecliptic frame (pc)
function eqToThree(x, y, z, out = new THREE.Vector3()) {
  const ey = y * Math.cos(OBLIQ) + z * Math.sin(OBLIQ), ez = -y * Math.sin(OBLIQ) + z * Math.cos(OBLIQ);
  return out.set(x, ez, -ey);
}
function radecToThree(ra, dec, d) {
  ra *= Math.PI / 180; dec *= Math.PI / 180;
  return eqToThree(d * Math.cos(dec) * Math.cos(ra), d * Math.cos(dec) * Math.sin(ra), d * Math.sin(dec));
}
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const STAR_VS = `
attribute float absmag;
attribute vec3 color;
uniform float uPcPerUnit, uPixel, uMinDist, uBoost;
varying vec3 vColor; varying float vAlpha;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dpc = max(length(mv.xyz) * uPcPerUnit, 1e-7);
  float m = absmag + 5.0 * log(dpc / 10.0) / log(10.0) - uBoost;
  float fade = smoothstep(uMinDist, uMinDist * 4.0, dpc);
  gl_PointSize = clamp(5.0 - 0.62 * m, 1.6, 12.0) * uPixel;
  vAlpha = clamp(1.35 - (m - 1.0) / 6.0, 0.22, 1.0) * fade;
  vColor = color;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
const STAR_FS = `
varying vec3 vColor; varying float vAlpha;
#include <common>
#include <logdepthbuf_pars_fragment>
void main() {
  float r = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, r); a *= a;
  float core = 1.0 - smoothstep(0.0, 0.12, r);
  gl_FragColor = vec4(vColor * (0.9 + 1.6 * core), a * vAlpha);
  #include <logdepthbuf_fragment>
}`;
const RING_FS = `
uniform float uOpacity; varying vec3 vColor; varying float vAlpha;
#include <common>
#include <logdepthbuf_pars_fragment>
void main() {
  float r = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.06, 0.0, abs(r - 0.38));
  gl_FragColor = vec4(vColor, a * uOpacity);
  #include <logdepthbuf_fragment>
}`;
const RING_VS = `
attribute vec3 color;
uniform float uPixel; varying vec3 vColor; varying float vAlpha;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = 18.0 * uPixel; vColor = color; vAlpha = 1.0;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;

export class Galaxy {
  constructor({ scene, camera, controls, AU, tex, sunLight, onSystemChange, onArrive, onSelectBody, getScaleMode }) {
    Object.assign(this, { scene, camera, controls, AU, tex, sunLight, onSystemChange, onArrive, onSelectBody, getScaleMode });
    this.PC = PC_AU * AU;                 // scene units per parsec
    this.systems = this.buildSystems();
    this.byId = Object.fromEntries(this.systems.map(s => [s.id, s]));
    this.current = this.byId.sol;
    this.origin = new THREE.Vector3();    // current system position (scene units, solar frame); float64 in JS
    this.field = new THREE.Group(); this.field.scale.setScalar(this.PC); scene.add(this.field);
    this.markers = new THREE.Group(); this.markers.scale.setScalar(this.PC); scene.add(this.markers);
    this.exoRoot = null; this.exoBodies = [];
    this.flight = null; this.galactic = 0;
    this.pixel = Math.min(devicePixelRatio, 2);
    this.buildMarkers();
    this.loadField();
  }

  buildSystems() {
    const list = [{ id: 'sol', name: 'Solar System', host: 'Sun', pc: new THREE.Vector3(), dist_pc: 0, teff: 5772, rad: 1, mass: 1, curated: true, sol: true, planets: [] }];
    list.push({ id: 'alpha-cen', name: 'Alpha Centauri', host: 'Alpha Centauri A', pc: eqToThree(-0.4952, -0.414, -1.1567), dist_pc: 1.3384, teff: 5790, rad: 1.2234, mass: 1.0788, lum: Math.log10(1.519), spec: 'G2V', curated: true, planets: [],
      companion: { name: 'Alpha Centauri B', teff: 5260, rad: 0.8632, mass: 0.9092, lum: Math.log10(0.5002), spec: 'K1V', a: 23.52, e: 0.5208, per: 79.91 * 365.25, i: 79.2 },
      note: 'Binary: A and B orbit each other every 79.9 years. Proxima Centauri (a separate system here) orbits the pair at ~13,000 AU. No confirmed planets yet (a JWST candidate around A was reported in 2025).' });
    for (const s of exo.systems) {
      const id = s.host.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      list.push({ ...s, id, name: s.host, pc: radecToThree(s.ra, s.dec, s.dist_pc) });
    }
    for (const s of list) {
      if (s.sol) { s.viewDist = 900; continue; }
      const L = s.lum != null ? Math.pow(10, s.lum) : Math.pow(s.rad || 1, 2) * Math.pow((s.teff || 5772) / 5772, 4);
      const outer = Math.max(...s.planets.map(p => completePlanet(p, s)).map(p => (p.a || 0) * (1 + (p.e || 0))), s.companion ? s.companion.a * 1.6 : 0, Math.sqrt(L / 0.356) * 0.6, 0.01);
      s.viewDist = outer * this.AU * 2.6;
    }
    return list;
  }

  async loadField() {
    let data;
    try { data = await (await fetch(import.meta.env.BASE_URL + 'data/stars.json')).json(); } catch { return; }
    const hostPcs = this.systems.filter(s => !s.sol).map(s => s.pc);
    const pos = [], mag = [], col = [], named = [];
    const v = new THREE.Vector3();
    for (const [x, y, z, absmag, ci, name] of data.stars) {
      eqToThree(x, y, z, v);
      if (hostPcs.some(h => h.distanceToSquared(v) < 0.0025)) continue; // drawn by system markers
      pos.push(v.x, v.y, v.z); mag.push(absmag);
      const c = tempToColor(bvToTemp(ci)); col.push(c.r, c.g, c.b);
      if (name && absmag < 2.5) named.push([name, v.clone(), absmag]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('absmag', new THREE.Float32BufferAttribute(mag, 1));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.fieldMat = this.starMaterial();
    this.fieldPts = new THREE.Points(geo, this.fieldMat);
    this.fieldPts.frustumCulled = false;
    this.field.add(this.fieldPts);
    // a few bright-star labels for orientation in the galactic view
    this.brightLabels = named.sort((a, b) => a[2] - b[2]).slice(0, 40).map(([name, p]) => {
      const el = document.createElement('div'); el.className = 'label t-bright'; el.textContent = name;
      const o = new CSS2DObject(el); o.position.copy(p); o.center.set(-0.1, 0.5); this.field.add(o); return o;
    });
  }

  starMaterial(minDist = 0.0015) {
    return new THREE.ShaderMaterial({
      vertexShader: STAR_VS, fragmentShader: STAR_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uPcPerUnit: { value: 1 / this.PC }, uPixel: { value: this.pixel }, uMinDist: { value: minDist }, uBoost: { value: 0 } },
    });
  }

  buildMarkers() {
    const pos = [], mag = [], col = [], rcol = [];
    this.markerLabels = [];
    for (const s of this.systems) {
      pos.push(s.pc.x, s.pc.y, s.pc.z);
      const L = s.lum != null ? Math.pow(10, s.lum) : Math.pow(s.rad || 1, 2) * Math.pow((s.teff || 5772) / 5772, 4);
      s.absmag = 4.74 - 2.5 * Math.log10(Math.max(L, 1e-6));
      mag.push(s.absmag);
      const c = tempToColor(s.teff); col.push(c.r, c.g, c.b);
      const rc = new THREE.Color(s.sol ? 0xffd27a : s.curated ? 0x6fe3ff : 0x4a8fa8); rcol.push(rc.r, rc.g, rc.b);
      const el = document.createElement('div');
      el.className = 'label t-system' + (s.curated ? ' curated' : '');
      const np = s.sol ? 8 : s.planets.length;
      el.innerHTML = `<span class="txt">${s.sol ? 'Sun' : s.name}</span>${np ? `<small>${np}</small>` : ''}`;
      el.addEventListener('pointerdown', e => e.stopPropagation());
      el.addEventListener('click', e => { e.stopPropagation(); this.flyToSystem(s); });
      const o = new CSS2DObject(el); o.position.copy(s.pc); o.center.set(-0.12, 0.5);
      s.labelObj = o; this.markers.add(o);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('absmag', new THREE.Float32BufferAttribute(mag, 1));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.markerStars = new THREE.Points(geo, this.starMaterial(0.0008));
    this.markerStars.material.uniforms.uBoost.value = 0.6;
    this.markerStars.frustumCulled = false;
    this.markers.add(this.markerStars);
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', geo.attributes.position);
    g2.setAttribute('color', new THREE.Float32BufferAttribute(rcol, 3));
    this.ringMat = new THREE.ShaderMaterial({ vertexShader: RING_VS, fragmentShader: RING_FS, transparent: true, depthWrite: false,
      uniforms: { uPixel: { value: this.pixel }, uOpacity: { value: 0 } } });
    this.rings = new THREE.Points(g2, this.ringMat); this.rings.frustumCulled = false;
    this.markers.add(this.rings);
  }

  posUnits(s) { return s.pc.clone().multiplyScalar(this.PC); }

  // ---------- exo system construction ----------
  buildExo(s) {
    const AU = this.AU, root = new THREE.Group(); const bodies = [];
    const starColor = tempToColor(s.teff);
    const mkLabel = (b, cls, color) => {
      const el = document.createElement('div'); el.className = `label ${cls}`;
      el.innerHTML = `<span class="dot" style="background:#${color.getHexString()}"></span><span class="txt">${b.name}</span>`;
      el.addEventListener('pointerdown', e => e.stopPropagation());
      el.addEventListener('click', e => { e.stopPropagation(); this.onSelectBody(b); });
      b.labelEl = el; b.label = new CSS2DObject(el); b.label.center.set(-0.02, 0.5); b.group.add(b.label);
    };
    const mkBody = (o) => { o.group = new THREE.Group(); o.tilt = new THREE.Group(); o.spin = new THREE.Group(); o.group.add(o.tilt); o.tilt.add(o.spin); root.add(o.group); return o; };

    const planets = s.planets.map(p => completePlanet(p, s)).filter(p => p.a);
    const L = s.lum != null ? Math.pow(10, s.lum) : Math.pow(s.rad || 1, 2) * Math.pow((s.teff || 5772) / 5772, 4);
    const hz = [Math.sqrt(L / 1.107), Math.sqrt(L / 0.356)]; // Kopparapu+2013 conservative (runaway → maximum greenhouse), approx
    s.hz = hz; s.L = L;
    const innermost = Math.min(...planets.map(p => p.a * (1 - p.e)), s.companion ? s.companion.a * (1 - s.companion.e) * 0.5 : Infinity, 50);

    const addStar = (st, isPrimary) => {
      const col = tempToColor(st.teff);
      const b = mkBody({ name: st.host || st.name, type: 'exostar', sys: s, st, color: col });
      const rkm = (st.rad || 1) * 695700;
      b.trueR = rkm / 149597870.7 * AU;
      b.dispR = Math.max(b.trueR, Math.min(4 * Math.sqrt(st.rad || 1), innermost * AU * 0.35));
      const mat = new THREE.MeshBasicMaterial({ map: this.tex('2k_sun.jpg'), color: col.clone().multiplyScalar(1.7) });
      b.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), mat); b.mesh.userData.body = b; b.spin.add(b.mesh);
      b.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex(), color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      b.group.add(b.glow);
      mkLabel(b, 't-star', col);
      bodies.push(b); return b;
    };
    const primary = addStar(s, true);
    if (s.companion) { const c = addStar({ ...s.companion, host: s.companion.name }, false); c.orbit = s.companion; c.isCompanion = true; }

    // habitable zone
    const hzMesh = new THREE.Mesh(new THREE.RingGeometry(hz[0] * AU, hz[1] * AU, 160, 1),
      new THREE.MeshBasicMaterial({ color: 0x3cff8a, transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false }));
    hzMesh.rotation.x = -Math.PI / 2; root.add(hzMesh); this.hzMesh = hzMesh;

    const sorted = planets.slice().sort((a, b) => a.a - b.a);
    sorted.forEach((p, idx) => {
      const inHZ = p.a >= hz[0] && p.a <= hz[1];
      const kind = classify(p, inHZ);
      const seed = seedFrom(p.name);
      const { map, emap } = makePlanetTexture(kind, seed);
      const b = mkBody({ ...p, name: p.name, type: 'exoplanet', sys: s, kind, inHZ, seed, color: new THREE.Color(0x9fd8ff) });
      const mat = new THREE.MeshStandardMaterial({ map, roughness: 1, metalness: 0, emissiveMap: emap, emissive: emap ? 0xffffff : 0x000000, emissiveIntensity: emap ? 1.2 : 0 });
      b.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), mat); b.mesh.userData.body = b; b.spin.add(b.mesh);
      b.tilt.rotation.z = (seed - 0.5) * 0.6;
      const rkm = p.r * 6371;
      b.trueR = rkm / 149597870.7 * AU;
      const prev = sorted[idx - 1], next = sorted[idx + 1];
      const gap = Math.min(prev ? p.a - prev.a : p.a, next ? next.a - p.a : p.a) * AU;
      b.dispR = Math.max(b.trueR, Math.min(0.16 * Math.sqrt(rkm / 1000), gap * 0.3, p.a * AU * 0.15));
      b.M0 = seed * 360; b.peri = seedFrom(p.name + 'w') * 360; b.node = seedFrom(p.name + 'n') * 360;
      b.inc = (seedFrom(p.name + 'i') - 0.5) * 4;
      // orbit line
      const pts = [];
      for (let k = 0; k <= 360; k++) { const E = (k / 360) * 2 * Math.PI; const M = (E - p.e * Math.sin(E)) * 180 / Math.PI; const q = keplerPos(p.a, p.e, b.inc, b.node, b.peri, M); pts.push(new THREE.Vector3(q[0] * AU, q[2] * AU, -q[1] * AU)); }
      b.orbitLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: inHZ ? 0x6dffa8 : 0x5d8fd6, transparent: true, opacity: 0.5, depthWrite: false }));
      root.add(b.orbitLine);
      mkLabel(b, 't-planet', new THREE.Color(inHZ ? 0x6dffa8 : 0x9fd8ff));
      bodies.push(b);
    });
    const outer = Math.max(sorted.length ? sorted[sorted.length - 1].a * (1 + sorted[sorted.length - 1].e) : 0, s.companion ? s.companion.a * 1.6 : 0, hz[1]);
    s.viewDist = Math.max(s.viewDist || 0, primary.dispR * 12);
    this.applyScaleExo(bodies);
    return { root, bodies };
  }

  glowTex() {
    if (this._glow) return this._glow;
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.15, 'rgba(255,255,255,0.5)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.1)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
    this._glow = new THREE.CanvasTexture(c); return this._glow;
  }

  applyScaleExo(bodies = this.exoBodies) {
    const t = this.getScaleMode() === 'true';
    for (const b of bodies) {
      const r = t ? b.trueR : b.dispR;
      b.spin.scale.setScalar(r);
      if (b.glow) b.glow.scale.setScalar(r * (t ? 12 : 6));
    }
  }
  displayRadius(b) { return this.getScaleMode() === 'true' ? b.trueR : b.dispR; }

  updateExo(jd) {
    const AU = this.AU, q = [0, 0, 0];
    for (const b of this.exoBodies) {
      if (b.type === 'exoplanet') {
        const M = b.M0 + (360 / b.per) * (jd - 2451545.0);
        keplerPos(b.a, b.e, b.inc, b.node, b.peri, M, q);
        b.group.position.set(q[0] * AU, q[2] * AU, -q[1] * AU);
        b.spin.rotation.y = (jd % 1) * 2 * Math.PI * 0.3;
      } else if (b.isCompanion) {
        const o = b.orbit, M = (360 / o.per) * (jd - 2451545.0) + 120;
        // relative orbit of B around A (A at origin; a simplification of the barycentric motion)
        keplerPos(o.a, o.e, 12, 40, 232, M, q);
        b.group.position.set(q[0] * AU, q[2] * AU, -q[1] * AU);
      }
      if (b.type === 'exostar') b.spin.rotation.y = (jd / 25) * 2 * Math.PI;
    }
  }

  // ---------- system switching ----------
  setCurrent(s) {
    if (this.exoRoot) {
      this.scene.remove(this.exoRoot);
      this.exoRoot.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { o.material.map && o.material.map.dispose(); o.material.emissiveMap && o.material.emissiveMap.dispose(); o.material.dispose(); } if (o.isCSS2DObject) o.element.remove(); });
      this.exoRoot = null; this.exoBodies = [];
    }
    this.current = s;
    this.origin.copy(this.posUnits(s));
    this.field.position.copy(this.origin).negate();
    this.markers.position.copy(this.origin).negate();
    if (!s.sol) {
      const { root, bodies } = this.buildExo(s);
      this.exoRoot = root; this.exoBodies = bodies; this.scene.add(root);
      this.sunLight.color.copy(tempToColor(s.teff));
      this.sunLight.intensity = 3.2;
    } else { this.sunLight.color.set(0xffffff); this.sunLight.intensity = 3.2; }
    this.onSystemChange(s);
  }

  // smooth flight across interstellar distances with a mid-flight origin rebase
  flyToSystem(s, { galactic = false } = {}) {
    const P = this.posUnits(s).sub(this.origin);   // destination relative to current origin
    const cam = this.camera.position.clone(), tgt = this.controls.target.clone();
    const d0 = Math.max(cam.distanceTo(tgt), 1e-6);
    const dist = P.length();
    const dEnd = galactic ? this.PC * 7 : s.viewDist;
    const dPeak = galactic ? dEnd : Math.max(dist * 0.9, d0, dEnd * 1.5);
    const dir0 = cam.clone().sub(tgt).normalize();
    let dir1 = dir0.clone().add(new THREE.Vector3(0, 0.55, 0)).normalize();
    if (!galactic && dist > 0) dir1 = P.clone().normalize().negate().add(new THREE.Vector3(0, 0.6, 0)).normalize().lerp(dir1, 0.4).normalize();
    const dur = galactic ? 2.6 : dist === 0 ? 1.8 : 3.2 + 1.8 * smooth(4, 10, Math.log10(dist));
    this.flight = { t: 0, dur, P, tgt0: tgt, d0, dPeak, dEnd, dir0, dir1, sys: s, rebased: dist === 0, galactic };
    if (dist === 0 && !galactic && s !== this.current) this.flight.rebased = false;
  }

  updateFlight(dt) {
    const f = this.flight; if (!f) return false;
    f.t = Math.min(1, f.t + dt / f.dur);
    const k = f.t;
    const s = f.galactic ? ease(k) : smooth(0.2, 0.8, k);
    const target = f.tgt0.clone().lerp(f.P, s);
    let logd;
    const L0 = Math.log(f.d0), Lp = Math.log(f.dPeak), L1 = Math.log(f.dEnd);
    if (f.galactic) logd = L0 + (L1 - L0) * ease(k);
    else logd = k < 0.5 ? L0 + (Lp - L0) * ease(k * 2) : Lp + (L1 - Lp) * ease((k - 0.5) * 2);
    const dir = f.dir0.clone().lerp(f.dir1, ease(k)).normalize();
    const cam = target.clone().addScaledVector(dir, Math.exp(logd));
    if (!f.rebased && k >= 0.5 && !f.galactic) { f.rebased = true; this.setCurrent(f.sys); f.shift = f.P.clone(); }
    if (f.shift) { target.sub(f.shift); cam.sub(f.shift); }
    this.controls.target.copy(target); this.camera.position.copy(cam);
    if (k >= 1) { this.flight = null; if (!f.galactic) this.onArrive(f.sys); }
    return true;
  }

  update(jd, dt) {
    if (this.exoRoot) this.updateExo(jd);
    const camD = this.camera.position.length(); // distance from current system's star
    this.galactic = smooth(3e4, 6e5, camD);
    this.ringMat.uniforms.uOpacity.value = 0.85 * this.galactic;
    if (this.hzMesh) {
      this.hzMesh.visible = this.galactic < 0.9;
      const hzOut = this.current.hz ? this.current.hz[1] * this.AU : 1;
      this.hzMesh.material.opacity = 0.11 * smooth(1.2, 3.5, camD / hzOut);
    }
    const camPc = this.camera.position.clone().add(this.origin).divideScalar(this.PC);
    const viewPc = Math.max(camD / this.PC, 1e-9);
    for (const s of this.systems) {
      const dc = s.pc.distanceTo(camPc);
      s.labelObj.visible = this.galactic > 0.5 && s !== this.current && (s.curated ? dc < viewPc * 40 : dc < viewPc * 2.2);
    }
    if (this.current && this.current.labelObj) this.current.labelObj.visible = this.galactic > 0.5;
    if (this.brightLabels) for (const o of this.brightLabels) o.visible = this.galactic > 0.5 && viewPc > 3;
  }

  // screen-space pick of system markers (galactic view)
  pick(ndc, w, h) {
    if (this.galactic < 0.5) return null;
    let best = null, bd = 14; const v = new THREE.Vector3();
    for (const s of this.systems) {
      if (!s.labelObj.visible && s !== this.current) continue;
      v.copy(s.pc).multiplyScalar(this.PC).sub(this.origin).project(this.camera);
      if (v.z > 1) continue;
      const d = Math.hypot((v.x - ndc.x) * w / 2, (v.y - ndc.y) * h / 2);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  distanceLy(s) { return s.dist_pc * LY_PC; }
}
export { LY_PC };
