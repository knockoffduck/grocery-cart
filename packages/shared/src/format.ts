// Shared product formatting for API responses.

export function formatProduct(row: any) {
  return {
    sku: row.sku,
    name: row.name,
    brand: row.brand_name,
    sellingSize: row.selling_size,
    priceCents: row.price_cents,
    priceDisplay: row.price_cents != null ? `$${(row.price_cents / 100).toFixed(2)}` : null,
    image: row.primary_image,
    slug: row.slug,
  };
}

export function pickOff(row: any) {
  return {
    ean: row.ean,
    name: row.product_name,
    brand: row.brand,
    quantity: row.quantity,
    categories: row.categories,
    image: row.image_url,
  };
}
