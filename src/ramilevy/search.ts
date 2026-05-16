import type { Product, SellingMethod } from '../shopping/types.js';
import { logger } from '../util/logger.js';
import { config } from '../config.js';
import { RL_ORIGIN, RL_IMG_ORIGIN, rlFetch, rlEnqueue } from './api.js';

interface RLProduct {
  id: number;
  barcode: number | string;
  name: string;
  price: { price: number };
  images?: { small?: string };
  brand?: number | { name: string };
  department?: { name: string };
  group?: { name: string };
  prop?: { by_kilo?: number; status?: number; unit?: number };
}

interface CatalogResponse {
  total: number;
  data: RLProduct[];
}

function toProduct(item: RLProduct): Product {
  const imageSlug = item.images?.small ?? null;
  const imageUrl = imageSlug ? `${RL_IMG_ORIGIN}${imageSlug}` : undefined;
  const sm: SellingMethod = item.prop?.by_kilo ? 'weight' : 'unit';
  return {
    sku: String(item.id),
    name: item.name,
    price: item.price?.price ?? 0,
    imageUrl,
    sellingMethod: sm,
    url: `${RL_ORIGIN}/he/p/${item.id}`,
  };
}

export async function search(query: string, size = 20): Promise<Product[]> {
  return rlEnqueue(`search:${query}`, async () => {
    logger.info({ query }, 'ramilevy.search.start');

    const result = await rlFetch<CatalogResponse>(`${RL_ORIGIN}/api/catalog`, 'POST', {
      q: query,
      store: config.RAMILEVY_STORE_ID,
      size,
    });

    const seen = new Set<string>();
    const products: Product[] = [];
    for (const item of result.data ?? []) {
      // Skip out-of-stock (status !== 1 means unavailable in most cases)
      if (item.prop?.status === 0) continue;
      const p = toProduct(item);
      if (seen.has(p.sku)) continue;
      seen.add(p.sku);
      products.push(p);
    }

    logger.info({ query, count: products.length }, 'ramilevy.search.done');
    return products;
  });
}
