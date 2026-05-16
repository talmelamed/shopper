import 'dotenv/config';
import { z } from 'zod';

const csvNumbers = z
  .string()
  .min(1, 'ALLOWED_USER_IDS must contain at least one Telegram user ID')
  .transform((s) => s.split(',').map((p) => p.trim()).filter(Boolean))
  .pipe(z.array(z.string().regex(/^\d+$/, 'Each user ID must be numeric')).min(1))
  .transform((arr) => arr.map((id) => Number(id)));

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(10, 'TELEGRAM_BOT_TOKEN is required'),
  ALLOWED_USER_IDS: csvNumbers,

  RUN_MODE: z.enum(['local', 'docker']).default('local'),
  HEADLESS: z
    .string()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true'),

  NOVNC_URL: z.string().url().default('http://127.0.0.1:6080/vnc.html'),
  NOVNC_PASSWORD: z.string().optional().default(''),
  REMOTE_DEBUGGING_PORT: z.coerce.number().int().min(0).max(65535).default(9222),

  USER_DATA_DIR: z.string().default('./auth'),
  STATE_DIR: z.string().default('./state'),
  TRACES_DIR: z.string().default('./traces'),

  SHUFERSAL_URL: z.string().url().default('https://www.shufersal.co.il'),

  RESULTS_PER_PAGE: z.coerce.number().int().positive().max(10).default(4),
  MAX_PAGES: z.coerce.number().int().positive().max(10).default(5),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
});

export type AppConfig = z.infer<typeof schema>;

function load(): AppConfig {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.`,
    );
  }
  return parsed.data;
}

export const config: AppConfig = load();
