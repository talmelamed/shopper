import type { CartLine, CartSnapshot, Product } from '../shopping/types.js';
import { logger } from '../util/logger.js';
import { browserQueue } from '../util/queue.js';
import { getPage } from './browser.js';
import { sel } from './selectors.js';
import { config } from '../config.js';

/**
 * Adds a product to the real Shufersal cart via Playwright.
 * Strategy:
 *  1. Navigate to the search results page for this product's name.
 *  2. Find the tile by data-product-code (SKU).
 *  3. Fill the qty input, then click "הוספה".
 *  4. Wait for the cart badge to update, return new count.
 */
export async function addToCart(product: Product, qty: number = 1): Promise<number> {
  return browserQueue.enqueue(`cart.add:${product.sku}:${qty}`, async () => {
    const page = getPage();
    logger.info({ sku: product.sku, name: product.name, qty }, 'cart.add.start');

    const currentUrl = page.url();
    const searchUrl = `${config.SHUFERSAL_URL}/online/he/search?text=${encodeURIComponent(product.name)}`;

    if (!currentUrl.includes('search') || !currentUrl.includes(encodeURIComponent(product.name).slice(0, 8))) {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      try {
        await page.waitForSelector(sel.search.tile, { timeout: 10_000 });
      } catch {
        logger.warn({ sku: product.sku }, 'cart.add.no_tiles');
      }
    }

    const tileSel = sel.tile.bySkuAttr(product.sku);
    const tile = page.locator(tileSel).first();

    const tileCount = await tile.count();
    if (tileCount === 0) {
      logger.warn({ sku: product.sku, searchUrl }, 'cart.add.tile_not_found');
      return await getCartBadgeCount();
    }

    const qtyInput = tile.locator(sel.tile.qtyInput).first();
    const qtyInputCount = await qtyInput.count();
    if (qtyInputCount > 0) {
      await qtyInput.fill(String(qty));
    }

    const addBtn = tile.locator(sel.tile.addBtn).first();
    const updateBtn = tile.locator(sel.tile.updateBtn).first();

    const prevBadge = await getCartBadgeCount();

    const addBtnVisible = await addBtn.isVisible().catch(() => false);
    if (addBtnVisible) {
      await addBtn.click();
    } else {
      const updateBtnVisible = await updateBtn.isVisible().catch(() => false);
      if (updateBtnVisible) {
        await updateBtn.click();
      } else {
        logger.warn({ sku: product.sku }, 'cart.add.no_button_visible');
      }
    }

    try {
      await page.waitForFunction(
        (prev) => {
          const el = document.querySelector('.js-mini-cart-count, .cart-count');
          if (!el) return false;
          const current = parseInt((el as HTMLElement).innerText ?? '0', 10);
          return current > prev;
        },
        prevBadge,
        { timeout: 8_000 },
      );
    } catch {
      logger.warn({ sku: product.sku }, 'cart.add.badge_wait_timeout');
    }

    const newCount = await getCartBadgeCount();
    logger.info({ sku: product.sku, qty, newCount }, 'cart.add.done');
    return newCount;
  });
}

