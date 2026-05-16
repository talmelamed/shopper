import OpenAI from 'openai';
import { config } from '../config.js';
import { logger } from '../util/logger.js';

let _client: OpenAI | null = null;
let _warned = false;

export function getOpenAI(): OpenAI | null {
  if (!config.OPENAI_API_KEY) {
    if (!_warned) {
      logger.info('llm.disabled (OPENAI_API_KEY is empty)');
      _warned = true;
    }
    return null;
  }
  if (!_client) {
    _client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
    logger.info({ model: config.OPENAI_MODEL }, 'llm.enabled');
  }
  return _client;
}

export function isLlmEnabled(): boolean {
  return Boolean(config.OPENAI_API_KEY);
}
