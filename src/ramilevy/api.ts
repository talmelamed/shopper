/**
 * Rami Levy API client.
 * All requests run inside the Playwright browser via page.evaluate(fetch(...))
 * so the browser's cookies (auth session) are automatically included.
 */

import { getPage } from '../shufersal/browser.js';
import { logger } from '../util/logger.js';
import { browserQueue } from '../util/queue.js';

export const RL_ORIGIN = 'https://www.rami-levy.co.il';
export const RL_API_ORIGIN = 'https://www-api.rami-levy.co.il';
export const RL_IMG_ORIGIN = 'https://img.rami-levy.co.il';

/** Ensure the browser is on the Rami Levy domain so cookies are in scope. */
export async function ensureOnRL(): Promise<void> {
  const page = getPage();
  if (!page.url().includes('rami-levy')) {
    logger.info('ramilevy.navigate.home');
    await page.goto(`${RL_ORIGIN}/he`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  }
}

/** Authenticated fetch executed inside the browser context. */
export async function rlFetch<T>(
  url: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: unknown,
): Promise<T> {
  await ensureOnRL();
  const page = getPage();
  logger.debug({ method, url }, 'ramilevy.fetch');

  return page.evaluate(
    async ({ url, method, body }) => {
      const opts: RequestInit = {
        method,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      };
      if (body !== undefined) opts.body = JSON.stringify(body);
      const res = await fetch(url, opts);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${url}: ${text.slice(0, 200)}`);
      }
      return res.json() as T;
    },
    { url, method, body } as { url: string; method: string; body: unknown },
  );
}

/** Enqueue a RL operation (uses the shared browserQueue for serialisation). */
export function rlEnqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
  return browserQueue.enqueue(`rl.${key}`, fn);
}
