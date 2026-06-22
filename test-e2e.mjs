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

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`API ${res.status} on ${path}`);
  return res.json();
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
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
})();
