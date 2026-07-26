// PocketBase collection setup script.
// Run: npx tsx scripts/setup-pocketbase.ts
//
// Creates all required collections via the PocketBase Admin API.
// Idempotent: skips collections that already exist.

import PocketBase from 'pocketbase';

const PB_URL = process.env.POCKETBASE_URL || 'https://pb.dvcklab.com';
const ADMIN_EMAIL = process.env.POCKETBASE_ADMIN_EMAIL || 'ddarm4@gmail.com';
const ADMIN_PASSWORD = process.env.POCKETBASE_ADMIN_PASSWORD || '';

async function main() {
  const pb = new PocketBase(PB_URL);

  console.log(`[setup] Connecting to PocketBase at ${PB_URL}`);
  await pb.collection('_superusers').authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
  console.log('[setup] Authenticated as superuser');

  // --- Add 'role' field to users collection ---
  await ensureField(pb, 'users', 'role', {
    name: 'role',
    type: 'select',
    required: false,
    options: { values: ['user', 'admin'], maxSelect: 1 },
  });
  console.log('[setup] users.role field ensured');

  // --- aldi_products ---
  await ensureCollection(pb, 'aldi_products', [
    textField('sku', true),
    textField('name', true),
    textField('brand_name'),
    textField('slug'),
    textField('selling_size'),
    numberField('price_cents'),
    numberField('price_comparison_cents'),
    textField('price_comparison_display'),
    textField('currency'),
    textField('categories_json'),
    textField('primary_image'),
    textField('assets_json'),
    boolField('not_for_sale'),
    boolField('discontinued'),
    textField('weight_type'),
    textField('raw_json', true),
    dateField('synced_at'),
  ], { listRule: '', viewRule: '', createRule: null, updateRule: null, deleteRule: null });
  await ensureIndex(pb, 'aldi_products', 'idx_aldi_sku', 'sku', true);
  await ensureIndex(pb, 'aldi_products', 'idx_aldi_name', 'name');
  await ensureIndex(pb, 'aldi_products', 'idx_aldi_brand', 'brand_name');
  console.log('[setup] aldi_products collection ready');

  // --- off_products ---
  await ensureCollection(pb, 'off_products', [
    textField('ean', true),
    textField('product_name'),
    textField('brand'),
    textField('quantity'),
    textField('categories'),
    textField('image_url'),
    textField('countries'),
  ], { listRule: '', viewRule: '', createRule: null, updateRule: null, deleteRule: null });
  await ensureIndex(pb, 'off_products', 'idx_off_ean', 'ean', true);
  await ensureIndex(pb, 'off_products', 'idx_off_brand', 'brand');
  console.log('[setup] off_products collection ready');

  // --- ean_to_aldi ---
  await ensureCollection(pb, 'ean_to_aldi', [
    textField('ean', true),
    textField('aldi_sku', true),
    numberField('score', true),
    textField('method', true),
    dateField('verified_at'),
  ], { listRule: '', viewRule: '', createRule: null, updateRule: null, deleteRule: null });
  await ensureIndex(pb, 'ean_to_aldi', 'idx_ean_aldi_unique', 'ean,aldi_sku', true);
  await ensureIndex(pb, 'ean_to_aldi', 'idx_ean_to_aldi_ean', 'ean');
  console.log('[setup] ean_to_aldi collection ready');

  // --- manual_matches ---
  await ensureCollection(pb, 'manual_matches', [
    textField('ean', true),
    textField('aldi_sku', true),
    dateField('created_at'),
  ], { listRule: '', viewRule: '', createRule: '', updateRule: '', deleteRule: null });
  await ensureIndex(pb, 'manual_matches', 'idx_manual_ean', 'ean', true);
  console.log('[setup] manual_matches collection ready');

  // --- corrections ---
  await ensureCollection(pb, 'corrections', [
    textField('ean'),
    textField('was_sku', true),
    textField('now_sku', true),
    textField('cart_id'),
    dateField('created_at'),
  ], { listRule: null, viewRule: null, createRule: '', updateRule: null, deleteRule: null });
  await ensureIndex(pb, 'corrections', 'idx_corrections_ean', 'ean');
  console.log('[setup] corrections collection ready');

  // --- carts ---
  await ensureCollection(pb, 'carts', [
    textField('cart_id', true),
    dateField('updated_at'),
  ], { listRule: '', viewRule: '', createRule: '', updateRule: '', deleteRule: '' });
  await ensureIndex(pb, 'carts', 'idx_carts_cart_id', 'cart_id', true);
  console.log('[setup] carts collection ready');

  // --- cart_items ---
  await ensureCollection(pb, 'cart_items', [
    textField('cart_id', true),
    textField('aldi_sku', true),
    numberField('quantity', true),
    numberField('manual_price_cents'),
    dateField('added_at'),
  ], { listRule: '', viewRule: '', createRule: '', updateRule: '', deleteRule: '' });
  await ensureIndex(pb, 'cart_items', 'idx_cart_items_unique', 'cart_id,aldi_sku', true);
  await ensureIndex(pb, 'cart_items', 'idx_cart_items_sku', 'aldi_sku');
  console.log('[setup] cart_items collection ready');

  // --- meta ---
  await ensureCollection(pb, 'meta', [
    textField('key', true),
    textField('value', true),
    dateField('updated_at'),
  ], { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null });
  await ensureIndex(pb, 'meta', 'idx_meta_key', 'key', true);
  console.log('[setup] meta collection ready');

  console.log('\n[setup] All collections created successfully!');
}

