import type { Product, SearchResultBundle, ShoppingItem } from './types.js';
import { config } from '../config.js';

export const SESSION_SCHEMA_VERSION = 1 as const;

export interface UserSettings {
  resultsPerPage: number;
  maxPages: number;
}

export function defaultSettings(): UserSettings {
  return {
    resultsPerPage: config.RESULTS_PER_PAGE,
    maxPages: config.MAX_PAGES,
  };
}

export interface PendingPick {
  itemId: string;
  resultIdx: number;
  product: Product;
}

export interface PendingCustomQty {
  itemId: string;
  resultIdx: number;
}

export interface PendingCartEdit {
  sku: string;
  name: string;
}

export interface ChatSession {
  v: typeof SESSION_SCHEMA_VERSION;
  chatId: number;
  createdAt: number;
  updatedAt: number;
  settings: UserSettings;
  items: ShoppingItem[];
  currentIdx: number;
  bundles: Record<string, SearchResultBundle>;
  pendingPick?: PendingPick;
  pendingCustomQty?: PendingCustomQty;
  pendingCartEdit?: PendingCartEdit;
}

export function newSession(chatId: number): ChatSession {
  const now = Date.now();
  return {
    v: SESSION_SCHEMA_VERSION,
    chatId,
    createdAt: now,
    updatedAt: now,
    settings: defaultSettings(),
    items: [],
    currentIdx: 0,
    bundles: {},
  };
}

export function currentItem(s: ChatSession): ShoppingItem | undefined {
  return s.items[s.currentIdx];
}

export function advance(s: ChatSession): void {
  s.currentIdx += 1;
  s.updatedAt = Date.now();
}

export function isComplete(s: ChatSession): boolean {
  return s.currentIdx >= s.items.length;
}

export function pageSlice<T>(arr: T[], cursor: number, perPage: number): T[] {
  return arr.slice(cursor, cursor + perPage);
}
