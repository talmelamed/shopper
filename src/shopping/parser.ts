import { ulid } from 'ulid';
import type { ShoppingItem } from './types.js';

/**
 * Parses a free-text shopping list message into ShoppingItem[].
 *
 * Supported formats (mirrors the old myShopper bot, see PLAN.md §11.1):
 *
 *  - One item per line OR comma-separated:  "2 חלב, 3 לחם, ביצים"
 *  - Quantity prefix:                       "2 חלב"   |   "חלב x2"
 *  - Units / weight:                        '1 ק"ג עגבניות'   |   '500 גרם גבינה'   |   'אורז בסמטי 5 ק"ג'
 *  - Brand via @:                           "קפה שחור 3 @עלית"
 *  - Brand via מותג:                        "שמן זית 2 מותג:שופרסל"
 *  - Brand + weight:                        'אבקת כביסה @אריאל 7 ק"ג'
 *  - Remove:                                "הסר חלב"   |   "הסר #3"
 *  - Blank lines and lines starting with `#` are ignored.
 */

const WEIGHT_KG = /(\d+(?:\.\d+)?)\s*ק["']?ג/;
const WEIGHT_GRAMS = /(\d+(?:\.\d+)?)\s*(?:גרם|גר)/;
const QTY_SUFFIX = /\s*x\s*(\d+)\s*$/i;
const QTY_STANDALONE = /(?:^|\s)(\d+)(?:\s|$)/;
const BRAND_AT = /@([^\s,@]+)/;
const BRAND_LABEL = /מותג\s*:\s*([^\s,]+)/;
const REMOVE_PREFIX = /^\s*(?:הסר|remove)\s+/i;
const CART_REF = /#(\d+)/;

function splitInput(raw: string): string[] {
  const lines = raw.split(/\r?\n/);
  const tokens: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    for (const piece of trimmed.split(',')) {
      const t = piece.trim();
      if (t) tokens.push(t);
    }
  }
  return tokens;
}

function parseOne(token: string): ShoppingItem | null {
  const isRemove = REMOVE_PREFIX.test(token);
  let working = token.replace(REMOVE_PREFIX, '').trim();

  let cartIndexRef: number | undefined;
  const cartMatch = working.match(CART_REF);
  if (cartMatch) {
    cartIndexRef = Number(cartMatch[1]);
    working = working.replace(CART_REF, '').trim();
  }

  let brand: string | undefined;
  const brandAt = working.match(BRAND_AT);
  if (brandAt) {
    brand = brandAt[1];
    working = working.replace(BRAND_AT, '').trim();
  } else {
    const brandLabel = working.match(BRAND_LABEL);
    if (brandLabel) {
      brand = brandLabel[1];
      working = working.replace(BRAND_LABEL, '').trim();
    }
  }

  let weightKg: number | undefined;
  const kgMatch = working.match(WEIGHT_KG);
  if (kgMatch) {
    weightKg = Number(kgMatch[1]);
    working = working.replace(WEIGHT_KG, '').trim();
  } else {
    const gMatch = working.match(WEIGHT_GRAMS);
    if (gMatch) {
      weightKg = Number(gMatch[1]) / 1000;
      working = working.replace(WEIGHT_GRAMS, '').trim();
    }
  }

  // Quantity discovery: brand and weight have already been stripped,
  // so any lone digit token left is the quantity (prefix, suffix, or middle).
  let qty = 1;
  const qtySuffix = working.match(QTY_SUFFIX);
  if (qtySuffix) {
    qty = Number(qtySuffix[1]);
    working = working.replace(QTY_SUFFIX, '').trim();
  } else {
    const standalone = working.match(QTY_STANDALONE);
    if (standalone) {
      qty = Number(standalone[1]);
      working = working.replace(QTY_STANDALONE, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  const name = working.trim();
  if (!isRemove && !name && cartIndexRef === undefined) return null;
  if (isRemove && !name && cartIndexRef === undefined) return null;

  const item: ShoppingItem = {
    id: ulid(),
    rawText: token,
    name: name || (cartIndexRef !== undefined ? `#${cartIndexRef}` : ''),
    qty,
    action: isRemove ? 'remove' : 'add',
  };
  if (brand !== undefined) item.brand = brand;
  if (weightKg !== undefined) item.weightKg = weightKg;
  if (cartIndexRef !== undefined) item.cartIndexRef = cartIndexRef;
  return item;
}

export function parseShoppingList(raw: string): ShoppingItem[] {
  return splitInput(raw)
    .map(parseOne)
    .filter((x): x is ShoppingItem => x !== null);
}
