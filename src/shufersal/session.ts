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

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: 'nav_failed' | 'form_not_found' | 'submit_failed' | 'still_logged_out' };

/**
 * Fills in the Shufersal login form with the supplied credentials and submits it.
 * Returns whether the login succeeded.
 */
export async function loginWithCredentials(
  email: string,
  password: string,
): Promise<LoginResult> {
  const page = getPage();
  try {
    await page.goto(sel.auth.loginPageUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  } catch (err) {
    logger.warn({ err }, 'login.nav_failed');
    return { ok: false, reason: 'nav_failed' };
  }

  try {
    await page.waitForSelector(sel.auth.emailInput, { timeout: 8_000 });
    await page.fill(sel.auth.emailInput, email);
    await page.fill(sel.auth.passwordInput, password);
  } catch (err) {
    logger.warn({ err }, 'login.form_not_found');
    return { ok: false, reason: 'form_not_found' };
  }

  try {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {}),
      page.click(sel.auth.submitButton),
    ]);
  } catch (err) {
    logger.warn({ err }, 'login.submit_failed');
    return { ok: false, reason: 'submit_failed' };
  }

  // Give the page a moment to settle (redirects, cookie writes, etc.)
  await page.waitForTimeout(2_000);

  const loggedIn = await isLoggedIn();
  logger.info({ email, loggedIn }, 'login.credentials.result');
  return loggedIn ? { ok: true } : { ok: false, reason: 'still_logged_out' };
}
