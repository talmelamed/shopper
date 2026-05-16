/**
 * Store adapter — unified interface over Shufersal and Rami Levy.
 * Handlers use getAdapter(session.store) and never import store modules directly.
 */

import type { Product, CartSnapshot } from '../shopping/types.js';

export type StoreName = 'shufersal' | 'ramilevy';

export interface StoreAdapter {
  name: StoreName;
  displayName: string;
  search(query: string): Promise<Product[]>;
  addToCart(product: Product, qty: number): Promise<number>;
  setQty(skuOrName: string, qty: number): Promise<void>;
  removeFromCart(skuOrName: string): Promise<void>;
  getCart(): Promise<CartSnapshot>;
  clearCart(): Promise<CartSnapshot>;
  getCartBadgeCount(): Promise<number>;
  isLoggedIn(): Promise<boolean>;
}

// ── Shufersal adapter ─────────────────────────────────────────────────────────

import {
  search as sfSearch,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
} from '../shufersal/search.js';
import {
  addToCart as sfAddToCart,
  setQty as sfSetQty,
  removeFromCart as sfRemoveFromCart,
  getCart as sfGetCart,
  clearCart as sfClearCart,
  getCartBadgeCount as sfGetCartBadgeCount,
} from '../shufersal/cart.js';
import { isLoggedIn as sfIsLoggedIn } from '../shufersal/session.js';

const shufersalAdapter: StoreAdapter = {
  name: 'shufersal',
  displayName: 'שופרסל',
  search: sfSearch,
  addToCart: sfAddToCart,
  setQty: sfSetQty,
  removeFromCart: sfRemoveFromCart,
  getCart: sfGetCart,
  clearCart: sfClearCart,
  getCartBadgeCount: sfGetCartBadgeCount,
  isLoggedIn: sfIsLoggedIn,
};

// ── Rami Levy adapter ─────────────────────────────────────────────────────────

import { search as rlSearch } from '../ramilevy/search.js';
import {
  addToCart as rlAddToCart,
  setQty as rlSetQty,
  removeFromCart as rlRemoveFromCart,
  getCart as rlGetCart,
  clearCart as rlClearCart,
  getCartBadgeCount as rlGetCartBadgeCount,
} from '../ramilevy/cart.js';
import { isLoggedIn as rlIsLoggedIn } from '../ramilevy/session.js';

const ramileviAdapter: StoreAdapter = {
  name: 'ramilevy',
  displayName: 'רמי לוי',
  search: rlSearch,
  addToCart: rlAddToCart,
  setQty: rlSetQty,
  removeFromCart: rlRemoveFromCart,
  getCart: rlGetCart,
  clearCart: rlClearCart,
  getCartBadgeCount: rlGetCartBadgeCount,
  isLoggedIn: rlIsLoggedIn,
};

// ── Factory ───────────────────────────────────────────────────────────────────

export function getAdapter(store: StoreName | undefined): StoreAdapter {
  return store === 'ramilevy' ? ramileviAdapter : shufersalAdapter;
}

export const STORE_NAMES: Record<StoreName, string> = {
  shufersal: '🟠 שופרסל',
  ramilevy: '🔵 רמי לוי',
};
