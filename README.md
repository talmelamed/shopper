# shopper

A Telegram-driven shopping agent that drives [shufersal.co.il](https://www.shufersal.co.il/) via Playwright. You send a shopping list to the bot; it searches each item, returns paginated product cards (4 per page, up to 5 pages = 20 results), and adds your selections to the Shufersal cart. Manual login and final checkout stay with you.

> See [PLAN.md](PLAN.md) for the full architecture, decisions, and roadmap.

---

## Status

**Phase 1 — Scaffolding (current).** End-to-end Telegram UX runs against *hardcoded fake search results* so you can verify the flow before we wire real Shufersal DOM scraping. All 9 MVP commands stubbed.

Real Shufersal selectors land in **Phase 2** (`src/shufersal/selectors.ts`, `search.ts`, `cart.ts`, `session.ts`).

---

## Quick start (local, headed Chromium on macOS)

```bash
# 1. Install dependencies
npm install
npm run playwright:install

# 2. Configure
cp .env.example .env
# Edit .env: set TELEGRAM_BOT_TOKEN and ALLOWED_USER_IDS at minimum.

# 3. Run
npm run dev
```

A real Chromium window opens on your Mac. When the bot tells you to log in, switch to that window and sign in with your Shufersal account. Cookies persist in `./auth/` across restarts.

---

## Run on a server / phone (Docker + noVNC)

```bash
cp .env.example .env
# Edit .env: TELEGRAM_BOT_TOKEN, ALLOWED_USER_IDS, NOVNC_PASSWORD (highly recommended)

docker compose up -d --build
docker compose logs -f shopper
```

Then open `http://127.0.0.1:6080/vnc.html` (or the URL you set in `NOVNC_URL`) in any browser to see the live Chromium window. Log in to Shufersal there once; the session sticks via the `./auth/` volume.

**Security warning.** `docker-compose.yml` binds noVNC to `127.0.0.1:6080` on purpose. If you want to reach it from outside the host:

1. **Always** set `NOVNC_PASSWORD` in `.env` so `x11vnc` enforces auth.
2. Prefer fronting it with **Caddy / Tailscale / Cloudflare Tunnel** rather than exposing port 6080 raw. The browser sees your live Shufersal session.

---

## Creating the Telegram bot

1. Open Telegram, talk to [@BotFather](https://t.me/BotFather), run `/newbot`, follow the prompts.
2. Copy the token into `TELEGRAM_BOT_TOKEN` in `.env`.
3. Find your own Telegram user ID via [@userinfobot](https://t.me/userinfobot). Put it in `ALLOWED_USER_IDS` (comma-separated for multiple).
4. (Optional) Send `/setcommands` to BotFather with:

```
start - התחל
help - עזרה מלאה
cart - הצג עגלה
update - עדכן כמות בעגלה
login - התחבר לשופרסל
status - בדוק סטטוס
history - הזמנות עבר
reset - נקה שיחה
```

---

## Commands

| Command | What it does |
|---|---|
| `/start` | Welcome message |
| `/help` | Full Hebrew help (mirrors the old myShopper bot) |
| `/cart` | Show cart as numbered list + total |
| `/cart תמונות` | Same as `/cart` with product images |
| `/update <qty> <name>` | Set qty by product name (`0` removes) |
| `/update #<idx> <qty>` | Set qty by cart index |
| `/login` | Tells you how to perform the manual login |
| `/status` | Login state + browser health + queue depth |
| `/reset` | Clear current chat session |
| `/history` | (Phase 2) Re-shop a past Shufersal order |

Any plain text is treated as a shopping list. Supported syntax (full reference in `/help`):

- One per line **or** comma-separated: `2 חלב, 3 לחם, ביצים`
- Quantity prefix: `2 חלב` / suffix: `חלב x2`
- Weight: `1 ק"ג עגבניות`, `500 גרם גבינה`
- Brand: `קפה שחור 3 @עלית` or `שמן זית 2 מותג:שופרסל`
- Remove: `הסר חלב` or `הסר #3`

---

## Project layout

```
src/
  config.ts                 zod-validated env
  index.ts                  boot browser + bot, graceful shutdown
  shopping/
    parser.ts               free-text -> ShoppingItem[]
    session.ts              per-chat state machine
    types.ts                Product, CartLine, etc.
  shufersal/
    browser.ts              Playwright persistent context
    search.ts               (stub) search Shufersal
    cart.ts                 (stub) add/remove/setQty/getCart
    session.ts              (stub) login detection
    selectors.ts            DOM selectors (verify in Phase 2)
  state/
    store.ts                InMemoryStore + JsonFileStore (atomic)
  telegram/
    bot.ts                  Telegraf instance, auth middleware
    handlers.ts             all 9 MVP commands + callback router
    keyboards.ts            inline keyboards for product pages
    formatters.ts           captions, summaries
    help.ts                 verbatim Hebrew /help text
  util/
    logger.ts               pino + pino-pretty
    queue.ts                FIFO serializer around the browser
tests/
  parser.test.ts            12 cases covering all input formats
auth/                       persistent Chromium profile (gitignored, chmod 700)
state/                      per-chat JSON snapshots (gitignored)
traces/                     screenshots/traces on failure (gitignored)
```

---

## Development

```bash
npm run dev           # watch mode with tsx
npm run typecheck     # tsc --noEmit
npm run test          # vitest run
npm run test:watch    # vitest watch
npm run lint          # eslint .
npm run format        # prettier --write .
```

---

## What's next (Phase 2)

Open `src/shufersal/selectors.ts`, run `npx playwright codegen https://www.shufersal.co.il` against the live site, and replace each `TODO(phase-2)` in `search.ts`, `cart.ts`, `session.ts` with real Playwright actions. The Telegram layer doesn't need to change — all it consumes is the typed `Product[]` / `CartSnapshot` interface, which the stubs already honour.

After that, Phase 3 adds `/history` order scraping, `/profile`, and `/preferences`.
