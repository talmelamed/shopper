import { Markup } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/types';
import type { CartLine, Product, SellingMethod } from '../shopping/types.js';
import type { UserSettings } from '../shopping/session.js';
import { productButtonLabel, shortName } from './formatters.js';

export interface ProductKeyboardOpts {
  itemId: string;
  pageResults: Product[];
  pageStartIdx: number;
  hasMore: boolean;
}

export function quantityKeyboard(
  itemId: string,
  resultIdx: number,
  sellingMethod: SellingMethod = 'unit',
): Markup.Markup<InlineKeyboardMarkup> {
  const prefix = `qty:${itemId}:${resultIdx}`;
  const isWeight = sellingMethod === 'weight';

  const quantities = isWeight
    ? ['0.25', '0.5', '1', '1.5', '2', '3']
    : ['1', '2', '3', '4', '5'];

  const unit = isWeight ? 'ק"ג' : 'יח\'';

  const buttons = quantities.map((q) =>
    Markup.button.callback(`${q} ${unit}`, `${prefix}:${q}`),
  );

  return Markup.inlineKeyboard([
    buttons.slice(0, 3),
    buttons.slice(3),
    [
      Markup.button.callback('✏️ הזן מספר', `customqty:${itemId}:${resultIdx}`),
      Markup.button.callback('❌ ביטול', `cancelqty:${itemId}`),
    ],
  ]);
}

export function productKeyboard({
  itemId,
  pageResults,
  pageStartIdx,
  hasMore,
}: ProductKeyboardOpts): Markup.Markup<InlineKeyboardMarkup> {
  const productRows = pageResults.map((p, i) => {
    const absoluteIdx = pageStartIdx + i;
    return [
      Markup.button.callback(productButtonLabel(absoluteIdx + 1, p), `pick:${itemId}:${absoluteIdx}`),
    ];
  });

  const nav: ReturnType<typeof Markup.button.callback>[] = [];
  if (hasMore) nav.push(Markup.button.callback('🔽 עוד אפשרויות', `more:${itemId}`));
  nav.push(Markup.button.callback('⏭ דלג', `skip:${itemId}`));

  return Markup.inlineKeyboard([...productRows, nav]);
}

export function cartKeyboard(lines: CartLine[]): Markup.Markup<InlineKeyboardMarkup> {
  const rows = lines.map((l, i) => [
    Markup.button.callback(
      `✏️ ${i + 1}. ${shortName(l.name, 22)} x${l.qty}`,
      `cartedit:${l.sku}`,
    ),
  ]);
  rows.push([Markup.button.callback('🗑 נקה עגלה', 'clearcart')]);
  return Markup.inlineKeyboard(rows);
}

export function cartEditKeyboard(sku: string, sellingMethod: SellingMethod = 'unit'): Markup.Markup<InlineKeyboardMarkup> {
  const prefix = `cartqty:${sku}`;
  const isWeight = sellingMethod === 'weight';
  const quantities = isWeight ? ['0.5', '1', '1.5', '2', '3'] : ['1', '2', '3', '4', '5'];
  const unit = isWeight ? 'ק"ג' : 'יח\'';

  const qtyButtons = quantities.map((q) =>
    Markup.button.callback(`${q} ${unit}`, `${prefix}:${q}`),
  );

  return Markup.inlineKeyboard([
    qtyButtons.slice(0, 3),
    qtyButtons.slice(3),
    [
      Markup.button.callback('✏️ הזן מספר', `cartcustom:${sku}`),
      Markup.button.callback('🗑 הסר', `cartremove:${sku}`),
      Markup.button.callback('❌ ביטול', 'cartcancel'),
    ],
  ]);
}

const RESULTS_OPTIONS = [2, 3, 4, 5, 6, 8];
const PAGES_OPTIONS = [2, 3, 5, 8, 10];

export function settingsKeyboard(settings: UserSettings): Markup.Markup<InlineKeyboardMarkup> {
  const resultsRow = RESULTS_OPTIONS.map((n) =>
    Markup.button.callback(
      n === settings.resultsPerPage ? `✅ ${n}` : `${n}`,
      `setresults:${n}`,
    ),
  );
  const pagesRow = PAGES_OPTIONS.map((n) =>
    Markup.button.callback(
      n === settings.maxPages ? `✅ ${n}` : `${n}`,
      `setpages:${n}`,
    ),
  );
  return Markup.inlineKeyboard([resultsRow, pagesRow]);
}
