/* eslint-disable no-console */
import { smartParseShoppingList } from '../src/llm/parser.js';
import { llmRankResults } from '../src/llm/ranker.js';
import { search } from '../src/shufersal/search.js';
import { config } from '../src/config.js';

const QUERY = process.argv[2] ?? 'שוקולד';

async function main() {
  console.log(`\n=== LLM probe — model: ${config.OPENAI_MODEL} ===\n`);

  console.log(`[1/3] Parsing user text: "${QUERY}"`);
  const items = await smartParseShoppingList(QUERY);
  console.log(`     parsed ${items.length} item(s):`);
  for (const it of items) {
    console.log(
      `       - name="${it.name}" brand=${it.brand ?? '(none)'} qty=${it.qty} weightKg=${it.weightKg ?? '-'} action=${it.action}`,
    );
  }
  if (items.length === 0) {
    console.log('     (nothing to rank) — done');
    return;
  }

  const target = items[0];
  if (!target) {
    console.log('     (no target item) — done');
    return;
  }
  console.log(`\n[2/3] Calling stub search() for: "${target.name}"`);
  const raw = await search(target.name);
  console.log(`     got ${raw.length} stub products`);
  raw.slice(0, 8).forEach((p, i) => {
    console.log(`       ${i}. ${p.name} | brand=${p.brand} | ₪${p.price}`);
  });

  console.log(`\n[3/3] LLM ranker reordering against user intent...`);
  const ranked = await llmRankResults(target, raw);
  if (!ranked) {
    console.log('     ranker returned null (LLM disabled or failed)');
    return;
  }
  console.log(`     exact=${ranked.exact}, ordered top 5:`);
  ranked.ordered.slice(0, 5).forEach((p, i) => {
    console.log(`       ${i + 1}. ${p.name} | brand=${p.brand} | ₪${p.price}`);
  });

  console.log('\nDone.\n');
}

main().catch((err) => {
  console.error('PROBE FAILED:', err);
  process.exit(1);
});
