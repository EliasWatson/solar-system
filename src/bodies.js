import small from './smallbodies.json';

// JPL "Approximate Positions of the Planets" (Standish), valid 1800–2050 AD.
// [a, e, I, L, varpi, Omega] and rates per Julian century, J2000 ecliptic.
export const PLANET_ELEMENTS = {
  Mercury: [[0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593], [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  Venus:   [[0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255], [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418]],
  Earth:   [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0], [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0]],
  Mars:    [[1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891], [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  Jupiter: [[5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  Saturn:  [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]],
  Uranus:  [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503], [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]],
  Neptune: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]],
};

// radius km, pole RA/Dec (IAU, deg), rotation period hours (negative = retrograde), texture
export const PHYS = {
  Sun:     { r: 695700, pole: [286.13, 63.87], rot: 609.12, tex: '2k_sun.jpg' },
  Mercury: { r: 2439.7, pole: [281.01, 61.41], rot: 1407.6, tex: '2k_mercury.jpg' },
  Venus:   { r: 6051.8, pole: [272.76, 67.16], rot: -5832.5, tex: '2k_venus_atmosphere.jpg' },
  Earth:   { r: 6371.0, pole: [0, 90], rot: 23.9345, tex: '2k_earth_daymap.jpg' },
  Mars:    { r: 3389.5, pole: [317.68, 52.89], rot: 24.6229, tex: '2k_mars.jpg' },
  Jupiter: { r: 69911, pole: [268.06, 64.50], rot: 9.925, tex: '2k_jupiter.jpg' },
  Saturn:  { r: 58232, pole: [40.59, 83.54], rot: 10.656, tex: '2k_saturn.jpg', ring: [74500, 140220] },
  Uranus:  { r: 25362, pole: [257.31, -15.18], rot: -17.24, tex: '2k_uranus.jpg' },
  Neptune: { r: 24622, pole: [299.36, 43.46], rot: 16.11, tex: '2k_neptune.jpg' },
  Pluto:   { r: 1188.3, pole: [132.99, -6.16], rot: -153.29, tex: '2k_moon.jpg', tint: 0xd9b48f },
  Ceres:   { r: 469.7, pole: [291.4, 66.8], rot: 9.07, tex: '2k_ceres_fictional.jpg' },
  Eris:    { r: 1163, rot: 378.9, tex: '2k_eris_fictional.jpg' },
  Haumea:  { r: 816, rot: 3.92, tex: '2k_haumea_fictional.jpg', squash: [1.0, 0.51, 0.78] },
  Makemake:{ r: 715, rot: 22.8, tex: '2k_makemake_fictional.jpg' },
  Sedna:   { r: 500, rot: 10.3, tex: '2k_moon.jpg', tint: 0xc06040 },
  Arrokoth:{ r: 18, rot: 15.9, tex: '2k_moon.jpg', tint: 0xb06a50, squash: [1.0, 0.45, 0.6] },
};

const TYPE_LABEL = { star: 'Star', planet: 'Planet', dwarf: 'Dwarf planet', asteroid: 'Asteroid', kbo: 'Kuiper belt object', moon: 'Moon' };
export { TYPE_LABEL };

export function buildBodyList() {
  const list = [];
  list.push({ name: 'Sun', type: 'star', ...PHYS.Sun, color: 0xffcc66 });
  const pcolors = { Mercury: 0xb5a89a, Venus: 0xe8c58a, Earth: 0x6fa8ff, Mars: 0xd46a3c, Jupiter: 0xd8b48a, Saturn: 0xe5d19c, Uranus: 0x9fe3ea, Neptune: 0x5577ff };
  for (const name of Object.keys(PLANET_ELEMENTS))
    list.push({ name, type: 'planet', kind: 'jpl', el: PLANET_ELEMENTS[name], ...PHYS[name], color: pcolors[name] });
  for (const b of small) {
    const p = PHYS[b.name] || { r: b.radius || 1, rot: 6, tex: '2k_moon.jpg', tint: 0x9a8f84 };
    list.push({ name: b.name, type: b.type, fullname: b.fullname, kind: 'osc', osc: b, ...p,
      r: p.r || b.radius, color: b.type === 'asteroid' ? 0xa89a8a : 0xc9b8ff });
  }
  // Moons: simplified orbits in parent's equatorial plane (Earth's Moon uses ecliptic elements).
  const moons = [
    ['Moon', 'Earth', 1737.4, 384400, 27.321661, 0, '2k_moon.jpg', 0xffffff],
    ['Phobos', 'Mars', 11.27, 9376, 0.31891, 35, '2k_moon.jpg', 0x8a7a6a],
    ['Deimos', 'Mars', 6.2, 23463, 1.26244, 200, '2k_moon.jpg', 0x9a8a7a],
    ['Io', 'Jupiter', 1821.6, 421700, 1.769138, 106.07719, '2k_ceres_fictional.jpg', 0xffe070],
    ['Europa', 'Jupiter', 1560.8, 671034, 3.551181, 175.73161, '2k_moon.jpg', 0xf0e6d0],
    ['Ganymede', 'Jupiter', 2634.1, 1070412, 7.154553, 120.55883, '2k_moon.jpg', 0xc8bba8],
    ['Callisto', 'Jupiter', 2410.3, 1882709, 16.689018, 84.44459, '2k_moon.jpg', 0x8a7f72],
    ['Titan', 'Saturn', 2574.7, 1221870, 15.945, 0, '2k_venus_atmosphere.jpg', 0xffb060],
    ['Enceladus', 'Saturn', 252.1, 238020, 1.370218, 90, '2k_moon.jpg', 0xffffff],
    ['Rhea', 'Saturn', 763.8, 527108, 4.518212, 200, '2k_moon.jpg', 0xdddddd],
    ['Titania', 'Uranus', 788.4, 435910, 8.706234, 0, '2k_moon.jpg', 0xbbbbbb],
    ['Oberon', 'Uranus', 761.4, 583520, 13.463234, 120, '2k_moon.jpg', 0xaaaaaa],
    ['Triton', 'Neptune', 1353.4, 354759, -5.876854, 0, '2k_moon.jpg', 0xe8d8d0],
    ['Charon', 'Pluto', 606, 19591, 6.387230, 0, '2k_moon.jpg', 0xb0a8a0],
  ];
  for (const [name, parent, r, dist, period, L0, tex, tint] of moons)
    list.push({ name, type: 'moon', parent, r, dist, period, L0, tex, tint, rot: Math.abs(period) * 24, color: 0xcccccc });
  return list;
}
