import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';

const QUERY = process.argv[2] ?? 'שוקולד';
const SHUFERSAL = 'https://www.shufersal.co.il';

async function main() {
  await mkdir('./probe-output', { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
  });
  const page = await ctx.newPage();

  console.log(`\n[1/4] Opening ${SHUFERSAL}...`);
  await page.goto(SHUFERSAL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log(`     title: ${await page.title()}`);

  console.log(`\n[2/4] Searching for: ${QUERY}`);
  // Try a few likely search selectors
  const candidates = [
    'input#js-site-search-input',
    'input[name="text"]',
    'input[type="search"]',
    'input[placeholder*="חיפוש" i]',
    '.search input',
  ];
  let typedInto: string | null = null;
  for (const sel of candidates) {
    const el = await page.$(sel);
    if (el) {
      try {
        await el.fill(QUERY);
        typedInto = sel;
        console.log(`     filled selector: ${sel}`);
        break;
      } catch {
        /* try next */
      }
    }
  }
  if (!typedInto) {
    console.log('     could not find search input; falling back to direct URL');
    await page.goto(
      `${SHUFERSAL}/online/he/search?text=${encodeURIComponent(QUERY)}`,
      { waitUntil: 'domcontentloaded', timeout: 60000 },
    );
  } else {
    await page.keyboard.press('Enter');
    await page.waitForLoadState('domcontentloaded', { timeout: 60000 });
  }

  console.log(`\n[3/4] Settling for 5s, then sampling DOM...`);
  await page.waitForTimeout(5000);
  console.log(`     final URL: ${page.url()}`);
  console.log(`     final title: ${await page.title()}`);

  await page.screenshot({ path: './probe-output/search-results.png', fullPage: true });
  await writeFile('./probe-output/search-results.html', await page.content());

  // Try to find product tiles using a long list of candidate selectors.
  const tileSelectors = [
    '.miglog-prod',
    '.product-tile',
    '.SEARCH .item',
    '[data-product-code]',
    '[data-product-id]',
    '.product-card',
    'li.miglog-prod',
    'article[itemtype*="Product"]',
  ];

  const tileCounts: Record<string, number> = {};
  for (const sel of tileSelectors) {
    tileCounts[sel] = await page.locator(sel).count();
  }
  console.log(`\n[4/4] Tile-selector hits:`);
  for (const [sel, n] of Object.entries(tileCounts)) {
    console.log(`     ${n.toString().padStart(3)}  ${sel}`);
  }

  // Pick the winner and extract first 5 tiles
  const winner = Object.entries(tileCounts).sort((a, b) => b[1] - a[1])[0];
  if (winner && winner[1] > 0) {
    const [winSel, winCount] = winner;
    console.log(`\nWinner: ${winSel} (${winCount} tiles). Dumping first 5:`);
    const tiles = await page.locator(winSel).all();
    for (let i = 0; i < Math.min(5, tiles.length); i++) {
      const t = tiles[i];
      if (!t) continue;
      const inner = await t.evaluate((el) => {
        const text = (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim().slice(0, 200);
        const img = (el.querySelector('img') as HTMLImageElement | null)?.src ?? null;
        const attrs: Record<string, string> = {};
        for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;
        return { text, img, attrs };
      });
      console.log(`\n  [${i}] attrs:`, JSON.stringify(inner.attrs, null, 2));
      console.log(`      text: ${inner.text}`);
      console.log(`      img:  ${inner.img}`);
    }
  } else {
    console.log(
      '\nNo product tiles found with any candidate selector. Check probe-output/search-results.html.',
    );
  }

  await browser.close();
  console.log('\nDone. See probe-output/ for screenshot and HTML dump.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