export async function getCartBadgeCount(): Promise<number> {
  try {
    const page = getPage();
    const el = await page.$('.js-mini-cart-count, .cart-count');
    if (!el) return 0;
    const text = await el.innerText();
    return parseInt(text.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

const memCart = new Map<string, CartLine>();

export async function setQty(skuOrName: string | number, qty: number): Promise<CartSnapshot> {
  return browserQueue.enqueue(`cart.set:${skuOrName}=${qty}`, async () => {
    const line = resolveMemLine(skuOrName);
    if (!line) return memSnapshot();

    // Update real Shufersal cart via Playwright
    const page = getPage();
    const searchUrl = `${config.SHUFERSAL_URL}/online/he/search?text=${encodeURIComponent(line.name)}`;
    logger.info({ sku: line.sku, qty }, 'cart.setQty.start');

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    try {
      await page.waitForSelector(sel.search.tile, { timeout: 10_000 });
    } catch {
      logger.warn({ sku: line.sku }, 'cart.setQty.no_tiles');
    }

    const tileSel = sel.tile.bySkuAttr(line.sku);
    const tile = page.locator(tileSel).first();

    if ((await tile.count()) === 0) {
      logger.warn({ sku: line.sku }, 'cart.setQty.tile_not_found');
    } else {
      const qtyInput = tile.locator(sel.tile.qtyInput).first();
      if ((await qtyInput.count()) > 0) {
        await qtyInput.fill(String(qty <= 0 ? 0 : qty));
      }

      const updateBtn = tile.locator(sel.tile.updateBtn).first();
      const addBtn = tile.locator(sel.tile.addBtn).first();

      if (qty <= 0) {
        // Try dedicated remove button first, then set qty=0 and update
        const removeBtn = tile.locator(sel.tile.removeBtn).first();
        if ((await removeBtn.count()) > 0 && (await removeBtn.isVisible())) {
          await removeBtn.click();
        } else if ((await updateBtn.count()) > 0 && (await updateBtn.isVisible())) {
          await updateBtn.click();
        }
      } else {
        const updateVisible = await updateBtn.isVisible().catch(() => false);
        if (updateVisible) {
          await updateBtn.click();
        } else {
          const addVisible = await addBtn.isVisible().catch(() => false);
          if (addVisible) await addBtn.click();
        }
      }
      await page.waitForTimeout(1500);
    }

    // Sync memory mirror
    if (qty <= 0) memCart.delete(line.sku);
    else memCart.set(line.sku, { ...line, qty });

    logger.info({ sku: line.sku, qty }, 'cart.setQty.done');
    return memSnapshot();
  });
}

export async function removeFromCart(skuOrName: string | number): Promise<CartSnapshot> {
  return setQty(skuOrName, 0);
}

export async function clearCart(): Promise<CartSnapshot> {
  return browserQueue.enqueue('cart.clear', async () => {
    const page = getPage();
    const cartUrl = `${config.SHUFERSAL_URL}/online/he/cart/cartsummary?_t=${Date.now()}`;
    logger.info({}, 'cart.clear.start');
    await page.goto(cartUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page
      .waitForSelector(`${sel.cart.line}, .emptyCart, .empty-cart`, { timeout: 12_000 })
      .catch(() => {});

    const clearBtn = page.locator(sel.cart.clear).first();
    if ((await clearBtn.count()) > 0 && (await clearBtn.isVisible())) {
      await clearBtn.click();
      await page.waitForTimeout(1500);
      logger.info({}, 'cart.clear.done_via_button');
    } else {
      // Fallback: remove items one by one
      let removed = 0;
      while (true) {
        const btn = page.locator(sel.cart.lineRemove).first();
        if ((await btn.count()) === 0) break;
        const visible = await btn.isVisible().catch(() => false);
        if (!visible) break;
        await btn.click();
        await page.waitForTimeout(800);
        removed++;
      }
      logger.info({ removed }, 'cart.clear.done_via_remove');
    }

    memCart.clear();
    return memSnapshot();
  });
}

export async function getCart(): Promise<CartSnapshot> {
  return browserQueue.enqueue('cart.get', async () => {
    const page = getPage();
    // Add a timestamp param to force a fresh load even if already on the cart page
    const cartUrl = `${config.SHUFERSAL_URL}/online/he/cart/cartsummary?_t=${Date.now()}`;
    logger.info({}, 'cart.get.start');
    await page.goto(cartUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Wait for cart articles to appear OR for an empty-cart indicator
    await page
      .waitForSelector(`${sel.cart.line}, .emptyCart, .empty-cart`, { timeout: 12_000 })
      .catch(() => logger.warn({}, 'cart.get.wait_timeout'));

    const result = await page.evaluate(
      ({ lineSel, nameEl, imgEl, totalEl }) => {
        // --- Price data: read from embedded <script> tags (always present, unlike window.miglog) ---
        type DyItem = { productId: string; quantity: number; itemPrice: number };
        let dyCart: DyItem[] = [];

        // Try window.miglog first (fast path)
        const miglog = (
          window as unknown as {
            miglog?: { dyPurchaseEventData?: { properties?: { cart?: DyItem[] } } };
          }
        ).miglog;
        dyCart = miglog?.dyPurchaseEventData?.properties?.cart ?? [];

        // Fallback: parse the DyPurchaseEventData JSON from <script> source
        if (dyCart.length === 0) {
          for (const script of Array.from(document.querySelectorAll('script:not([src])'))) {
            const src = script.textContent ?? '';
            const match = src.match(/DyPurchaseEventData\s*=\s*(\{[\s\S]*?\});\s*\n/);
            if (match) {
              try {
                const parsed = JSON.parse(match[1] as string) as {
                  properties?: { cart?: DyItem[] };
                };
                dyCart = parsed?.properties?.cart ?? [];
              } catch {}
              break;
            }
          }
        }

        const priceMap = new Map<string, number>();
        for (const item of dyCart) {
          const unitPrice = item.quantity > 0 ? item.itemPrice / item.quantity : 0;
          priceMap.set(item.productId, unitPrice);
        }

        const articles = Array.from(document.querySelectorAll(lineSel));
        const lines = articles.map((a) => {
          const sku = a.getAttribute('data-product-code') ?? '';
          const qty = parseFloat(a.getAttribute('data-entry-qty') ?? '0') || 0;
          const name = (a.querySelector(nameEl)?.textContent ?? '').trim();
          const imgSrc = a.querySelector<HTMLImageElement>(imgEl);
          const imageUrl = imgSrc?.src ?? imgSrc?.getAttribute('src') ?? null;
          const unitPrice = priceMap.get(sku) ?? 0;
          return { sku, name, qty, price: unitPrice, imageUrl };
        });

        const totalText = (document.querySelector(totalEl)?.textContent ?? '').replace(/[^\d.]/g, '');
        const total = parseFloat(totalText) || lines.reduce((s, l) => s + l.price * l.qty, 0);

        return { lines, total };
      },
      {
        lineSel: sel.cart.line,
        nameEl: sel.cart.lineName,
        imgEl: sel.cart.lineImg,
        totalEl: sel.cart.total,
      },
    );

    // Sync in-memory mirror so /update commands work
    memCart.clear();
    for (const l of result.lines) {
      if (l.sku) memCart.set(l.sku, l as CartLine);
    }

    const lines: CartLine[] = result.lines.map((l) => ({
      sku: l.sku,
      name: l.name,
      price: l.price,
      qty: l.qty,
      imageUrl: l.imageUrl ?? undefined,
    }));

    logger.info({ count: lines.length, total: result.total }, 'cart.get.done');
    return { lines, total: result.total, itemCount: lines.length };
  });
}

export function recordCartAdd(product: Product, qty: number): void {
  const existing = memCart.get(product.sku);
  const newQty = (existing?.qty ?? 0) + qty;
  memCart.set(product.sku, {
    sku: product.sku,
    name: product.name,
    brand: product.brand,
    price: product.price,
    qty: newQty,
    imageUrl: product.imageUrl,
  });
}

function memSnapshot(): CartSnapshot {
  const lines = Array.from(memCart.values());
  const total = lines.reduce((s, l) => s + l.price * l.qty, 0);
  return { lines, total: Math.round(total * 100) / 100, itemCount: lines.length };
}

function resolveMemLine(key: string | number): CartLine | undefined {
  if (typeof key === 'number') return Array.from(memCart.values())[key - 1];
  return memCart.get(key) ?? Array.from(memCart.values()).find(
    (l) => l.name.toLowerCase().includes(String(key).toLowerCase()),
  );
}
