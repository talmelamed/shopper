import type { Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import type { InputMediaPhoto } from 'telegraf/types';
import { config } from '../config.js';
import { logger } from '../util/logger.js';
import { stateStore } from '../state/store.js';
import { newSession, type ChatSession, type PendingCustomQty, type PendingCartEdit, defaultSettings } from '../shopping/session.js';
import { smartParseShoppingList } from '../llm/parser.js';
import { llmRankResults } from '../llm/ranker.js';
import { search } from '../shufersal/search.js';
import {
  addToCart,
  getCart,
  getCartBadgeCount,
  recordCartAdd,
  removeFromCart,
  setQty,
  clearCart,
} from '../shufersal/cart.js';
import { isLoggedIn } from '../shufersal/session.js';
import { isLlmEnabled } from '../llm/client.js';
import { browserQueue } from '../util/queue.js';
import type { Product, SearchResultBundle, ShoppingItem } from '../shopping/types.js';
import { cartSummary, matchSummary, productCaption } from './formatters.js';
import {
  cartKeyboard,
  cartEditKeyboard,
  productKeyboard,
  quantityKeyboard,
  settingsKeyboard,
} from './keyboards.js';
import { HELP_TEXT, WELCOME_TEXT } from './help.js';
import type { BotContext } from './bot.js';

export function registerHandlers(bot: Telegraf<BotContext>): void {
  bot.start(async (ctx) => {
    await ctx.replyWithHTML(WELCOME_TEXT);
  });

  bot.help(async (ctx) => {
    await ctx.replyWithHTML(HELP_TEXT);
  });

  bot.command('reset', async (ctx) => {
    const chatId = ctx.chat.id;
    await stateStore.put(newSession(chatId));
    await ctx.reply('🧹 השיחה אופסה. שלח רשימה חדשה כדי להתחיל.');
  });

  bot.command('status', async (ctx) => {
    const loggedIn = await isLoggedIn().catch(() => false);
    const depth = browserQueue.depth;
    await ctx.replyWithHTML(
      [
        `🩺 <b>סטטוס:</b>`,
        `• מחובר לשופרסל: ${loggedIn ? '✅' : '❌'}`,
        `• פעולות בתור: <code>${depth}</code>`,
        `• מצב ריצה: <code>${config.RUN_MODE}</code>`,
        `• OpenAI: ${isLlmEnabled() ? `✅ <code>${config.OPENAI_MODEL}</code>` : '❌ (regex fallback)'}`,
      ].join('\n'),
    );
  });

  bot.command('settings', async (ctx) => {
    const chatId = ctx.chat.id;
    const session = await stateStore.get(chatId);
    const s = session.settings ?? defaultSettings();
    await ctx.replyWithHTML(
      [
        `⚙️ <b>הגדרות חיפוש</b>`,
        ``,
        `📊 <b>תוצאות לעמוד:</b> ${s.resultsPerPage}`,
        `📄 <b>עמודים מקס׳:</b> ${s.maxPages}`,
        ``,
        `בחר ערך חדש (השורה הראשונה = תוצאות, השנייה = עמודים):`,
      ].join('\n'),
      settingsKeyboard(s),
    );
  });

  bot.command('clearcart', async (ctx) => {
    await ctx.replyWithHTML(
      '⚠️ <b>לנקות את כל העגלה?</b>\nפעולה זו תסיר את כל המוצרים.',
      Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ כן, נקה', 'clearcart_yes'),
          Markup.button.callback('❌ ביטול', 'clearcart_no'),
        ],
      ]),
    );
  });

  bot.command('login', async (ctx) => {
    if (config.RUN_MODE === 'docker') {
      await ctx.replyWithHTML(
        `🔐 פתח את הקישור הבא בדפדפן והתחבר לשופרסל ידנית:\n<a href="${config.NOVNC_URL}">${config.NOVNC_URL}</a>\n\nכשתסיים, הרץ /status.`,
      );
    } else {
      await ctx.reply(
        '🔐 חלון הדפדפן פתוח על המק שלך. עבור אליו, התחבר ידנית, וכשתסיים הרץ /status.',
      );
    }
  });

  bot.command('cart', async (ctx) => {
    const withPhotos = ctx.message.text.includes('תמונות');
    await ctx.reply('🛒 שולח בקשת עגלה לשרת...');
    const cart = await getCart();
    if (withPhotos && cart.lines.length > 0) {
      const media: InputMediaPhoto[] = cart.lines.slice(0, 10).map((l, i) => ({
        type: 'photo',
        media: l.imageUrl ?? `https://picsum.photos/seed/cart-${i}/300/300`,
        caption: `${i + 1}. ${l.name} x${l.qty}`,
      }));
      await ctx.replyWithMediaGroup(media);
    }
    if (cart.lines.length > 0) {
      await ctx.replyWithHTML(cartSummary(cart), cartKeyboard(cart.lines));
    } else {
      await ctx.replyWithHTML(cartSummary(cart));
    }
  });

  bot.command('update', async (ctx) => {
    const args = ctx.message.text.replace(/^\/update(@\S+)?\s*/, '').trim();
    if (!args) {
      await ctx.reply('שימוש: /update <qty> <name> או /update #<idx> <qty>');
      return;
    }
    const cartRefMatch = args.match(/^#(\d+)\s+(\d+)$/);
    if (cartRefMatch) {
      const idx = Number(cartRefMatch[1]);
      const qty = Number(cartRefMatch[2]);
      const before = await getCart();
      const target = before.lines[idx - 1];
      if (!target) {
        await ctx.reply(`לא נמצא פריט #${idx} בעגלה.`);
        return;
      }
      if (qty === 0) await ctx.reply(`🗑 מסיר "${target.name}" מהעגלה...`);
      const after = await setQty(target.sku, qty);
      await ctx.replyWithHTML(
        qty === 0
          ? `✅ "${target.name}" הוסר מהעגלה.`
          : `✅ עודכן: "${target.name}" → x${qty}`,
      );
      logger.info({ chatId: ctx.chat.id, sku: target.sku, qty, total: after.total }, 'cart.updated');
      return;
    }
    const nameMatch = args.match(/^(\d+)\s+(.+)$/);
    if (!nameMatch) {
      await ctx.reply('פורמט לא תקין. דוגמה: /update 3 חלב');
      return;
    }
    const qty = Number(nameMatch[1]);
    const name = (nameMatch[2] ?? '').trim();
    if (qty === 0) await ctx.reply(`🗑 מסיר "${name}" מהעגלה...`);
    const snap = await setQty(name, qty);
    const found = snap.lines.find((l) => l.name.toLowerCase().includes(name.toLowerCase()));
    if (!found && qty > 0) {
      await ctx.reply(`לא נמצא "${name}" בעגלה.`);
      return;
    }
    await ctx.reply(
      qty === 0 ? `✅ "${name}" הוסר מהעגלה.` : `✅ עודכן: "${name}" → x${qty}`,
    );
  });

  bot.command('history', async (ctx) => {
    await ctx.reply(
      '🗂 /history יממוש בשלב 2 (סריקת הזמנות עבר מתוך הפרופיל בשופרסל).',
    );
  });

  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;
    const chatId = ctx.chat.id;

    // ── Handle free-text quantity entry ──────────────────────────────────
    const session = await stateStore.get(chatId);

    // ── Cart edit: user typed a custom qty for an existing cart item ──────
    if (session.pendingCartEdit) {
      const qty = Number(text.replace(',', '.'));
      if (!Number.isFinite(qty) || qty < 0) {
        await ctx.reply('⚠️ מספר לא תקין. הקלד/י מספר (0 = הסר):');
        return;
      }
      const { sku, name } = session.pendingCartEdit;
      session.pendingCartEdit = undefined;
      await stateStore.put(session);
      if (qty === 0) {
        await ctx.reply(`🗑 מסיר "${name}" מהעגלה...`);
        await removeFromCart(sku);
        await ctx.replyWithHTML(`✅ "${name}" הוסר מהעגלה.`);
      } else {
        await ctx.reply(`🔄 מעדכן "${name}" → x${qty}...`);
        await setQty(sku, qty);
        await ctx.replyWithHTML(`✅ עודכן: <b>${name}</b> → x${qty}`);
      }
      return;
    }

    if (session.pendingCustomQty) {
      const qty = Number(text.replace(',', '.'));
      if (!Number.isFinite(qty) || qty <= 0) {
        await ctx.reply('⚠️ מספר לא תקין. הקלד/י מספר חיובי (למשל: 3 או 1.5):');
        return;
      }
      const { itemId, resultIdx } = session.pendingCustomQty;
      const bundle = session.bundles[itemId];
      const product = bundle?.results[resultIdx];
      if (!product) {
        await ctx.reply('המוצר לא נמצא — נסה לחפש שוב.');
        session.pendingCustomQty = undefined;
        await stateStore.put(session);
        return;
      }
      session.pendingCustomQty = undefined;
      await stateStore.put(session);
      await ctx.replyWithHTML(`🔄 מוסיף לעגלה: <b>${product.name}</b> × ${qty}…`);
      try {
        const badge = await addToCart(product, qty);
        recordCartAdd(product, qty);
        await ctx.replyWithHTML(
          `✅ נוסף לעגלה!\n<b>${product.name}</b> × ${qty} — ₪${(product.price * qty).toFixed(2)}\n🛒 סה"כ פריטים בעגלה: <b>${badge}</b>`,
        );
      } catch (err) {
        logger.warn({ err }, 'cart.add.error');
        await ctx.reply('⚠️ לא הצלחתי להוסיף לעגלה. ייתכן שצריך להתחבר — נסה /login');
      }
      await advanceAndSearchNext(ctx, session);
      return;
    }

    const items = await smartParseShoppingList(text);
    if (items.length === 0) {
      await ctx.reply('לא הצלחתי להבין את הרשימה. /help לעזרה.');
      return;
    }

    const removals = items.filter((i) => i.action === 'remove');
    const adds = items.filter((i) => i.action === 'add');

    for (const r of removals) {
      await handleRemoval(ctx, r);
    }
    if (adds.length === 0) return;

    // Start serial flow — search only the first item, advance after each pick/skip
    Object.assign(session, newSession(chatId), { items: adds, bundles: {}, currentIdx: 0 });
    await stateStore.put(session);

    await ctx.replyWithHTML(`📋 קיבלתי רשימה של <b>${adds.length}</b> פריטים. מתחיל לחפש אחד אחד...`);
    await searchAndSendItem(ctx, session);
  });

  bot.on('callback_query', async (ctx) => {
    const cq = ctx.callbackQuery;
    if (!('data' in cq) || !cq.data) return;
    const parts = cq.data.split(':');
    const action = parts[0];
    const itemId = parts[1];
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const session = await stateStore.get(chatId);

    // ── Settings: results per page ───────────────────────────────────────
    if (action === 'setresults') {
      const n = Number(parts[1]);
      if (!Number.isFinite(n) || n < 1 || n > 10) {
        await ctx.answerCbQuery('ערך לא תקין.');
        return;
      }
      session.settings = { ...(session.settings ?? defaultSettings()), resultsPerPage: n };
      await stateStore.put(session);
      await ctx.answerCbQuery(`✅ תוצאות לעמוד: ${n}`);
      await ctx.editMessageReplyMarkup(settingsKeyboard(session.settings).reply_markup).catch(() => {});
      return;
    }

    // ── Settings: max pages ──────────────────────────────────────────────
    if (action === 'setpages') {
      const n = Number(parts[1]);
      if (!Number.isFinite(n) || n < 1 || n > 10) {
        await ctx.answerCbQuery('ערך לא תקין.');
        return;
      }
      session.settings = { ...(session.settings ?? defaultSettings()), maxPages: n };
      await stateStore.put(session);
      await ctx.answerCbQuery(`✅ עמודים מקס׳: ${n}`);
      await ctx.editMessageReplyMarkup(settingsKeyboard(session.settings).reply_markup).catch(() => {});
      return;
    }

    // ── Cancel quantity selection ────────────────────────────────────────
    if (action === 'cancelqty') {
      session.pendingPick = undefined;
      session.pendingCustomQty = undefined;
      await stateStore.put(session);
      await ctx.answerCbQuery('בוטל.');
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
      return;
    }

    // ── Clear cart: request confirmation ────────────────────────────────
    if (action === 'clearcart') {
      await ctx.answerCbQuery();
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
      await ctx.replyWithHTML(
        '⚠️ <b>לנקות את כל העגלה?</b>\nפעולה זו תסיר את כל המוצרים.',
        Markup.inlineKeyboard([
          [
            Markup.button.callback('✅ כן, נקה', 'clearcart_yes'),
            Markup.button.callback('❌ ביטול', 'clearcart_no'),
          ],
        ]),
      );
      return;
    }

    // ── Clear cart: confirmed ────────────────────────────────────────────
    if (action === 'clearcart_yes') {
      await ctx.answerCbQuery('מנקה עגלה…');
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
      await ctx.reply('🗑 מנקה את העגלה...');
      await clearCart();
      await ctx.replyWithHTML('✅ <b>העגלה נוקתה.</b>');
      return;
    }

    // ── Clear cart: cancelled ────────────────────────────────────────────
    if (action === 'clearcart_no') {
      await ctx.answerCbQuery('בוטל.');
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
      return;
    }

    // ── Cart: cancel edit ────────────────────────────────────────────────
    if (action === 'cartcancel') {
      session.pendingCartEdit = undefined;
      await stateStore.put(session);
      await ctx.answerCbQuery('בוטל.');
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
      return;
    }

    // ── Cart: pick item to edit ──────────────────────────────────────────
    if (action === 'cartedit') {
      const sku = parts[1] ?? '';
      const cart = await getCart();
      const line = cart.lines.find((l) => l.sku === sku);
      if (!line) {
        await ctx.answerCbQuery('הפריט לא נמצא בעגלה.');
        return;
      }
      await ctx.answerCbQuery();
      await ctx.replyWithHTML(
        `✏️ <b>${line.name}</b> — כמות נוכחית: x${line.qty}\n\nבחר כמות חדשה:`,
        cartEditKeyboard(sku),
      );
      return;
    }

    // ── Cart: quick qty update ───────────────────────────────────────────
    if (action === 'cartqty') {
      const sku = parts[1] ?? '';
      const qty = Number(parts[2]);
      if (!Number.isFinite(qty) || qty <= 0) {
        await ctx.answerCbQuery('כמות לא תקינה.');
        return;
      }
      await ctx.answerCbQuery(`מעדכן ל-${qty}…`);
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
      await setQty(sku, qty);
      const cart = await getCart();
      const line = cart.lines.find((l) => l.sku === sku);
      await ctx.replyWithHTML(`✅ עודכן: <b>${line?.name ?? sku}</b> → x${qty}`);
      return;
    }

    // ── Cart: custom qty for existing item ───────────────────────────────
    if (action === 'cartcustom') {
      const sku = parts[1] ?? '';
      const cart = await getCart();
      const line = cart.lines.find((l) => l.sku === sku);
      if (!line) {
        await ctx.answerCbQuery('הפריט לא נמצא בעגלה.');
        return;
      }
      session.pendingCartEdit = { sku, name: line.name } satisfies PendingCartEdit;
      await stateStore.put(session);
      await ctx.answerCbQuery();
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
      await ctx.reply('✏️ הקלד/י את הכמות הרצויה (0 = הסר):');
      return;
    }

    // ── Cart: remove item ────────────────────────────────────────────────
    if (action === 'cartremove') {
      const sku = parts[1] ?? '';
      await ctx.answerCbQuery('מסיר…');
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
      const cart = await getCart();
      const line = cart.lines.find((l) => l.sku === sku);
      await removeFromCart(sku);
      await ctx.replyWithHTML(`✅ "<b>${line?.name ?? sku}</b>" הוסר מהעגלה.`);
      return;
    }

    // ── Custom qty → ask user to type a number ───────────────────────────
    if (action === 'customqty') {
      const resultIdx = Number(parts[2]);
      session.pendingCustomQty = { itemId: itemId ?? '', resultIdx } satisfies PendingCustomQty;
      await stateStore.put(session);
      await ctx.answerCbQuery();
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
      await ctx.reply('✏️ הקלד/י את הכמות הרצויה (מספר):');
      return;
    }

    // ── Quantity chosen → add to real cart ──────────────────────────────
    if (action === 'qty') {
      const resultIdx = Number(parts[2]);
      const qtyStr = parts[3];
      const qty = Number(qtyStr);
      if (!Number.isFinite(qty) || qty <= 0) {
        await ctx.answerCbQuery('כמות לא תקינה.');
        return;
      }
      const bundle = itemId ? session.bundles[itemId] : undefined;
      const product = bundle?.results[resultIdx];
      if (!product) {
        await ctx.answerCbQuery('המוצר לא נמצא — נסה לחפש שוב.');
        return;
      }
      session.pendingPick = undefined;
      await ctx.answerCbQuery(`מוסיף ${qty} × ${product.name}…`);
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
      await ctx.reply(`🔄 מוסיף לעגלה: <b>${product.name}</b> × ${qty}…`, { parse_mode: 'HTML' });
      try {
        const badge = await addToCart(product, qty);
        recordCartAdd(product, qty);
        await ctx.replyWithHTML(
          `✅ נוסף לעגלה!\n<b>${product.name}</b> × ${qty} — ₪${(product.price * qty).toFixed(2)}\n🛒 סה"כ פריטים בעגלה: <b>${badge}</b>`,
        );
      } catch (err) {
        logger.warn({ err }, 'cart.add.error');
        await ctx.reply('⚠️ לא הצלחתי להוסיף לעגלה. ייתכן שצריך להתחבר לשופרסל — נסה /login');
      }
      await advanceAndSearchNext(ctx, session);
      return;
    }

    const bundle = itemId ? session.bundles[itemId] : undefined;
    if (!bundle) {
      await ctx.answerCbQuery('פג תוקף של תוצאות החיפוש. שלח שוב.');
      return;
    }
    const item = session.items.find((i) => i.id === itemId);
    if (!item) {
      await ctx.answerCbQuery('הפריט לא נמצא בשיחה.');
      return;
    }

    // ── More results ─────────────────────────────────────────────────────
    if (action === 'more') {
      bundle.cursor = Math.min(
        bundle.cursor + session.settings.resultsPerPage,
        bundle.results.length,
      );
      await stateStore.put(session);
      await ctx.answerCbQuery();
      await sendResultsPage(ctx, item, bundle, session);
      return;
    }

    // ── Skip item ────────────────────────────────────────────────────────
    if (action === 'skip') {
      await ctx.answerCbQuery('דולג…');
      await ctx.reply(`⏭ דילגתי על "${item.name}".`);
      await advanceAndSearchNext(ctx, session);
      return;
    }

    // ── Pick product → ask quantity ───────────────────────────────────────
    if (action === 'pick') {
      const resultIdx = Number(parts[2]);
      const product = bundle.results[resultIdx];
      if (!product) {
        await ctx.answerCbQuery('המוצר לא נמצא.');
        return;
      }
      session.pendingPick = { itemId: item.id, resultIdx, product };
      await stateStore.put(session);
      await ctx.answerCbQuery();
      await ctx.replyWithHTML(
        `🛒 <b>${product.name}</b>\n📦 ${[product.size, product.brand].filter(Boolean).join(' | ')}\n💰 ₪${product.price.toFixed(2)}${product.promo ? `\n🏷 ${product.promo}` : ''}\n\nכמה יחידות תרצה?`,
        {
          reply_markup: quantityKeyboard(item.id, resultIdx, product.sellingMethod).reply_markup,
        },
      );
      return;
    }

    await ctx.answerCbQuery('פעולה לא ידועה.');
  });
}