// --- Helpers ---

function textField(name: string, required = false) {
  return { name, type: 'text', required, options: { maxSize: 1000000 } };
}

function numberField(name: string, required = false) {
  return { name, type: 'number', required, options: { min: null, max: null } };
}

function boolField(name: string) {
  return { name, type: 'bool', required: false, options: {} };
}

function dateField(name: string) {
  return { name, type: 'date', required: false, options: { min: '', max: '' } };
}

async function ensureCollection(
  pb: PocketBase,
  name: string,
  fields: any[],
  rules: { listRule: string | null; viewRule: string | null; createRule: string | null; updateRule: string | null; deleteRule: string | null },
) {
  try {
    await pb.collections.getFirstListItem(`name="${name}"`);
    console.log(`  [skip] collection "${name}" already exists`);
  } catch {
    await pb.collections.create({
      name,
      type: 'base',
      schema: fields,
      listRule: rules.listRule,
      viewRule: rules.viewRule,
      createRule: rules.createRule,
      updateRule: rules.updateRule,
      deleteRule: rules.deleteRule,
    });
    console.log(`  [created] collection "${name}"`);
  }
}

async function ensureField(pb: PocketBase, collection: string, fieldName: string, field: any) {
  const col = await pb.collections.getFirstListItem(`name="${collection}"`);
  const existing = (col.schema || []).find((f: any) => f.name === fieldName);
  if (existing) return;
  // Update the collection schema to add the field
  const schema = [...(col.schema || []), field];
  await pb.collections.update(col.id, { schema });
}

async function ensureIndex(pb: PocketBase, collection: string, indexName: string, columns: string, unique = false) {
  try {
    const col = await pb.collections.getFirstListItem(`name="${collection}"`);
    const existingIndexes: string[] = (col as any).indexes || [];
    const alreadyExists = existingIndexes.some((idx: string) => idx.includes(indexName));
    if (alreadyExists) return;

    const cols = columns.split(',').map((c) => `"${c.trim()}"`).join(',');
    const uniqueStr = unique ? 'UNIQUE ' : '';
    const idx = `CREATE ${uniqueStr}INDEX \`${indexName}\` ON \`${collection}\` (${cols})`;
    await pb.collections.update(col.id, {
      indexes: [...existingIndexes, idx],
    });
  } catch (e: any) {
    console.warn(`  [warn] index "${indexName}" on "${collection}": ${e.message}`);
  }
}

main().catch((e) => {
  console.error('[setup] FAILED:', e);
  process.exit(1);
});
