// Caching proxy for CelesTrak GP data: /api/gp?GROUP=stations  or  /api/gp?CATNR=25544
const ALLOWED_GROUPS = new Set(['stations', 'starlink', 'gps-ops', 'weather', 'geo', 'active', 'visual', 'science', 'galileo', 'oneweb', 'noaa', 'last-30-days']);
const TTL = 7200; // CelesTrak updates GP data ~every 2h; don't hammer it

export async function onRequestGet({ request, waitUntil }) {
  const url = new URL(request.url);
  const group = url.searchParams.get('GROUP');
  const catnr = url.searchParams.get('CATNR');
  let q;
  if (group && ALLOWED_GROUPS.has(group)) q = `GROUP=${group}`;
  else if (catnr && /^\d{1,9}$/.test(catnr)) q = `CATNR=${catnr}`;
  else return new Response('bad request', { status: 400 });

  const cache = caches.default;
  const key = new Request(`https://gp-cache.internal/${q}`);
  let res = await cache.match(key);
  if (res) return withHeaders(res, 'HIT');

  const upstream = await fetch(`https://celestrak.org/NORAD/elements/gp.php?${q}&FORMAT=json`, {
    headers: { 'User-Agent': 'solar.eliasw.app (Cloudflare Pages)' },
    cf: { cacheTtl: TTL, cacheEverything: true },
  });
  const body = await upstream.text();
  if (!upstream.ok || !body.trim().startsWith('[')) {
    return new Response(body || 'upstream error', { status: upstream.ok ? 502 : upstream.status });
  }
  res = new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` } });
  waitUntil(cache.put(key, res.clone()));
  return withHeaders(res, 'MISS');
}

function withHeaders(res, state) {
  const r = new Response(res.body, res);
  r.headers.set('Access-Control-Allow-Origin', '*');
  r.headers.set('Cache-Control', `public, max-age=${TTL / 4}`);
  r.headers.set('X-GP-Cache', state);
  return r;
}
