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

export async function setQty(skuOrName: string, qty: number): Promise<void> {
  return browserQueue.enqueue(`cart.set:${skuOrName}=${qty}`, async () => {
    const page = getPage();
    logger.info({ skuOrName, qty }, 'cart.setQty.start');

    // Navigate to cart only if not already there
    if (!page.url().includes('/cart/')) {
      await page.goto(
        `${config.SHUFERSAL_URL}/online/he/cart/cartsummary`,
        { waitUntil: 'domcontentloaded', timeout: 30_000 },
      );
      await page
        .waitForSelector(`${sel.cart.line}, .emptyCart, .empty-cart`, { timeout: 12_000 })
        .catch(() => {});
    }

    // Resolve SKU: try direct match first, then fuzzy name search
    let sku = skuOrName;
    let articleSel = `${sel.cart.line}[data-product-code="${sku}"]`;
    if ((await page.locator(articleSel).count()) === 0) {
      const resolved = await resolveSkuByName(page, skuOrName);
      if (resolved) {
        sku = resolved;
        articleSel = `${sel.cart.line}[data-product-code="${sku}"]`;
      }
    }
    const tile = page.locator(articleSel).first();
    if ((await tile.count()) === 0) {
      logger.warn({ skuOrName }, 'cart.setQty.tile_not_found');
      return;
    }

    const targetQty = qty <= 0 ? 0 : qty;

    // Remove: click the dedicated remove button when qty is 0
    if (targetQty === 0) {
      const removeBtn = tile.locator(`${sel.tile.removeBtn}, ${sel.cart.lineRemove}`).first();
      if ((await removeBtn.count()) > 0 && (await removeBtn.isVisible().catch(() => false))) {
        await removeBtn.click();
        await page.waitForTimeout(1500);
        logger.info({ skuOrName }, 'cart.setQty.removed');
        return;
      }
    }

    // Step 1: scroll item into view and click the qty input using page.evaluate
    // We dispatch native events so that Shufersal's own JS handlers fire correctly.
    const inputFound = await page.evaluate(
      ({ articleSel: sel, newQty }) => {
        const article = document.querySelector(sel);
        if (!article) return false;
        const input = article.querySelector<HTMLInputElement>(
          'input.js-qty-selector-input, input[class*="qty-selector"], input[type="number"]',
        );
        if (!input) return false;
        article.scrollIntoView({ block: 'center' });
        input.focus();
        // Use native value setter so React/Angular listeners detect the change
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        nativeSetter?.call(input, String(newQty));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        // Dispatch Enter key events to trigger Shufersal's "confirm" logic
        const enterOpts: KeyboardEventInit = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
        input.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
        input.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
        input.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
        return true;
      },
      { articleSel, newQty: targetQty },
    );

    if (!inputFound) {
      logger.warn({ skuOrName }, 'cart.setQty.input_not_found_in_dom');
      return;
    }

    // Step 2: wait for the "עדכון" / js-update-cart button to appear and click it
    const updateBtnSel = 'button.js-update-cart, button:has-text("עדכון")';
    const updateBtn = tile.locator(updateBtnSel).first();
    try {
      await updateBtn.waitFor({ state: 'visible', timeout: 4_000 });
      await updateBtn.click();
      logger.info({ skuOrName, targetQty }, 'cart.setQty.confirmed_via_update_btn');
    } catch {
      // The update may have already been committed via Enter key
      logger.info({ skuOrName, targetQty }, 'cart.setQty.confirmed_via_enter');
    }

    await page.waitForTimeout(800);
    logger.info({ skuOrName, targetQty }, 'cart.setQty.done');
  });
}

export async function removeFromCart(skuOrName: string): Promise<void> {
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

    return { lines: [], total: 0, itemCount: 0 };
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


/** Scans the current cart page DOM to find a SKU by fuzzy product name match. */
async function resolveSkuByName(page: import('playwright').Page, name: string): Promise<string | null> {
  const articles = page.locator(sel.cart.line);
  const count = await articles.count();
  const lowerName = name.toLowerCase();
  for (let i = 0; i < count; i++) {
    const article = articles.nth(i);
    const articleName = ((await article.locator(sel.cart.lineName).textContent().catch(() => '')) ?? '').toLowerCase();
    if (articleName.includes(lowerName)) {
      return await article.getAttribute('data-product-code') ?? null;
    }
  }
  return null;
}
