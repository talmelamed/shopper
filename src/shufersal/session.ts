import { getPage } from './browser.js';
import { sel } from './selectors.js';
import { logger } from '../util/logger.js';

/**
 * Best-effort login detection. Real Phase 2 work: confirm selectors against
 * shufersal.co.il and add response-based checks (e.g., a 401 on a known endpoint).
 */
export async function isLoggedIn(): Promise<boolean> {
  try {
    const page = getPage();
    const marker = await page.$(sel.auth.userIndicator);
    if (marker) return true;
    const loginBtn = await page.$(sel.auth.loginButton);
    return loginBtn === null;
  } catch (err) {
    logger.warn({ err }, 'session.isLoggedIn.error');
    return false;
  }
}

/**
 * Waits up to `timeoutMs` for the login wall to disappear (i.e. for the user
 * to finish logging in manually via the headed Chromium window or noVNC).
 */
export async function waitForLogin(timeoutMs = 5 * 60 * 1000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isLoggedIn()) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}
