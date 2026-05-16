import { config } from '../config.js';
import { logger } from '../util/logger.js';
import type { Product, ShoppingItem } from '../shopping/types.js';
import { getOpenAI } from './client.js';

const SYSTEM_PROMPT = `You match Shufersal product search results against a user's shopping-list item.
Given the user's item (name + optional brand + qty + weight) and a list of raw search results,
return the indices of products that genuinely match what the user asked for, in best-first order.

Rules:
- Use Hebrew product knowledge. "חלב" should match milk products, not chocolate milk drinks.
- Honor brand: if user said brand=תנובה, prefer/keep only תנובה products. If brand was unspecified, all brands OK.
- Honor weight/size: if user said 1 ק"ג, prefer 1kg packages.
- "exact" = true only when at least one returned product unambiguously matches the user's name AND brand (if specified).
- Never invent indices outside 0..N-1.
- Be inclusive when reasonable — include partial matches but rank them lower.

Output ONLY JSON: {"exact": boolean, "indices": [int...]}.
`;

export interface RankResult {
  exact: boolean;
  ordered: Product[];
}

interface LlmRankResponse {
  exact?: boolean;
  indices?: unknown;
}

/**
 * Re-rank search results against a user's intent using the LLM.
 * Returns null when LLM is disabled or the call fails — caller should keep
 * the raw Shufersal order in that case.
 */
export async function llmRankResults(
  item: ShoppingItem,
  results: Product[],
): Promise<RankResult | null> {
  const client = getOpenAI();
  if (!client || results.length === 0) return null;

  const compact = results.map((p, i) => ({
    i,
    name: p.name,
    brand: p.brand ?? null,
    size: p.size ?? null,
    price: p.price,
    promo: p.promo ?? null,
  }));

  const userMsg = JSON.stringify(
    {
      item: {
        name: item.name,
        brand: item.brand ?? null,
        qty: item.qty,
        weight_kg: item.weightKg ?? null,
      },
      candidates: compact,
    },
    null,
    0,
  );

  try {
    const completion = await client.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    });
    const raw = completion.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as LlmRankResponse;
    const indices: number[] = Array.isArray(parsed.indices)
      ? (parsed.indices as unknown[])
          .filter((x): x is number => typeof x === 'number' && Number.isInteger(x))
          .filter((i) => i >= 0 && i < results.length)
      : [];

    const seen = new Set<number>();
    const ordered: Product[] = [];
    for (const i of indices) {
      if (seen.has(i)) continue;
      seen.add(i);
      const p = results[i];
      if (p) ordered.push(p);
    }
    for (let i = 0; i < results.length; i++) {
      if (seen.has(i)) continue;
      const p = results[i];
      if (p) ordered.push(p);
    }
    const exact = Boolean(parsed.exact) && indices.length > 0;
    logger.debug({ kept: indices.length, exact }, 'llm.rank.done');
    return { exact, ordered };
  } catch (err) {
    logger.warn({ err }, 'llm.rank.failed');
    return null;
  }
}
