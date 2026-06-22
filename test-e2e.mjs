// End-to-end smoke test of the API + frontend logic.
// Mocks localStorage and document, exercises the same code paths the PWA does.

import { strict as assert } from 'node:assert';

const API = process.env.BASE_URL ? process.env.BASE_URL + '/api' : 'http://localhost:3000/api';

// Minimal localStorage shim
const _ls = {};
globalThis.localStorage = {
  getItem: (k) => _ls[k] ?? null,
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: (k) => { delete _ls[k]; },
};

// `api()` throws on non-2xx by default. `apiRaw()` returns the full
// Response object so we can inspect status codes, headers, and bodies
// for negative-path tests (rate limits, body size, dead cart 404, etc.).
async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`API ${res.status} on ${path}`);
  return res.json();
}

async function apiRaw(path, opts = {}) {
  return fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
}

let pass = 0, fail = 0;
function test(name, fn) {
  return fn().then(
    () => { console.log(`  PASS  ${name}`); pass++; },
    (e) => { console.log(`  FAIL  ${name}: ${e.message}`); fail++; }
  );
}

(async () => {
  const tests = [];

  console.log('\n=== /api/stats ===');
  const stats = await api('/stats');
  console.log(stats);
  tests.push(test('stats has aldi products', async () => {
    assert.ok(stats.aldi_products > 3000);
  }));
  tests.push(test('stats has ean matches', async () => {
    assert.ok(stats.ean_aldi_matches > 1000);
  }));

  await Promise.all(tests);
  const tests2 = [];
  console.log('\n=== Search ===');
  const search = await api('/search?q=haribo&limit=3');
  tests2.push(test('search returns haribo', async () => {
    assert.ok(search.items.length > 0);
    assert.equal(search.items[0].brand, 'HARIBO');
  }));

  console.log('\n=== Cart lifecycle ===');
  const { cartId } = await api('/cart', { method: 'POST' });
  tests2.push(test('cart has id', async () => assert.ok(cartId)));

  const thyme = search.items.find((p) => p.name.includes('Thyme')) || search.items[0];
  await api(`/cart/${cartId}/items`, { method: 'POST', body: JSON.stringify({ sku: thyme.sku, quantity: 3 }) });
  const after1 = await api(`/cart/${cartId}`);
  tests2.push(test('add 3 items', async () => {
    assert.equal(after1.items.length, 1);
    assert.equal(after1.items[0].quantity, 3);
    assert.equal(after1.subtotal_cents, thyme.priceCents * 3);
  }));

  await api(`/cart/${cartId}/items`, { method: 'POST', body: JSON.stringify({ sku: thyme.sku, quantity: 2 }) });
  const after2 = await api(`/cart/${cartId}`);
  tests2.push(test('quantity accumulates to 5', async () => {
    assert.equal(after2.items[0].quantity, 5);
  }));

  await api(`/cart/${cartId}/items/${thyme.sku}`, { method: 'PATCH', body: JSON.stringify({ quantity: 1 }) });
  const after3 = await api(`/cart/${cartId}`);
  tests2.push(test('PATCH to 1', async () => {
    assert.equal(after3.items[0].quantity, 1);
    assert.equal(after3.subtotal_cents, thyme.priceCents);
  }));

  await api(`/cart/${cartId}/items/${thyme.sku}`, { method: 'DELETE' });
  const after4 = await api(`/cart/${cartId}`);
  tests2.push(test('DELETE clears cart', async () => {
    assert.equal(after4.items.length, 0);
    assert.equal(after4.subtotal_cents, 0);
  }));

  await Promise.all(tests2);
  const tests3 = [];
  console.log('\n=== EAN lookup (matched) ===');
  const eanData = await api('/ean/4088700050538');
  tests3.push(test('ean matches thyme', async () => {
    assert.equal(eanData.matched, true);
    assert.equal(eanData.best.brand, 'STONEMILL');
    assert.equal(eanData.best.name, 'Thyme Leaves 25g');
  }));
  console.log(`  matched: ${eanData.best.name} @ ${eanData.best.priceDisplay} (score ${eanData.candidates[0].score})`);

  console.log('\n=== EAN lookup (unmatched OFF) ===');
  let eanUnmatched = null;
  try { eanUnmatched = await api('/ean/9300675001410'); } catch (e) { eanUnmatched = { error: e.message }; }
  console.log(`  result: ${JSON.stringify(eanUnmatched).slice(0, 200)}`);

  console.log('\n=== EAN lookup (unknown) ===');
  // Unknown EAN now returns 200 with matched:false (lets the user manually
  // match). Verify the response shape instead of expecting 404.
  const unknown = await api('/ean/0000000000000');
  tests3.push(test('unknown EAN returns matched:false', async () => {
    assert.strictEqual(unknown.matched, false);
    assert.strictEqual(unknown.canManualMatch, true);
  }));

  await Promise.all(tests3);

  const tests4 = [];
  console.log('\n=== Catalogue offline dump ===');
  const status = await api('/catalogue/status');
  tests4.push(test('catalogue/status reports counts', async () => {
    assert.ok(status.product_count > 3000);
    assert.ok(status.ean_count > 1000);
  }));
  console.log(`  ${status.product_count} products, ${status.ean_count} EANs, last_sync=${status.last_sync}`);

  const dump = await api('/catalogue/dump');
  tests4.push(test('catalogue/dump returns full product list', async () => {
    assert.equal(dump.products.length, status.product_count);
  }));
  tests4.push(test('catalogue/dump EAN map has right count', async () => {
    const parsed = dump.ean_map.split(';').filter(Boolean);
    assert.equal(parsed.length, status.ean_count);
    for (const pair of parsed.slice(0, 5)) {
      assert.ok(pair.includes(','), `pair ${pair} has no comma`);
    }
  }));
  tests4.push(test('catalogue/dump products have priceDisplay', async () => {
    const withPrice = dump.products.filter((p) => p.priceDisplay);
    assert.ok(withPrice.length > 1000, `expected most products to have priceDisplay, got ${withPrice.length}/${dump.products.length}`);
  }));

  await Promise.all(tests4);

  // -----------------------------------------------------------------
  // Security & hardening tests
  // -----------------------------------------------------------------
  const tests5 = [];
  console.log('\n=== Health endpoint ===');
  const health = await api('/health');
  tests5.push(test('health returns ok', async () => {
    assert.equal(health.status, 'ok');
    assert.ok(health.database.products > 3000, `expected >3000 products, got ${health.database.products}`);
    assert.ok(typeof health.database.matches === 'number');
    assert.ok(typeof health.database.manual_matches === 'number');
    assert.ok(typeof health.timestamp === 'string');
    assert.ok(health.last_sync !== undefined, 'last_sync should be present (even if null)');
  }));

  console.log('\n=== Cache-Control on cart routes ===');
  const newCartRes = await apiRaw('/cart', { method: 'POST' });
  const newCartId = (await newCartRes.json()).cartId;
  tests5.push(test('POST /cart sends no-store', async () => {
    assert.equal(newCartRes.headers.get('cache-control'), 'no-store');
  }));
  const readRes = await apiRaw(`/cart/${newCartId}`);
  tests5.push(test('GET /cart/:id sends no-store', async () => {
    assert.equal(readRes.headers.get('cache-control'), 'no-store');
  }));

  console.log('\n=== Dead-cart 404 ===');
  const deadRes = await apiRaw('/cart/00000000-0000-0000-0000-000000000000');
  tests5.push(test('GET /cart/<dead-uuid> returns 404', async () => {
    assert.equal(deadRes.status, 404);
    assert.equal(deadRes.headers.get('cache-control'), 'no-store');
  }));

  console.log('\n=== Body-size limit (4 KB cap) ===');
  // 5 KB of garbage — well over the 4 KB cap.
  const oversized = 'x'.repeat(5 * 1024);
  const tooBig = await apiRaw(`/cart/${newCartId}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sku: 'x', quantity: 1, junk: oversized }),
  });
  tests5.push(test('5 KB POST returns 413', async () => {
    assert.equal(tooBig.status, 413);
    const body = await tooBig.json();
    assert.equal(body.error, 'request body too large');
    assert.equal(body.max_bytes, 4096);
  }));
  // Verify a small body still works (the cart was just created so it's empty).
  const smallAdd = await apiRaw(`/cart/${newCartId}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sku: search.items[0].sku, quantity: 1 }),
  });
  tests5.push(test('small POST returns 200', async () => {
    assert.equal(smallAdd.status, 200);
  }));

  console.log('\n=== Rate limit on /api/catalogue/dump ===');
  // The dump limit is 3 burst / 0.1/s (1 per 10s). Send 4 quick requests;
  // the 4th should be 429 with Retry-After. Reset the bucket by waiting
  // briefly between blocks so this test is independent of test order.
  await new Promise((r) => setTimeout(r, 12_000));
  const dumpResults = [];
  for (let i = 0; i < 4; i++) {
    const r = await apiRaw('/catalogue/dump');
    dumpResults.push(r.status);
  }
  tests5.push(test('first 3 dump requests succeed, 4th is 429', async () => {
    assert.equal(dumpResults[0], 200, `req 1: ${dumpResults[0]}`);
    assert.equal(dumpResults[1], 200, `req 2: ${dumpResults[1]}`);
    assert.equal(dumpResults[2], 200, `req 3: ${dumpResults[2]}`);
    assert.equal(dumpResults[3], 429, `req 4: ${dumpResults[3]}`);
  }));
  const limitedRes = await apiRaw('/catalogue/dump');
  tests5.push(test('429 response has Retry-After header', async () => {
    // This 5th request should also be 429 (bucket is still empty).
    assert.equal(limitedRes.status, 429);
    const retryAfter = limitedRes.headers.get('retry-after');
    assert.ok(retryAfter, 'Retry-After header should be present');
    const seconds = parseInt(retryAfter, 10);
    assert.ok(seconds >= 1 && seconds <= 15, `Retry-After should be 1-15s, got ${seconds}`);
  }));

  // Clean up the test cart so we don't leave orphan rows.
  await apiRaw(`/cart/${newCartId}`, { method: 'DELETE' });

  await Promise.all(tests5);
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
})();