function buildQuery(item: ShoppingItem): string {
  const parts = [item.name];
  if (item.brand) parts.push(item.brand);
  return parts.join(' ');
}

async function searchAndSendItem(ctx: BotContext, session: ChatSession): Promise<void> {
  const item = session.items[session.currentIdx];
  if (!item) return;

  const total = session.items.length;
  const current = session.currentIdx + 1;

  await ctx.replyWithHTML(`🔎 [${current}/${total}] מחפש: <b>${item.name}</b>…`);

  try {
    const rawResults = await search(buildQuery(item));
    const ranked = await llmRankResults(item, rawResults);
    const results = ranked?.ordered ?? rawResults;
    const exact = ranked
      ? ranked.exact
      : results.some((r) => r.name.toLowerCase().includes(item.name.toLowerCase()));

    const bundle: SearchResultBundle = {
      itemId: item.id,
      query: item.name,
      exact,
      results,
      cursor: 0,
    };
    session.bundles[item.id] = bundle;
    await stateStore.put(session);

    await ctx.replyWithHTML(matchSummary(item.name, exact, results.length));
    await sendResultsPage(ctx, item, bundle, session);
  } catch (err) {
    logger.warn({ err, item: item.name }, 'search.error');
    await ctx.reply(`⚠️ לא הצלחתי לחפש "${item.name}". עובר לפריט הבא...`);
    await advanceAndSearchNext(ctx, session);
  }
}

