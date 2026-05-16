import { chromium } from 'playwright';

const ctx = await chromium.launchPersistentContext('./auth', {
  headless: false,
  viewport: { width: 1280, height: 800 },
  locale: 'he-IL',
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto('https://www.shufersal.co.il/online/he/cart', {
  waitUntil: 'domcontentloaded',
  timeout: 30_000,
});
await page.waitForTimeout(5000);

const result = await page.evaluate(() => {
  const candidates = [
    '.cartItem', '.cart-item', '.miglog-cart-prod', '.CartItem',
    '[class*="cart-item"]', '[class*="cartItem"]', '[class*="CartItem"]',
    'li[class*="cart"]', '.entry', '.cart__entry', '.orderEntry',
    '.cartEntry', '[class*="entry"]', 'tbody tr',
  ];
  const found: Record<string, number> = {};
  for (const s of candidates) {
    const c = document.querySelectorAll(s).length;
    if (c > 0) found[s] = c;
  }

  // Grab first matching cart row HTML
  const firstMatch = Object.keys(found)[0];
  const firstEl = firstMatch ? document.querySelector(firstMatch) : null;
  const firstHtml = firstEl ? firstEl.outerHTML.substring(0, 1500) : 'none';

  // Cart total
  const totalCandidates = ['.order-totals', '.cart-totals', '.totalPrice', '[class*="total"]'];
  const totals: Record<string, string> = {};
  for (const s of totalCandidates) {
    const el = document.querySelector(s);
    if (el) totals[s] = (el.textContent ?? '').trim().substring(0, 100);
  }

  return {
    url: location.href,
    title: document.title,
    found,
    firstHtml,
    totals,
  };
});

console.log('URL:', result.url);
console.log('Title:', result.title);
console.log('Matching selectors:', JSON.stringify(result.found, null, 2));
console.log('Totals:', JSON.stringify(result.totals, null, 2));
console.log('\nFirst matching row HTML:\n', result.firstHtml);

await ctx.close();
