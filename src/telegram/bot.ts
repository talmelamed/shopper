import { Telegraf, type Context } from 'telegraf';
import { ulid } from 'ulid';
import { config } from '../config.js';
import { logger } from '../util/logger.js';
import { registerHandlers } from './handlers.js';

export interface BotContext extends Context {
  requestId: string;
}

export function buildBot(): Telegraf<BotContext> {
  const bot = new Telegraf<BotContext>(config.TELEGRAM_BOT_TOKEN);

  bot.use(async (ctx, next) => {
    (ctx as BotContext).requestId = ulid();
    const log = logger.child({
      requestId: (ctx as BotContext).requestId,
      chatId: ctx.chat?.id,
      userId: ctx.from?.id,
    });
    log.debug({ updateType: ctx.updateType }, 'telegram.update');
    await next();
  });

  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId || !config.ALLOWED_USER_IDS.includes(userId)) {
      logger.warn({ userId }, 'telegram.unauthorized');
      if (ctx.chat) {
        await ctx.reply('🚫 משתמש לא מורשה.');
      }
      return;
    }
    await next();
  });

  registerHandlers(bot);

  bot.catch((err, ctx) => {
    logger.error(
      { err, requestId: (ctx as BotContext).requestId, chatId: ctx.chat?.id },
      'telegram.handler.error',
    );
    void ctx.reply('⚠️ משהו השתבש — נסה /reset ושוב.').catch(() => {});
  });

  return bot;
}
