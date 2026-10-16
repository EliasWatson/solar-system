// Type-aware procedural star rendering: limb darkening, animated granulation, spots, faculae, flares.
import * as THREE from 'three';
import { tempToColor } from './planetgen.js';

export const starTime = { value: 0 };

const NOISE = `
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.); const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.; vec4 s1=floor(b1)*2.+1.; vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.); m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

const VS = `
varying vec3 vObj; varying vec3 vN; varying vec3 vV;
#include <common>
#include <logdepthbuf_pars_vertex>
void main(){
  vObj = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;

const FS = `
uniform float uTime, uCells, uContrast, uSpots, uFaculae, uLimb, uBright, uSeed, uPuffy, uFlare, uBands;
uniform vec3 uColor, uFlareDir;
varying vec3 vObj; varying vec3 vN; varying vec3 vV;
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE}
void main(){
  vec3 p = vObj;
  float mu = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  float t = uTime;
  // granulation: two octaves of drifting noise; ridged term gives dark intergranular lanes
  float n1 = snoise(p * uCells + vec3(uSeed, 0.0, t * 0.06));
  float n2 = snoise(p * uCells * 2.3 + vec3(0.0, uSeed, -t * 0.09));
  float lanes = 1.0 - abs(n1);
  float gran = mix(lanes, 0.5 + 0.5 * n2, 0.35);
  // large-scale supergranulation / giant convection
  float big = snoise(p * 1.7 + vec3(uSeed * 3.0, t * 0.004, 0.0));
  // spots (follow rotation via object-space coords), with umbra/penumbra
  float sp = 0.65 * snoise(p * 4.5 + vec3(uSeed * 7.0, 0.0, t * 0.0015)) + 0.35 * snoise(p * 11.0 + vec3(0.0, uSeed, 0.0));
  float lat = abs(p.y);
  float belt = smoothstep(0.75, 0.25, lat) * smoothstep(0.0, 0.12, lat);
  float spotMask = uSpots * belt * smoothstep(0.52, 0.66, sp);
  float umbra = uSpots * belt * smoothstep(0.66, 0.78, sp);
  // faculae: bright patches around active regions, mostly visible near the limb
  float fac = uFaculae * belt * smoothstep(0.32, 0.5, sp) * (1.0 - smoothstep(0.5, 0.66, sp)) * pow(1.0 - mu, 1.5);
  // brown-dwarf style cloud bands
  float bands = uBands * (0.5 + 0.5 * sin(p.y * 14.0 + snoise(p * 3.0 + t * 0.01) * 2.0));
  // limb darkening (quadratic law) + slight reddening at the limb
  float one = 1.0 - mu;
  float limb = 1.0 - uLimb * one - 0.25 * uLimb * one * one;
  vec3 col = uColor * uBright;
  col *= 1.0 + uContrast * ((gran - 0.6) * 2.0 + big * 0.5);
  col *= 1.0 - 0.45 * spotMask - 0.4 * umbra;
  col *= 1.0 - 0.35 * bands;
  col += uColor * fac * 1.2;
  col *= limb;
  col *= mix(vec3(1.0, 0.72, 0.5), vec3(1.0), pow(mu, 0.35 * uLimb + 0.05));
  // flare: bright blob that brightens fast and fades
  float fd = distance(p, uFlareDir);
  col += vec3(1.0, 0.95, 1.0) * uFlare * (exp(-fd * fd * 60.0) * 6.0 + 0.25);
  float alpha = mix(1.0, smoothstep(0.0, 0.45, mu), uPuffy);
  gl_FragColor = vec4(col, alpha);
  #include <logdepthbuf_fragment>
}`;

const SPEC_FROM_T = [[30000, 'O'], [10000, 'B'], [7500, 'A'], [6000, 'F'], [5200, 'G'], [3700, 'K'], [2400, 'M'], [1300, 'L'], [0, 'T']];
const NAMES = { O: 'blue', B: 'blue-white', A: 'white', F: 'yellow-white', G: 'yellow', K: 'orange', M: 'red', L: 'brown', T: 'brown' };

// Classify a star from archive parameters
export function classifyStar(st) {
  const name = st.host || st.name || '';
  const spec = (st.spec || '').trim();
  const T = st.teff || 5772, R = st.rad, g = st.logg;
  if (/^PSR/.test(name)) return { kind: 'pulsar', label: 'Pulsar (neutron star)', letter: 'NS' };
  if (/^D[ABCOQZX]/.test(spec) || (g != null && g > 7) || (R != null && R < 0.03 && T > 3000)) return { kind: 'wd', label: `White dwarf${spec ? ` (${spec})` : ''}`, letter: 'D' };
  const letter = (spec.match(/^[OBAFGKMLT]/) || [])[0] || SPEC_FROM_T.find(([t]) => T >= t)[1];
  const lumCls = (spec.match(/(Ia|Ib|III|II|IV|V)/) || [])[0];
  let kind = 'dwarf';
  if ((R != null && R > 30) || /I[ab]?\b/.test(lumCls || '') && !/V|III|II$/.test(lumCls || '')) kind = 'supergiant';
  else if (lumCls === 'III' || lumCls === 'II' || (g != null && g < 3.5) || (R != null && R > 3.5 && T < 7000)) kind = 'giant';
  else if (lumCls === 'IV' || (g != null && g < 3.9)) kind = 'subgiant';
  let label;
  if (kind === 'supergiant') label = `${NAMES[letter]} supergiant`;
  else if (kind === 'giant') label = `${NAMES[letter]} giant`;
  else if (kind === 'subgiant') label = `${NAMES[letter]} subgiant`;
  else if (letter === 'L' || letter === 'T') label = 'Brown dwarf';
  else label = { O: 'Blue main-sequence star', B: 'Blue-white main-sequence star', A: 'White main-sequence star', F: 'Yellow-white dwarf', G: 'Yellow dwarf (Sun-like)', K: 'Orange dwarf', M: 'Red dwarf' }[letter];
  return { kind, label: `${label[0].toUpperCase() + label.slice(1)}${spec ? ` · ${spec}` : ` · ${letter}-type`}`, letter };
}

const PRESETS = {
  O: { cells: 70, contrast: 0.04, spots: 0, fac: 0, limb: 0.3, bright: 1.25 },
  B: { cells: 70, contrast: 0.05, spots: 0, fac: 0, limb: 0.33, bright: 1.2 },
  A: { cells: 60, contrast: 0.07, spots: 0, fac: 0, limb: 0.4, bright: 1.15 },
  F: { cells: 48, contrast: 0.12, spots: 0.08, fac: 0.3, limb: 0.5, bright: 1.1 },
  G: { cells: 40, contrast: 0.17, spots: 0.25, fac: 0.6, limb: 0.6, bright: 0.95 },
  K: { cells: 32, contrast: 0.2, spots: 0.4, fac: 0.5, limb: 0.66, bright: 1.15 },
  M: { cells: 24, contrast: 0.24, spots: 0.65, fac: 0.2, limb: 0.72, bright: 1.35 },
  L: { cells: 20, contrast: 0.15, spots: 0, fac: 0, limb: 0.6, bright: 1.1, bands: 0.8 },
  T: { cells: 20, contrast: 0.12, spots: 0, fac: 0, limb: 0.55, bright: 0.9, bands: 1 },
};

export function starParams(st, cls) {
  const L = st.lum != null ? Math.pow(10, st.lum) : Math.pow(st.rad || 1, 2) * Math.pow((st.teff || 5772) / 5772, 4);
  const p = { ...(PRESETS[cls.letter] || PRESETS.G), puffy: 0, bands: (PRESETS[cls.letter] || {}).bands || 0, L };
  if (cls.kind === 'giant' || cls.kind === 'supergiant') Object.assign(p, { cells: cls.kind === 'supergiant' ? 3 : 5, contrast: 0.42, spots: 0, fac: 0, limb: 0.85, puffy: 0.8, bright: 1.0 });
  if (cls.kind === 'subgiant') p.cells *= 0.7;
  if (cls.kind === 'wd') Object.assign(p, { cells: 90, contrast: 0.02, spots: 0, fac: 0, limb: 0.25, bright: 2.2 });
  if (cls.kind === 'pulsar') Object.assign(p, { cells: 120, contrast: 0.02, spots: 0, fac: 0, limb: 0.15, bright: 2.6 });
  p.flares = cls.letter === 'M' && cls.kind === 'dwarf';
  // glow strength: hotter/more luminous stars glow harder
  p.glow = Math.min(2.0, 0.75 + 0.45 * Math.log10(L + 1) + ((st.teff || 5772) > 7500 ? 0.35 : 0));
  return p;
}

export function makeStarMaterial(st, cls, seed = Math.random()) {
  const p = starParams(st, cls);
  // exaggerate blackbody chroma a little so tone mapping doesn't wash every star to white
  const bb = tempToColor(cls.kind === 'pulsar' ? 30000 : st.teff);
  const color = new THREE.Color(Math.pow(bb.r, 1.6), Math.pow(bb.g, 1.6), Math.pow(bb.b, 1.6));
  const mx = Math.max(color.r, color.g, color.b); color.multiplyScalar(1 / mx);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, transparent: p.puffy > 0,
    uniforms: {
      uTime: starTime, uCells: { value: p.cells }, uContrast: { value: p.contrast }, uSpots: { value: p.spots }, uFaculae: { value: p.fac },
      uLimb: { value: p.limb }, uBright: { value: p.bright }, uSeed: { value: seed * 50 }, uPuffy: { value: p.puffy }, uBands: { value: p.bands },
      uFlare: { value: 0 }, uFlareDir: { value: new THREE.Vector3(1, 0, 0) }, uColor: { value: color },
    },
  });
  mat.userData.params = p;
  mat.userData.flare = { next: 4 + Math.random() * 10, t: -1 };
  return mat;
}

