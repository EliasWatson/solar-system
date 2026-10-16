// Bake exoplanet systems from NASA Exoplanet Archive (pscomppars). Run: node scripts/fetch-exoplanets.mjs
import fs from 'fs';
const CURATED = ['Proxima Cen', "Barnard's star", 'TRAPPIST-1', 'tau Cet', 'eps Eri', 'Kepler-452', 'Kepler-186', '51 Peg', 'HD 209458',
  'GJ 581', '55 Cnc', 'HR 8799', 'TOI-700', 'LHS 1140', 'Kepler-22', 'Kepler-442', 'Kepler-90', 'Kepler-16', 'Kepler-11', 'K2-18',
  'HD 189733', 'WASP-12', 'WASP-121', 'KELT-9', 'TOI-270', 'Kepler-1649', 'PSR B1257+12', 'bet Pic', '51 Eri', 'Ross 128', "Teegarden's Star",
  'GJ 1214', 'LTT 1445 A', 'L 98-59', 'ups And', '47 UMa', 'HD 219134', 'Wolf 1061', 'GJ 667 C', 'AU Mic', 'Kepler-62', 'TOI-1338', 'HD 10180', 'gam Cep', 'WD 1856+534', 'HD 62509', 'nu Oph', 'KELT-9'];
const COLS = 'pl_name,hostname,sy_dist,ra,dec,st_teff,st_rad,st_mass,st_lum,st_spectype,st_logg,st_vsin,st_rotp,sy_snum,sy_pnum,pl_orbper,pl_orbsmax,pl_orbeccen,pl_rade,pl_bmasse,pl_eqt,pl_orbincl,disc_year,discoverymethod';
async function tap(where) {
  const u = 'https://exoplanetarchive.ipac.caltech.edu/TAP/sync?format=json&query=' + encodeURIComponent(`select ${COLS} from pscomppars where ${where}`);
  const r = await fetch(u); if (!r.ok) throw new Error(await r.text()); return r.json();
}
const near = await tap('sy_dist < 15.34'); // ~50 ly
const cur = await tap('hostname in (' + CURATED.map(h => `'${h.replace(/'/g, "''")}'`).join(',') + ')');
const rows = [...near, ...cur];
const sys = {};
for (const r of rows) {
  if (r.sy_dist == null) continue;
  const s = sys[r.hostname] ||= { host: r.hostname, dist_pc: r.sy_dist, ra: r.ra, dec: r.dec, teff: r.st_teff, rad: r.st_rad, mass: r.st_mass,
    lum: r.st_lum, spec: r.st_spectype, logg: r.st_logg, vsini: r.st_vsin, rotp: r.st_rotp, nstars: r.sy_snum, curated: CURATED.includes(r.hostname), planets: {} };
  s.planets[r.pl_name] = { name: r.pl_name, per: r.pl_orbper, a: r.pl_orbsmax, e: r.pl_orbeccen, rade: r.pl_rade, masse: r.pl_bmasse,
    eqt: r.pl_eqt, incl: r.pl_orbincl, year: r.disc_year, method: r.discoverymethod };
}
const out = Object.values(sys).map(s => ({ ...s, planets: Object.values(s.planets).sort((a, b) => (a.a ?? a.per / 300) - (b.a ?? b.per / 300)) }));
out.sort((a, b) => a.dist_pc - b.dist_pc);
const missing = CURATED.filter(h => !sys[h]);
fs.writeFileSync('src/data/exoplanets.json', JSON.stringify({ fetched: new Date().toISOString(), source: 'NASA Exoplanet Archive pscomppars', systems: out }));
console.log(out.length, 'systems,', out.reduce((n, s) => n + s.planets.length, 0), 'planets; missing curated:', missing.join(', ') || 'none');
