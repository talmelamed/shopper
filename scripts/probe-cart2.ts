import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const ctx = await chromium.launchPersistentContext('./auth', {
  headless: false,
  viewport: { width: 1280, height: 800 },
  locale: 'he-IL',
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto('https://www.shufersal.co.il/online/he/cart/cartsummary', {
  waitUntil: 'domcontentloaded',
  timeout: 30_000,
});
await page.waitForTimeout(5000);

// Save full HTML for inspection
const html = await page.content();
writeFileSync('/tmp/shufersal-cart.html', html);
console.log('Saved full HTML to /tmp/shufersal-cart.html');
console.log('HTML length:', html.length);

// Find elements near the price we know exists
const result = await page.evaluate(() => {
  // Find the totalPrice element and walk up to find cart structure
  const totalEl = document.querySelector('.totalPrice');
  let parent = totalEl?.parentElement;
  const ancestors: string[] = [];
  for (let i = 0; i < 8 && parent; i++) {
    ancestors.push(`${parent.tagName}.${parent.className.trim().replace(/\s+/g, '.')} (children: ${parent.children.length})`);
    parent = parent.parentElement;
  }

  // Find all elements with data-product-code (search result tiles aren't here, but cart might have similar)
  const productCodes = Array.from(document.querySelectorAll('[data-product-code]')).map(e => ({
    tag: e.tagName,
    cls: e.className,
    code: e.getAttribute('data-product-code'),
  }));

  // Look for list items or table rows that might be cart entries
  const lists = Array.from(document.querySelectorAll('ul, ol, tbody')).map(l => ({
    tag: l.tagName,
    cls: l.className.substring(0, 80),
    childCount: l.children.length,
    firstChild: l.children[0]?.outerHTML?.substring(0, 400) ?? '',
  })).filter(l => l.childCount > 0 && l.childCount < 30);

  // Look for price elements to find cart line structure
  const prices = Array.from(document.querySelectorAll('[class*="price"], [class*="Price"]')).slice(0, 10).map(e => ({
    cls: e.className.substring(0, 60),
    text: (e.textContent ?? '').trim().substring(0, 50),
    parentCls: e.parentElement?.className?.substring(0, 60) ?? '',
  }));

  return { ancestors, productCodes, lists, prices };
});

console.log('\n--- Ancestors of totalPrice ---');
result.ancestors.forEach(a => console.log(a));

console.log('\n--- Elements with data-product-code ---');
console.log(JSON.stringify(result.productCodes, null, 2));

console.log('\n--- Lists/Tables with children ---');
result.lists.slice(0, 8).forEach(l => {
  console.log(`\n${l.tag}.${l.cls} (${l.childCount} children):`);
  console.log('First child:', l.firstChild);
});

console.log('\n--- Price elements ---');
result.prices.forEach(p => console.log(p));

await ctx.close();
