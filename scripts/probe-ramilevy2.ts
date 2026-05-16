/**
 * Rami Levy API probe – round 2 (cart operations).
 * Opens browser with existing session → add to cart / update qty / remove.
 * Saves results to probe-output/ramilevy-requests2.json
 * Stops when probe-output/done.txt is created (run: touch probe-output/done.txt)
 */

import { chromium } from 'playwright';
import { writeFile, mkdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const OUT_DIR = resolve('probe-output');
const OUT_FILE = resolve(OUT_DIR, 'ramilevy-requests2.json');
const DONE_FILE = resolve(OUT_DIR, 'done.txt');
const USER_DATA_DIR = resolve('auth-ramilevy');
const BASE_URL = 'https://www.rami-levy.co.il/he';

interface CapturedRequest {
  ts: string;
  method: string;
  url: string;
  resourceType: string;
  postData: string | null;
  status?: number;
  responseBody?: string;
}

const captured: CapturedRequest[] = [];

const SKIP_HOSTS = ['google', 'datadoghq', 'nr-data', 'glassix', 'analytics', 'recaptcha', 'rum', 'replay', 'ccm'];
const KEEP_PATTERNS = [/rami-levy\.co\.il\/api/, /www-api\.rami-levy/, /api\/v2/, /catalog/, /cart/, /search/, /product/];

function isInteresting(url: string, type: string): boolean {
  if (SKIP_HOSTS.some((h) => url.includes(h))) return false;
  if (type === 'xhr' || type === 'fetch') return true;
  return KEEP_PATTERNS.some((p) => p.test(url));
}

async function save() {
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(captured, null, 2), 'utf8');
  console.log(`\n✅ Saved ${captured.length} requests → ${OUT_FILE}`);
}

async function waitForDone() {
  console.log('\n⏳ Watching for probe-output/done.txt ...');
  console.log('   When done: run `touch probe-output/done.txt` in another terminal\n');
  while (true) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      await access(DONE_FILE);
      return; // file exists
    } catch {
      // not yet
    }
  }
}

async function main() {
  // Clean previous done file
  try { await import('node:fs').then(fs => fs.promises.rm(DONE_FILE, { force: true })); } catch {}

  await mkdir(USER_DATA_DIR, { recursive: true });
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    await import('node:fs/promises').then(fs => fs.rm(resolve(USER_DATA_DIR, f), { force: true })).catch(() => {});
  }

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: { width: 1400, height: 900 },
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });

  const page = context.pages()[0] ?? (await context.newPage());

  page.on('request', async (req) => {
    const url = req.url();
    const type = req.resourceType();
    if (!isInteresting(url, type)) return;
    const entry: CapturedRequest = {
      ts: new Date().toISOString(),
      method: req.method(),
      url,
      resourceType: type,
      postData: req.postData(),
    };
    captured.push(entry);
    console.log(`→ [${req.method().padEnd(4)}] ${url}`);
    if (req.postData()) console.log(`         body: ${req.postData()?.slice(0, 200)}`);
  });

  page.on('response', async (res) => {
    const url = res.url();
    if (!isInteresting(url, res.request().resourceType())) return;
    const entry = [...captured].reverse().find((e) => e.url === url && !e.status);
    if (!entry) return;
    entry.status = res.status();
    try {
      const body = await res.text();
      if (body.length < 100_000 && (body.startsWith('{') || body.startsWith('['))) {
        entry.responseBody = body;
        console.log(`   ↩ ${res.status()} ${url.split('?')[0]}`);
        console.log(`         ${body.slice(0, 300)}`);
      }
    } catch {}
  });

  console.log('\n🌐 Opening Rami Levy (with existing session)...');
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🛒 Please:');
  console.log('   1. Search for any product');
  console.log('   2. Add it to cart');
  console.log('   3. Go to cart and change a quantity');
  console.log('   4. Remove an item');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await waitForDone();
  await save();
  await context.close();
}

main().catch(async (err) => {
  console.error('Fatal:', err);
  await save();
  process.exit(1);
});
