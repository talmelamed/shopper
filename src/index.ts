import { config } from './config.js';
import { logger } from './util/logger.js';
import { startBrowser, stopBrowser } from './shufersal/browser.js';
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
