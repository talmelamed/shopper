import { ulid } from 'ulid';
import { config } from '../config.js';
import { logger } from '../util/logger.js';
import type { ShoppingItem } from '../shopping/types.js';
import { parseShoppingList as regexParse } from '../shopping/parser.js';
import { getOpenAI } from './client.js';

const SYSTEM_PROMPT = `You normalize shopping lists for a Shufersal (Israeli supermarket) shopping bot.
Input: free text in ANY language (Hebrew, English, Arabic, Russian, etc.), possibly conversational.
Output: JSON {items: [{name, brand?, qty, weight_kg?, action: "add"|"remove"}]}.

Rules:
- Names MUST be normalized supermarket terms in Hebrew (e.g. "אבקת כביסה" for "laundry powder", "מרכך כביסה" for "fabric softener", "חלב" not "milk").
- Translate all product names to their common Israeli supermarket Hebrew equivalent.
- Strip leading "ה", quantity words, articles. Keep multi-word product names ("חלב בקרטון 3%").
- Quantity: integer >= 1 (default 1). Convert words ("שניים" -> 2, "זוג" -> 2, "שלושה" -> 3, "תריסר" -> 12, "case"/"מארז" -> 1 with qty as stated or 1).
- Weight: extract kg if user said weight (1 kg = 1, 500g = 0.5). When weight is set, leave qty at 1 unless user explicitly said multiple.
- Brand: if user said a known Israeli brand (תנובה, עלית, אסם, שופרסל, אריאל, שטראוס, פרי הגליל, etc.) put it in "brand".
- Action: "remove" if user clearly said remove/הסר/בטל/אל תוסיף; otherwise "add".
- If the user wrote nothing parseable as products, return {items: []}.
- Never invent products the user didn't mention.
- Output ONLY valid JSON, no markdown fences, no commentary.`;

interface LlmItemDraft {
  name: string;
  brand?: string;
  qty?: number;
  weight_kg?: number;
  action?: 'add' | 'remove';
}

function toShoppingItem(draft: LlmItemDraft, rawText: string): ShoppingItem | null {
  if (!draft.name || typeof draft.name !== 'string') return null;
  const item: ShoppingItem = {
    id: ulid(),
    rawText,
    name: draft.name.trim(),
    qty: draft.qty && Number.isFinite(draft.qty) && draft.qty > 0 ? Math.floor(draft.qty) : 1,
    action: draft.action === 'remove' ? 'remove' : 'add',
  };
  if (draft.brand && typeof draft.brand === 'string') item.brand = draft.brand.trim();
  if (draft.weight_kg && Number.isFinite(draft.weight_kg) && draft.weight_kg > 0) {
    item.weightKg = draft.weight_kg;
  }
  return item;
}

/**
 * LLM-assisted shopping list parser. Returns null when LLM is disabled or the
 * call fails — caller should fall back to the regex parser.
 */
export async function llmParseShoppingList(text: string): Promise<ShoppingItem[] | null> {
  const client = getOpenAI();
  if (!client) return null;

  try {
    const completion = await client.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    });
    const raw = completion.choices[0]?.message?.content ?? '{"items":[]}';
    const parsed = JSON.parse(raw) as { items?: LlmItemDraft[] };
    const drafts = Array.isArray(parsed.items) ? parsed.items : [];
    const items = drafts
      .map((d) => toShoppingItem(d, text))
      .filter((x): x is ShoppingItem => x !== null);
    logger.debug({ count: items.length }, 'llm.parse.done');
    return items;
  } catch (err) {
    logger.warn({ err }, 'llm.parse.failed');
    return null;
  }
}

/**
 * Best-of-both: try LLM first (handles conversational input). If it returns
 * nothing or fails, fall back to the deterministic regex parser.
 */
export async function smartParseShoppingList(text: string): Promise<ShoppingItem[]> {
  const llm = await llmParseShoppingList(text);
  if (llm && llm.length > 0) return llm;
  return regexParse(text);
}
