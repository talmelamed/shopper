import { logger } from '../util/logger.js';
import { RL_API_ORIGIN, rlFetch, rlEnqueue, ensureOnRL } from './api.js';
import { getPage } from '../shufersal/browser.js';

export type RLLoginResult =
  | { ok: true; userId: number }
  | { ok: false; reason: 'nav_failed' | 'api_error' | 'bad_credentials' | 'still_logged_out' };

interface AuthResponse {
  user?: { id: number; email: string; token: string };
  error?: string;
  status?: number;
}

/** Returns true if the browser already has a valid RL session. */
export async function isLoggedIn(): Promise<boolean> {
  return rlEnqueue('session.check', async () => {
    try {
      const res = await rlFetch<{ user?: unknown }>(`${RL_API_ORIGIN}/api/v2/site/clubs/customer/me`);
      return Boolean(res?.user);
    } catch {
      // Try to check via page URL or a simpler endpoint
      try {
        const page = getPage();
        if (!page.url().includes('rami-levy')) {
          await ensureOnRL();
        }
        // Check localStorage for auth token
        const token = await page.evaluate(() => {
          return (
            localStorage.getItem('token') ??
            localStorage.getItem('authToken') ??
            localStorage.getItem('rl_token') ??
            null
          );
        });
        return token !== null;
      } catch {
        return false;
      }
    }
  });
}

/** Logs in to Rami Levy via the API. */
export async function loginWithCredentials(
  email: string,
  password: string,
): Promise<RLLoginResult> {
  return rlEnqueue('session.login', async () => {
    logger.info({ email }, 'ramilevy.login.start');

    try {
      await ensureOnRL();
    } catch (err) {
      logger.warn({ err }, 'ramilevy.login.nav_failed');
      return { ok: false, reason: 'nav_failed' };
    }

    let res: AuthResponse;
    try {
      res = await rlFetch<AuthResponse>(`${RL_API_ORIGIN}/api/v2/site/auth/login`, 'POST', {
        email,
        password,
      });
    } catch (err) {
      logger.warn({ err }, 'ramilevy.login.api_error');
      return { ok: false, reason: 'api_error' };
    }

    if (!res.user?.id) {
      logger.warn({ error: res.error }, 'ramilevy.login.bad_credentials');
      return { ok: false, reason: 'bad_credentials' };
    }

    logger.info({ email, userId: res.user.id }, 'ramilevy.login.success');
    return { ok: true, userId: res.user.id };
  });
}
