import type { CartSnapshot, Product } from '../shopping/types.js';

const RLM = '\u200F';

function priceLabel(price: number): string {
  return `₪${price.toFixed(2)}`;
}

export function shortName(name: string, max = 28): string {
  if (name.length <= max) return name;
  return name.slice(0, max - 1) + '…';
}

/**
 * Caption for a product photo in the search media group.
 *
 * Line 1: index + name
 * Line 2: size | brand  (if available)
 * Line 3: price (+ per-unit price if size contains weight)
 * Line 4: promo (if available)
 */
export function productCaption(idx: number, p: Product): string {
  const lines: string[] = [];

  lines.push(`${RLM}${idx}. ${p.name}`);

  const meta = [p.size, p.brand].filter(Boolean).join(' | ');
  if (meta) lines.push(`📦 ${meta}`);

  lines.push(`💰 ${priceLabel(p.price)}`);

  if (p.promo) lines.push(`🏷 ${p.promo}`);

  return lines.join('\n');
}

/**
 * Short label for the inline-keyboard button under a result.
 * Format: "N. <short name> | <brand> <price>₪ [🏷]"
 * Total must stay under Telegram's 64-byte callback label limit.
 */
export function productButtonLabel(idx: number, p: Product): string {
  const promoFlag = p.promo ? ' 🏷' : '';
  const brand = p.brand ? ` | ${p.brand}` : '';
  const label = `${idx}. ${shortName(p.name, 22)}${brand} ${Math.round(p.price)}₪${promoFlag}`;
  // Truncate to 40 chars so it fits in a single button row on narrow screens.
  return label.length > 48 ? label.slice(0, 47) + '…' : label;
}

export function cartSummary(cart: CartSnapshot): string {
  if (cart.lines.length === 0) {
    return `🛒 העגלה שלך ריקה.`;
  }
  const lines = cart.lines
    .map(
      (l, i) =>
        `${RLM}${i + 1}. ${l.name}${l.brand ? ` | ${l.brand}` : ''} - ${priceLabel(l.price)} x${l.qty}`,
    )
    .join('\n');
  return `🛒 <b>העגלה שלך:</b>\n\n${lines}\n\n💰 סה"כ: ${priceLabel(cart.total)}\n📦 ${cart.itemCount} מוצרים\n\nלצפייה עם תמונות: /cart תמונות`;
}

export function matchSummary(query: string, exact: boolean, count: number): string {
  if (exact) return `✅ נמצאו התאמות (${count}) עבור: <b>${query}</b>`;
  return `🔍 לא נמצאה התאמה מדויקת (${count}) עבור:\n• <b>${query}</b>`;
}
