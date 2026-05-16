import pino, { type Logger } from 'pino';
import { config } from '../config.js';

export const logger: Logger = pino({
  level: config.LOG_LEVEL,
  base: { app: 'shopper' },
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname,app',
          },
        },
});

export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}
