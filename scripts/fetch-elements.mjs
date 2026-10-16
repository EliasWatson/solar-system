// Fetch osculating elements from JPL SBDB for small bodies. Run: node scripts/fetch-elements.mjs
import fs from 'fs';
const bodies = [
 ['Pluto','134340','dwarf'],['Ceres','1','dwarf'],['Eris','136199','dwarf'],['Haumea','136108','dwarf'],['Makemake','136472','dwarf'],
 ['Vesta','4','asteroid'],['Pallas','2','asteroid'],['Juno','3','asteroid'],['Hygiea','10','asteroid'],['Psyche','16','asteroid'],
 ['Eros','433','asteroid'],['Bennu','101955','asteroid'],['Apophis','99942','asteroid'],['Ryugu','162173','asteroid'],['Itokawa','25143','asteroid'],
 ['Arrokoth','486958','kbo'],['Sedna','90377','dwarf'],
];
const out=[];
for (const [name,id,type] of bodies){
  const r = await (await fetch(`https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=${id}&phys-par=1&full-prec=1`)).json();
  const el = Object.fromEntries(r.orbit.elements.map(e=>[e.name, parseFloat(e.value)]));
  const phys = Object.fromEntries((r.phys_par||[]).map(e=>[e.name, parseFloat(e.value)]));
  out.push({name,type,epoch:parseFloat(r.orbit.epoch),a:el.a,e:el.e,i:el.i,node:el.om,peri:el.w,M:el.ma,n:el.n,
    radius: phys.diameter? phys.diameter/2 : (phys.radius||null), fullname:r.object.fullname});
  console.log(name, el.a, r.orbit.epoch);
}
fs.writeFileSync('src/smallbodies.json', JSON.stringify(out,null,1));
