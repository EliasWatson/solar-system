const D2R = Math.PI / 180;
export const OBLIQ = 23.43928 * D2R;
export const AU_KM = 149597870.7;

export const jdFromMs = (ms) => ms / 86400000 + 2440587.5;

function solveKepler(M, e) {
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 30; k++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return E;
}

// Heliocentric ecliptic J2000 position (AU) from classical elements (deg)
export function keplerPos(a, e, i, node, peri, Mdeg, out = [0, 0, 0]) {
  const M = ((Mdeg % 360) + 540) % 360 - 180;
  const E = solveKepler(M * D2R, e);
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  return rotate(xp, yp, i * D2R, node * D2R, peri * D2R, out);
}
function rotate(xp, yp, i, O, w, out) {
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(i), si = Math.sin(i);
  out[0] = (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp;
  out[1] = (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp;
  out[2] = (sw * si) * xp + (cw * si) * yp;
  return out;
}

// returns {a,e,i,node,peri,M} at jd
export function elementsAt(body, jd) {
  if (body.kind === 'jpl') {
    const T = (jd - 2451545.0) / 36525;
    const [b, r] = body.el;
    const a = b[0] + r[0] * T, e = b[1] + r[1] * T, i = b[2] + r[2] * T, L = b[3] + r[3] * T, vp = b[4] + r[4] * T, O = b[5] + r[5] * T;
    return { a, e, i, node: O, peri: vp - O, M: L - vp };
  }
  const o = body.osc;
  return { a: o.a, e: o.e, i: o.i, node: o.node, peri: o.peri, M: o.M + o.n * (jd - o.epoch) };
}

export function helioPos(body, jd, out) {
  const el = elementsAt(body, jd);
  return keplerPos(el.a, el.e, el.i, el.node, el.peri, el.M, out);
}

export function orbitPoints(body, jd, n = 512) {
  const el = elementsAt(body, jd);
  const pts = [];
  // sample uniformly in eccentric anomaly for smooth ellipses
  for (let k = 0; k <= n; k++) {
    const E = (k / n) * 2 * Math.PI;
    const M = (E - el.e * Math.sin(E)) / D2R;
    pts.push(keplerPos(el.a, el.e, el.i, el.node, el.peri, M, [0, 0, 0]));
  }
  return pts;
}

export function periodDays(body, jd) {
  if (body.kind === 'osc') return 360 / body.osc.n;
  const a = elementsAt(body, jd).a;
  return 365.256898 * Math.pow(a, 1.5);
}

// Moon (geocentric ecliptic, km) – Schlyter's simplified elements
export function moonGeo(jd, out) {
  const d = jd - 2451543.5;
  const N = 125.1228 - 0.0529538083 * d, w = 318.0634 + 0.1643573223 * d, M = 115.3654 + 13.0649929509 * d;
  return keplerPos(384400, 0.0549, 5.1454, N, w, M, out);
}

// ecliptic (x,y,z) → three.js (x, z, -y)
export const toThree = (v, target) => target.set(v[0], v[2], -v[1]);

// pole RA/Dec (deg) → ecliptic unit vector
export function poleEcliptic(ra, dec) {
  ra *= D2R; dec *= D2R;
  const x = Math.cos(dec) * Math.cos(ra), y = Math.cos(dec) * Math.sin(ra), z = Math.sin(dec);
  return [x, y * Math.cos(OBLIQ) + z * Math.sin(OBLIQ), -y * Math.sin(OBLIQ) + z * Math.cos(OBLIQ)];
}

// Greenwich mean sidereal time (rad)
export function gmst(jd) {
  const T = (jd - 2451545.0) / 36525;
  const g = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T;
  return (((g % 360) + 360) % 360) * D2R;
}
