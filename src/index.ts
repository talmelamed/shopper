import { config } from './config.js';
import { logger } from './util/logger.js';
import { startBrowser, stopBrowser } from './shufersal/browser.js';
import { isLoggedIn, loginWithCredentials } from './shufersal/session.js';
import { buildBot } from './telegram/bot.js';

async function main(): Promise<void> {
  logger.info(
    {
      runMode: config.RUN_MODE,
      shufersalUrl: config.SHUFERSAL_URL,
      allowedUsers: config.ALLOWED_USER_IDS.length,
    },
    'shopper.boot',
  );

  await startBrowser();

  // Auto-login on startup if credentials are configured and session is not live
  if (config.SHUFERSAL_EMAIL && config.SHUFERSAL_PASSWORD) {
    const alreadyLoggedIn = await isLoggedIn().catch(() => false);
    if (alreadyLoggedIn) {
      logger.info('autologin.skipped — session already active');
    } else {
      logger.info({ email: config.SHUFERSAL_EMAIL }, 'autologin.start');
      const result = await loginWithCredentials(config.SHUFERSAL_EMAIL, config.SHUFERSAL_PASSWORD);
      if (result.ok) {
        logger.info('autologin.success');
      } else {
        logger.warn({ reason: result.reason }, 'autologin.failed — use /login to retry manually');
      }
    }
  }

  const bot = buildBot();

  const shutdown = async (signal: string) => {
    logger.warn({ signal }, 'shopper.shutdown.start');
    try {
      bot.stop(signal);
    } catch (err) {
      logger.warn({ err }, 'shopper.shutdown.bot.error');
    }
    await stopBrowser();
    logger.warn('shopper.shutdown.done');
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  const me = await bot.telegram.getMe();
  logger.info({ username: me.username, id: me.id }, 'telegram.identity');

  await bot.telegram.setMyCommands([
    { command: 'cart', description: 'הצג עגלת קניות' },
    { command: 'clearcart', description: 'נקה את כל העגלה' },
    { command: 'settings', description: 'הגדרות חיפוש' },
    { command: 'login', description: 'התחבר לשופרסל' },
    { command: 'status', description: 'בדוק חיבור' },
    { command: 'reset', description: 'נקה שיחה נוכחית' },
    { command: 'help', description: 'עזרה' },
  ]);

  // Telegraf's launch() resolves only when bot.stop() is called, so don't await.
  void bot.launch();
  logger.info({ username: me.username }, 'shopper.ready');
}

main().catch((err) => {
  logger.fatal({ err }, 'shopper.boot.fatal');
  process.exit(1);
});
