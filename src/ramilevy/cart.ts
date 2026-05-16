/**
 * Rami Levy cart.
 *
 * The RL cart API is stateless from the server's perspective:
 * every POST to /api/v2/cart sends the COMPLETE desired cart state
 * and returns the priced result.
 *
 * We maintain local state (rlItems: Record<productId, qty>) persisted to a file.
 * All mutations go through _syncCart() which POSTs local state and returns the
 * fresh CartSnapshot.
 */

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CartLine, CartSnapshot, Product } from '../shopping/types.js';
import { logger } from '../util/logger.js';
import { config } from '../config.js';
import { RL_ORIGIN, RL_IMG_ORIGIN, rlFetch, rlEnqueue } from './api.js';

const STATE_FILE = resolve(config.STATE_DIR, 'rl-cart.json');

// In-memory cart: productId (string) → qty (number)
let _items: Record<string, number> = {};
let _loaded = false;

async function load(): Promise<void> {
  if (_loaded) return;
  try {
    const raw = await readFile(STATE_FILE, 'utf8');
    _items = JSON.parse(raw) as Record<string, number>;
  } catch {
    _items = {};
  }
  _loaded = true;
}

async function persist(): Promise<void> {
  await mkdir(resolve(config.STATE_DIR), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(_items, null, 2), 'utf8');
}

// ── API Types ────────────────────────────────────────────────────────────────

interface RLCartItem {
  id: number;
  barcode?: number | string;
  name?: string;
  price?: { price: number };
  images?: { small?: string };
  quantity?: number;
  // quantity may come from the response at top level or nested
}

interface CartApiResponse {
  items: RLCartItem[];
  total?: number;
  totalPrice?: number;
}

// ── Core sync helper ─────────────────────────────────────────────────────────

async function _syncCart(): Promise<CartSnapshot> {
  await load();

  // Only include items with qty > 0
  const activeItems: Record<string, string> = {};
  for (const [id, qty] of Object.entries(_items)) {
    if (qty > 0) activeItems[id] = qty.toFixed(2);
  }

  const supplyAt = new Date().toISOString();

  let response: CartApiResponse;
  try {
    response = await rlFetch<CartApiResponse>(`${RL_ORIGIN}/api/v2/cart`, 'POST', {
      store: config.RAMILEVY_STORE_ID,
      isClub: 0,
      supplyAt,
      items: activeItems,
      meta: null,
    });
  } catch (err) {
    logger.warn({ err }, 'ramilevy.cart.sync_failed');
    return { lines: [], total: 0, itemCount: 0 };
  }

  const lines: CartLine[] = (response.items ?? []).map((item) => {
    const imageSlug = item.images?.small ?? null;
    return {
      sku: String(item.id),
      name: item.name ?? String(item.id),
      price: item.price?.price ?? 0,
      qty: _items[String(item.id)] ?? 0,
      imageUrl: imageSlug ? `${RL_IMG_ORIGIN}${imageSlug}` : undefined,
    };
  });

  const total = response.totalPrice ?? response.total ?? lines.reduce((s, l) => s + l.price * l.qty, 0);
  logger.info({ count: lines.length, total }, 'ramilevy.cart.synced');
  return { lines, total, itemCount: lines.length };
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function addToCart(product: Product, qty: number): Promise<number> {
  return rlEnqueue(`cart.add:${product.sku}`, async () => {
    await load();
    logger.info({ sku: product.sku, qty }, 'ramilevy.cart.add');
    _items[product.sku] = (_items[product.sku] ?? 0) + qty;
    await persist();
    const snap = await _syncCart();
    return snap.itemCount;
  });
}

export async function setQty(skuOrName: string, qty: number): Promise<void> {
  return rlEnqueue(`cart.set:${skuOrName}=${qty}`, async () => {
    await load();
    logger.info({ skuOrName, qty }, 'ramilevy.cart.setQty');

    // If it looks like a numeric SKU use directly, else try to resolve by name from current items
    let sku = skuOrName;
    if (!/^\d+$/.test(skuOrName)) {
      const match = Object.keys(_items).find((id) => {
        // We don't have names in _items, so just skip name resolution here — callers should pass SKU
        return id === skuOrName;
      });
      sku = match ?? skuOrName;
    }

    if (qty <= 0) {
      delete _items[sku];
    } else {
      _items[sku] = qty;
    }
    await persist();
    await _syncCart();
  });
}

export async function removeFromCart(skuOrName: string): Promise<void> {
  return setQty(skuOrName, 0);
}

export async function getCart(): Promise<CartSnapshot> {
  return rlEnqueue('cart.get', async () => {
    await load();
    return _syncCart();
  });
}

export async function clearCart(): Promise<CartSnapshot> {
  return rlEnqueue('cart.clear', async () => {
    await load();
    logger.info({}, 'ramilevy.cart.clear');
    _items = {};
    await persist();
    return _syncCart();
  });
}

/** Returns badge count (total item count in cart). */
export async function getCartBadgeCount(): Promise<number> {
  await load();
  return Object.values(_items).filter((q) => q > 0).length;
}
