import type { Product, SellingMethod } from '../shopping/types.js';
import { logger } from '../util/logger.js';
import { browserQueue } from '../util/queue.js';
import { getPage } from './browser.js';
import { sel } from './selectors.js';
import { config } from '../config.js';

const SEARCH_PATH = '/online/he/search?text=';

interface ScrapedTile {
  sku: string;
  name: string;
  brand: string | null;
  size: string | null;
  price: number;
  imageUrl: string | null;
  promo: string | null;
  sellingMethod: 'BY_UNIT' | 'BY_WEIGHT' | string;
  purchasable: boolean;
  outOfStock: boolean;
}

function toProduct(tile: ScrapedTile): Product {
  const sm: SellingMethod = tile.sellingMethod === 'BY_WEIGHT' ? 'weight' : 'unit';
  const p: Product = {
    sku: tile.sku,
    name: tile.name,
    price: tile.price,
    sellingMethod: sm,
  };
  if (tile.brand) p.brand = tile.brand;
  if (tile.size) p.size = tile.size;
  if (tile.imageUrl) p.imageUrl = tile.imageUrl;
  if (tile.promo) p.promo = tile.promo;
  return p;
}

export async function search(query: string): Promise<Product[]> {
  return browserQueue.enqueue(`search:${query}`, async () => {
    const page = getPage();
    const url = `${config.SHUFERSAL_URL}${SEARCH_PATH}${encodeURIComponent(query)}`;
    logger.info({ query, url }, 'shufersal.search.start');

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    // Wait for tiles to appear, then wait until at least half have data-product-name populated
    // (Shufersal hydrates data attributes via JS after initial render)
    try {
      await page.waitForSelector(sel.search.tile, { timeout: 15_000 });
    } catch {
      logger.warn({ query }, 'shufersal.search.no_tiles');
      return [];
    }

    // Wait for JS hydration: poll until tiles have name attributes, up to 10s
    await page.waitForFunction(
      (selector: string) => {
        const tiles = Array.from(document.querySelectorAll(selector));
        if (tiles.length === 0) return false;
        const populated = tiles.filter((t) => (t.getAttribute('data-product-name') ?? '').length > 0);
        return populated.length >= Math.min(tiles.length, 3);
      },
      sel.search.tile,
      { timeout: 10_000 },
    ).catch(() => {
      logger.warn({ query }, 'shufersal.search.hydration_timeout');
    });

    const tiles: ScrapedTile[] = await page.$$eval(sel.search.tile, (nodes) => {
      const out: ScrapedTile[] = [];
      for (const n of nodes) {
        const sku = n.getAttribute('data-product-code') ?? '';
        if (!sku) continue;
        const name =
          (n.getAttribute('data-product-name') ?? '').trim() ||
          (n.querySelector<HTMLElement>('.text.description strong')?.textContent ?? '').trim();
        const priceStr = n.getAttribute('data-product-price') ?? '';
        const priceFromAttr = Number(priceStr);
        const priceFromText = parseFloat(
          (
            n.querySelector<HTMLElement>('.miglog-prod-price .price, .prices .price')?.textContent ?? ''
          ).replace(/[^\d.]/g, ''),
        );
        const price = priceFromAttr > 0 ? priceFromAttr : priceFromText || 0;

        // Skip placeholder tiles with no name or price (ad/promo tiles)
        if (!name && price === 0) continue;
        const sellingMethod = n.getAttribute('data-selling-method') ?? 'BY_UNIT';
        const purchasable = n.getAttribute('data-product-purchasable') !== 'false';

        const img = n.querySelector<HTMLImageElement>('.imgContainer img');
        const imageUrl = img?.src ?? img?.getAttribute('src') ?? null;

        const brandSizeWrap = n.querySelector('.brand-name');
        let size: string | null = null;
        let brand: string | null = null;
        if (brandSizeWrap) {
          const spans = Array.from(brandSizeWrap.querySelectorAll('span'));
          const texts = spans.map((s) => (s.textContent ?? '').trim()).filter(Boolean);
          if (texts.length >= 2) {
            size = texts[0] ?? null;
            brand = texts[1] ?? null;
          } else if (texts.length === 1) {
            const only = texts[0] ?? '';
            if (/[א-ת]/.test(only) && !/\d/.test(only)) brand = only;
            else size = only;
          }
        }

        const promoEl = n.querySelector('.promotion-section .productInnerPromotion strong');
        let promo: string | null = null;
        if (promoEl) {
          const raw = (promoEl.textContent ?? '').replace(/\s+/g, ' ').trim();
          promo = raw.replace(/כמות.*$/, '').trim() || null;
        } else if (n.querySelector('.compareProductMobile')) {
          promo = 'מבצע';
        }

        const outOfStock = Boolean(n.querySelector('.miglog-prod-outOfStock-msg:not([style*="display: none"])'));

        out.push({
          sku,
          name,
          brand,
          size,
          price,
          imageUrl,
          promo,
          sellingMethod,
          purchasable,
          outOfStock,
        });
      }
      return out;
    });

    const seen = new Set<string>();
    const products: Product[] = [];
    for (const t of tiles) {
      if (seen.has(t.sku)) continue;
      seen.add(t.sku);
      products.push(toProduct(t));
    }

    logger.info({ query, count: products.length }, 'shufersal.search.done');
    return products;
  });
}