async function advanceAndSearchNext(ctx: BotContext, session: ChatSession): Promise<void> {
  session.currentIdx += 1;
  await stateStore.put(session);

  if (session.currentIdx >= session.items.length) {
    const total = session.items.length;
    await ctx.replyWithHTML(
      `✅ <b>סיימנו!</b>\nעברנו על כל <b>${total}</b> הפריטים.\n\n/cart לצפייה בעגלה.`,
    );
    return;
  }

  await searchAndSendItem(ctx, session);
}

async function sendResultsPage(
  ctx: BotContext,
  item: ShoppingItem,
  bundle: SearchResultBundle,
  session: ChatSession,
): Promise<void> {
  const { resultsPerPage, maxPages } = session.settings;
  const { cursor, results } = bundle;
  const pageResults = results.slice(cursor, cursor + resultsPerPage);
  if (pageResults.length === 0) {
    await ctx.reply(`לא נמצאו עוד תוצאות עבור "${item.name}".`);
    return;
  }

  const media: InputMediaPhoto[] = pageResults.map((p, i) => ({
    type: 'photo',
    media: p.imageUrl ?? `https://picsum.photos/seed/${p.sku}/400/400`,
    caption: productCaption(cursor + i + 1, p),
  }));

  if (media.length > 0) {
    await ctx.replyWithMediaGroup(media);
  }

  const consumed = cursor + pageResults.length;
  const maxResults = maxPages * resultsPerPage;
  const hasMore = consumed < Math.min(results.length, maxResults);

  const RLM = '\u200F';
  const listText = pageResults
    .map((p, i) => {
      const n = cursor + i + 1;
      const meta = [p.size, p.brand].filter(Boolean).join(' | ');
      const promo = p.promo ? `\n    🏷 ${p.promo}` : '';
      return `${RLM}${n}. <b>${p.name}</b>${meta ? `\n    📦 ${meta}` : ''}\n    💰 ₪${p.price.toFixed(2)}${promo}`;
    })
    .join('\n\n');

  await ctx.replyWithHTML(`🔎 "<b>${item.name}</b>" — בחר אחת מהאפשרויות:\n\n${listText}`, {
    reply_markup: productKeyboard({
      itemId: item.id,
      pageResults,
      pageStartIdx: cursor,
      hasMore,
    }).reply_markup,
  });
}

async function handleRemoval(ctx: BotContext, item: ShoppingItem): Promise<void> {
  if (item.cartIndexRef !== undefined) {
    const cart = await getCart();
    const target = cart.lines[item.cartIndexRef - 1];
    if (!target) {
      await ctx.reply(`לא נמצא פריט #${item.cartIndexRef} בעגלה.`);
      return;
    }
    await ctx.reply(`🗑 מסיר "${target.name}" מהעגלה...`);
    await removeFromCart(target.sku);
    await ctx.replyWithHTML(`✅ "${target.name}" הוסר מהעגלה.`);
    return;
  }
  if (item.name) {
    await ctx.reply(`🗑 מסיר "${item.name}" מהעגלה...`);
    const snap = await removeFromCart(item.name);
    const stillThere = snap.lines.find((l) =>
      l.name.toLowerCase().includes(item.name.toLowerCase()),
    );
    if (stillThere) {
      await ctx.reply(`לא נמצא "${item.name}" בעגלה.`);
    } else {
      await ctx.replyWithHTML(`✅ "${item.name}" הוסר מהעגלה.`);
    }
  }
}
