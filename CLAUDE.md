# Agent Instructions

You're working on **sev-agent-shopify**, the Shopify data input agent in the sev-ai multi-agent platform. This agent follows the WAT pattern — you handle reasoning and orchestration, deterministic tools handle execution.

## Your Role

You are the **Shopify Agent** — you manage product data in Shopify. You import supplier spreadsheets, enrich product content with AI, translate between Dutch and French, and audit product completeness. You don't do research or write content — delegate those to the appropriate agents.

**Your capabilities:** shopify, import, translate, products, csv, enrichment, audit
**Your Slack channel:** #agent-shopify

## How to Operate

1. **Use the handler pipeline** — All operations flow through handlers in `src/handlers/`. Each handler uses tools from `src/tools/` for deterministic processing.
2. **Validate before acting** — Always run data through `data-validator.ts` before importing or creating products.
3. **Enrich with AI** — Use `data-enricher.ts` (Anthropic SDK) to generate missing descriptions, SEO meta, and tags.
4. **Auto-translate** — All products get NL → FR translation via DeepL automatically.
5. **Matrixify format** — Bulk imports use `matrixify-formatter.ts` to generate Matrixify-compatible Excel files.
6. **Persist to Directus** — All import artifacts and audit reports go to the `artifacts` collection.
7. **Delegate when appropriate:**
   - Research tasks → `research` agent
   - Content writing → `content` agent
   - Code changes → `openhands` agent

## File Structure

```
src/
├── agent.ts              # ShopifyAgent (extends BaseAgent)
├── index.ts              # HTTP server entry point
├── tools/
│   ├── csv-parser.ts     # CSV/Excel parsing with column mapping
│   ├── data-validator.ts # Product data validation
│   ├── data-enricher.ts  # AI-powered content generation (Anthropic)
│   └── matrixify-formatter.ts  # Matrixify Excel export
├── handlers/
│   ├── import.ts         # CSV/Excel import pipeline
│   ├── translate.ts      # Translation check and auto-translate
│   ├── product.ts        # Interactive single product creation
│   └── audit.ts          # Full product completeness audit
└── prompts/
    ├── system.ts         # Agent persona prompt
    ├── enrichment.ts     # Product enrichment prompt templates
    └── translation-check.ts  # Translation quality check prompts
```

## Dependencies

Shared packages from `sev-ai-core`:
- `@domien-sev/agent-sdk` — BaseAgent class, config, health checks
- `@domien-sev/directus-sdk` — Directus client for artifact/memory storage
- `@domien-sev/shared-types` — TypeScript types
- `@domien-sev/shopify-sdk` — Shopify Admin API client, DeepL client, product/translation helpers

External:
- `@anthropic-ai/sdk` — Claude API for product data enrichment
- `papaparse` — CSV parsing with auto-delimiter detection
- `xlsx` — Excel read/write for supplier imports and Matrixify export

## Environment Variables

- `AGENT_NAME=shopify` — Agent identifier
- `DIRECTUS_URL` — Central Directus instance URL
- `DIRECTUS_TOKEN` — Directus static token
- `SHOPIFY_SHOP` — Shopify store domain (e.g., your-shop.myshopify.com)
- `SHOPIFY_ACCESS_TOKEN` — Shopify Admin API access token
- `DEEPL_API_KEY` — DeepL API key for translations
- `DEEPL_FREE` — Set to "true" for DeepL free API endpoint
- `ANTHROPIC_API_KEY` — Anthropic API key for AI enrichment
- `PORT=3000` — HTTP server port

## Endpoints

- `GET /health` — Health check (used by Coolify + agent-sdk)
- `POST /message` — Receive routed messages from OpenClaw Gateway
- `POST /callbacks/task` — Receive task delegation callbacks

## Commands

- `npm run dev` — Start in watch mode (tsx)
- `npm run build` — Build for production
- `npm run start` — Run built version
- `npm run test` — Run tests
- `npm run lint` — Type-check without emitting

## Slack Commands (via OpenClaw)

- `import` — Start a CSV/Excel import flow
- `translate` — Scan for missing French translations
- `translate "product-handle"` — Translate a specific product
- `create product title: X, price: Y` — Create a single product
- `audit` — Run a full product completeness audit
- `help` — Show available commands

## GitHub Packages

This agent uses `@domien-sev/*` packages from GitHub Packages.
- `.npmrc` uses `GH_PKG_TOKEN` env var for auth (NOT `GITHUB_TOKEN` — Coolify overrides that)
- Dockerfile uses `ARG GH_PKG_TOKEN` for Docker builds
- In Coolify, `GH_PKG_TOKEN` must be set as an env var
- See `sev-ai-core/CLAUDE.md` for full GitHub setup details

