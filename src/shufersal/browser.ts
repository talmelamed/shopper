import { chromium, type BrowserContext, type Page } from 'playwright';
import { mkdir, chmod, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { config } from '../config.js';
import { logger } from '../util/logger.js';

let _context: BrowserContext | null = null;
let _page: Page | null = null;

async function ensureProfileDir(): Promise<string> {
  const dir = resolve(config.USER_DATA_DIR);
  await mkdir(dir, { recursive: true });
  try {
    await chmod(dir, 0o700);
  } catch (err) {
    logger.warn({ dir, err }, 'browser.profile.chmod_failed');
  }
  return dir;
}

export async function startBrowser(): Promise<{ context: BrowserContext; page: Page }> {
  if (_context && _page) return { context: _context, page: _page };

  const userDataDir = await ensureProfileDir();

  // Remove stale Chromium singleton lock files so restarts never deadlock
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    await rm(join(userDataDir, f), { force: true }).catch(() => {});
  }
  const headless = config.RUN_MODE === 'local' ? config.HEADLESS : false;

  logger.info({ runMode: config.RUN_MODE, headless, userDataDir }, 'browser.starting');

  const rdpPort = config.REMOTE_DEBUGGING_PORT;
  const args = [
    '--disable-blink-features=AutomationControlled',
    '--no-sandbox',
    '--disable-dev-shm-usage',
  ];
  if (headless && rdpPort > 0) {
    args.push(`--remote-debugging-port=${rdpPort}`);
    logger.info(
      { url: `http://localhost:${rdpPort}` },
      'browser.remote_debug — open chrome://inspect in Chrome/Edge to view',
    );
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    viewport: { width: 1280, height: 900 },
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    ignoreHTTPSErrors: config.RUN_MODE === 'docker',
    args,
  });

  const page = context.pages()[0] ?? (await context.newPage());

  context.on('close', () => {
    logger.warn('browser.context.closed');
    _context = null;
    _page = null;
  });

  await page.goto(config.SHUFERSAL_URL, { waitUntil: 'domcontentloaded' });

  _context = context;
  _page = page;
  logger.info('browser.ready');
  return { context, page };
}

export async function stopBrowser(): Promise<void> {
  if (!_context) return;
  try {
    await _context.close();
  } catch (err) {
    logger.warn({ err }, 'browser.stop.error');
  } finally {
    _context = null;
    _page = null;
  }
}

export function getPage(): Page {
  if (!_page) throw new Error('Browser not started yet — call startBrowser() first');
  return _page;
}