// occasional flares on M dwarfs
export function tickFlares(mat, dt) {
  const f = mat.userData.flare; if (!mat.userData.params.flares) return;
  if (f.t < 0) {
    f.next -= dt;
    if (f.next <= 0) { f.t = 0; const v = new THREE.Vector3().randomDirection(); v.y *= 0.5; mat.uniforms.uFlareDir.value.copy(v.normalize()); f.peak = 0.5 + Math.random() * 0.8; }
  } else {
    f.t += dt;
    const rise = 0.35, decay = 2.8;
    mat.uniforms.uFlare.value = f.peak * (f.t < rise ? f.t / rise : Math.exp(-(f.t - rise) / (decay / 3)));
    if (f.t > rise + decay) { f.t = -1; f.next = 8 + Math.random() * 18; mat.uniforms.uFlare.value = 0; }
  }
}

// rotating radio/X-ray beams for pulsars
export function makePulsarBeams(glowTex) {
  const g = new THREE.Group();
  const geo = new THREE.ConeGeometry(0.35, 6, 40, 1, true);
  geo.translate(0, -3, 0);
  const c = document.createElement('canvas'); c.width = 4; c.height = 128; const x = c.getContext('2d');
  const grd = x.createLinearGradient(0, 0, 0, 128); grd.addColorStop(0, 'rgba(200,225,255,0.9)'); grd.addColorStop(1, 'rgba(160,200,255,0)');
  x.fillStyle = grd; x.fillRect(0, 0, 4, 128);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.4, 1.6, 2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const a = new THREE.Mesh(geo, mat); a.rotation.x = Math.PI; // pointing +y
  const b = new THREE.Mesh(geo, mat);                          // pointing -y
  g.add(a, b);
  const holder = new THREE.Group(); holder.add(g); g.rotation.z = 0.6; // magnetic axis tilted from spin axis
  holder.userData.beam = g;
  return holder;
}
