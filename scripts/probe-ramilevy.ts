/**
 * Rami Levy API probe.
 * Opens a visible browser → you log in manually → then search + add to cart.
 * All XHR/fetch calls are captured and saved to probe-output/ramilevy-requests.json
 *
 * Run:  npx tsx scripts/probe-ramilevy.ts
 * Stop: Ctrl+C  (browser closes, results are saved)
 */

import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as readline from 'node:readline';

const OUT_DIR = resolve('probe-output');
const OUT_FILE = resolve(OUT_DIR, 'ramilevy-requests.json');
const USER_DATA_DIR = resolve('auth-ramilevy');
const BASE_URL = 'https://www.rami-levy.co.il/he';

interface CapturedRequest {
  ts: string;
  method: string;
  url: string;
  resourceType: string;
  headers: Record<string, string>;
  postData: string | null;
  status?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
}

const captured: CapturedRequest[] = [];

// Only capture XHR / fetch / API calls (skip images, fonts, CSS, etc.)
const INTERESTING_TYPES = new Set(['xhr', 'fetch', 'websocket']);
const INTERESTING_URL_PATTERNS = [/api\.rami-levy/, /\/api\//, /graphql/, /search/, /cart/, /product/, /category/];

function isInteresting(url: string, type: string): boolean {
  if (INTERESTING_TYPES.has(type)) return true;
  return INTERESTING_URL_PATTERNS.some((p) => p.test(url));
}

async function save() {
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(captured, null, 2), 'utf8');
  console.log(`\n✅ Saved ${captured.length} requests → ${OUT_FILE}`);
}

async function main() {
  await mkdir(USER_DATA_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: { width: 1400, height: 900 },
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });

  const page = context.pages()[0] ?? (await context.newPage());

  // Intercept all requests
  page.on('request', async (req) => {
    const url = req.url();
    const type = req.resourceType();
    if (!isInteresting(url, type)) return;

    const entry: CapturedRequest = {
      ts: new Date().toISOString(),
      method: req.method(),
      url,
      resourceType: type,
      headers: await req.allHeaders(),
      postData: req.postData(),
    };
    captured.push(entry);
    console.log(`→ [${req.method()}] ${url}`);
  });

  // Also capture responses to see what data comes back
  page.on('response', async (res) => {
    const url = res.url();
    const type = res.request().resourceType();
    if (!isInteresting(url, type)) return;

    const entry = captured.find((e) => e.url === url && !e.status);
    if (!entry) return;

    entry.status = res.status();
    entry.responseHeaders = await res.allHeaders();
    try {
      const body = await res.text();
      // Only store if it looks like JSON / small enough
      if (body.length < 200_000 && (body.startsWith('{') || body.startsWith('['))) {
        entry.responseBody = body;
      }
    } catch {
      // binary or already consumed
    }
  });

  console.log('\n🌐 Opening Rami Levy...');
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('👤 Please log in to your account in the browser.');
  console.log('   Then: search for a product, add one to cart.');
  console.log('   When done → press ENTER here to save and exit.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await new Promise<void>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('', () => { rl.close(); resolve(); });
  });

  await save();
  await context.close();
}

main().catch(async (err) => {
  console.error('Fatal:', err);
  await save();
  process.exit(1);
});
