# Accordo AI Backend — Developer Guide

This guide is for engineers working on `Accordo-ai-backend`. For a high-level intro see [README.md](./README.md). For deployment see [DEPLOY.md](./DEPLOY.md).

## Service in one paragraph

A TypeScript / Express backend that owns the procurement domain (requisitions, vendors, contracts, POs) and the negotiation engine (utility-based decision making with INSIGHTS and CONVERSATION modes). Identity / RBAC live in the separate `Accordo-auth` service; both share a Postgres database. The negotiation engine is deterministic — when CONVERSATION mode talks to an LLM, it does so through a hard-boundary intent layer with strict validation, fabrication catches, and template fallbacks that themselves go through the same validator.

## Tech stack

- Node.js 20+ (Alpine in Docker), TypeScript 5+ with ES Modules (`"type": "module"`, `.js` import extensions)
- Express 4.21
- Sequelize 6.37 + PostgreSQL 15+ (pg 8.16)
- Joi + Zod for validation
- Ollama (local, `qwen3` default) with OpenAI auto-fallback
- Embeddings: local ONNX (`@huggingface/transformers`), OpenAI, or AWS Bedrock — chosen by `EMBEDDING_PROVIDER`
- nodemailer + AWS SES for email
- Winston with daily rotation
- Vitest 3 (two configs — unit + integration), 1100+ unit tests

## Architecture

```
                  ┌────────────────────────┐
                  │  Accordo-ai-frontend    │  port 5001
                  └───────────┬────────────┘
                              │
                              ▼
   client ─JWT─►   ┌────────────────────────┐ ───validate───►  ┌──────────────┐
                   │  Accordo-ai-backend     │   /api/auth/    │ Accordo-auth │  port 5003
                   │       (port 5002)       │   validate-token│              │
                   └───────────┬────────────┘ ◄───context──── └──────┬───────┘
                               │                                       │
                               ▼                                       │
                   ┌────────────────────────┐ ◄─ shared ─┐            │
                   │       PostgreSQL        │           ├────────────┘
                   └────────────────────────┘            │
                                                          │
                   ┌────────────────────────┐             │
                   │ Ollama (qwen3) /        │             │
                   │ OpenAI (auto-fallback)  │             │
                   └────────────────────────┘             │
```

## Project layout

```
src/
├── config/
│   ├── env.ts              # Typed env config + defaults
│   ├── database.ts         # Sequelize instance, connectDatabase()
│   ├── logger.ts           # Winston with daily rotation
│   └── swagger.ts
├── loaders/
│   └── express.ts          # Express app factory; helmet, cors, rate-limit, toobusy-js
├── middlewares/
│   ├── auth.middleware.ts  # JWT decode, populates req.context
│   ├── error-handler.ts
│   ├── jwt.ts              # JWT sign/verify helpers
│   ├── request-logger.ts
│   ├── upload.ts           # multer-based file upload
│   └── clean.ts            # Strips null / "null" / "" from req.body
├── models/                 # 40+ Sequelize models (kebab-case files)
├── modules/                # 23 feature modules
│   ├── chatbot/            # Negotiation chatbot (largest)
│   │   ├── engine/         # Deterministic decision engine (~30 files)
│   │   ├── convo/          # CONVERSATION pipeline + state machine
│   │   ├── vendor/         # Vendor agent / simulator
│   │   ├── pdf/            # Deal-summary PDF
│   │   └── prompts/
│   ├── vendor-chat/        # Public vendor portal (uniqueToken auth)
│   ├── bid-analysis/
│   ├── bid-comparison/
│   ├── vector/
│   ├── chat/, negotiation/, requisition/, contract/, po/, …
├── llm/                    # LLM boundary layer
│   ├── persona-renderer.ts
│   ├── validate-llm-output.ts
│   ├── fallback-templates.ts
│   ├── phrasing-history.ts
│   └── arc-summary.ts
├── negotiation/intent/
│   └── build-negotiation-intent.ts
├── delivery/
│   └── simulate-typing-delay.ts
├── metrics/
│   └── log-negotiation-step.ts
├── routes/                 # Aggregator
├── services/               # email, llm, openai, currency, context
├── seeders/
├── types/
└── utils/

migrations/                 # 8 consolidated CommonJS migration files
scripts/                    # Utility scripts (mark-migrations-run, vendor creator, etc.)
tests/
├── unit/                   # No DB; engine + LLM + intent
└── integration/            # Real DB; e2e flows
```

## Module pattern

Every feature module:

```
modules/<feature>/
├── <feature>.controller.ts   # Express handlers — no business logic
├── <feature>.service.ts      # Business logic; calls repo
├── <feature>.repo.ts         # Sequelize queries — only place that touches models
├── <feature>.validator.ts    # Joi / Zod schemas
└── <feature>.routes.ts       # Router definition
```

Same shape across all 23 modules and mirrored in `Accordo-auth`. Controllers don't catch — the global error handler does.

### Adding a new module

1. Create `src/modules/<name>/` with controller, service, repo, validator, routes.
2. Mount the router in `src/routes/index.ts`.
3. If a new model is needed, add it under `src/models/<name>.ts` (kebab-case) and register associations in `src/models/index.ts`.
4. Add Joi / Zod validation in `<name>.validator.ts`.
5. Write unit tests under `tests/unit/<name>/` (mock the repo).

## Request lifecycle

```
src/index.ts
  └─► connectDatabase()                # Auto-create DB if missing → run migrations
        └─► loaders/express.ts
              └─► helmet, cors, json, rate-limit, toobusy-js
                    └─► /api/health    public
                    └─► /api/vendor-chat  public (uniqueToken)
                    └─► /api/auth      proxied to Accordo-auth
                    └─► authMiddleware
                          └─► /api/chatbot, /api/bid-*, /api/requisition, …
                    └─► error-handler  (404 + global)
              └─► deadlineScheduler.start()
              └─► graceful shutdown handlers (SIGTERM/SIGINT)
```

`authMiddleware`:

1. Skips OPTIONS, public routes, and the `/api/auth/*` proxy.
2. Verifies a Bearer JWT against `JWT_ACCESS_TOKEN_SECRET` **or** an `apiKey` + `apiSecret` header pair (service-to-service).
3. Populates `req.context = { userId, userType, companyId?, email? }`.

## Request context

`Express.Request` is augmented in `src/types/express.d.ts`:

```typescript
interface Request {
  context: {
    userId: number;
    userType: "admin" | "customer" | "vendor";
    companyId?: number;
    email?: string;
  };
  user?: User;
}
```

`userType` is read directly from the JWT payload (issued by `Accordo-auth`).

## Negotiation engine

### Two modes

| Mode             | Pipeline                                                                          |
| ---------------- | --------------------------------------------------------------------------------- |
| **INSIGHTS**     | `chatbot.service` → `decide.ts` → `response-generator.ts` (templates)             |
| **CONVERSATION** | `conversation-service.ts` → intent → `persona-renderer.ts` → validator → fallback |

The decision engine is the same; only the rendering layer differs.

### CONVERSATION pipeline (May 2026)

```
vendor message
  ↓ parse-offer.ts
        Indian formats supported: "3.5L"/"1.2Cr", X,XX,XXX comma grouping, plain ₹3,55,000.
  ↓ tone-detector.ts
        Tone (formal/casual/urgent/firm/friendly) + style signals
        (formality, language, hostility, hasQuestion, repeatedOfferCount, …).
  ↓ decideNextMove() in decide.ts
        Deterministic: ACCEPT / COUNTER / MESO / ESCALATE / WALK_AWAY / ASK_CLARIFY.
        - calculateDynamicCounter() applies a round-scaled convergence blend
          (0.10 + round*0.07, capped at 0.5) toward the midpoint with vendor's offer.
        - Minimum-step guard: ≥1% movement when the counter equals the previous PM counter.
        - All counters bounded [targetPrice, maxAcceptablePrice].
  ↓ Endgame state machine (conversation-service.ts)
        Triggered when vendor sits within 10% above max + round ≥ 5.
        Phase transitions tracked on ConversationState:
          MESO_WITH_OTHERS → COUNTER_AT_MAX (2 rounds) → FINAL_MESO_WITH_OTHERS
          → ESCALATE (within 10%) | WALK_AWAY (>10%).
  ↓ Strict max_acceptable enforcement
        Any path that would ACCEPT above max is overridden to COUNTER at max.
        Belt-and-suspenders safety nets in INSIGHTS, Phase2, and CONVERSATION.
  ↓ buildNegotiationIntent()
        HARD BOUNDARY. Strips utility, weights, thresholds, target, max, config.
        Adds vendorStyle, roundNumber, phrasingHistory, openQuestions,
        vendorPriceFormatted (locale-aware), atCeiling.
  ↓ persona-renderer.ts (the only LLM entry point)
        Static system prompt. Temperature 0.5. Adaptive max-words per action.
        First-round greetingHint provides 5 vetted opener styles.
        atCeiling appends firmness phrasing without leaking "max"/"limit"/"ceiling".
        Locale-aware INR (en-IN) when currencySymbol is "₹".
  ↓ validate-llm-output.ts
        - Banned-word list (utility/algorithm/batna/AI identifiers, hard-block).
        - Tier-2 list (only fires within ~60 chars of price/strategy verbs).
        - Fabrication catch (regex): "your X considerations/needs/concerns/...",
          "given/considering your <financial term>", "X is a factor / is a consideration",
          "your/their financial/current arrangement", "my boss/management said".
        - Same-message opener dedup (drops sentences repeating "I appreciate", "Thank you for", …).
        - Cross-message opener dedup via phrasing-history.ts (3-word fingerprint).
        - Identical-message guard: rejects verbatim repeat of the last Accordo message.
        - Price normalization: any token within 1% of allowedPrice rewritten to the
          locale-formatted string (handles comma-grouped, plain, K/L/Cr formats).
        - ISO date sanitizer (YYYY-MM-DD → "Month Day").
        - Grammar pass: leading-letter case, post-period case, missing space after
          period/comma, double-period collapse, plural-noun + "is" → "are" for 14 nouns.
  ↓ fallback-templates.ts (on validation failure)
        Tone-aware humanized templates. 5+ variants per (action × tone).
        getValidatedFallback() runs every fallback through validateLlmOutput()
        (up to 5 attempts) — fallbacks no longer bypass the sanitizer.
        Identical-message excludeContent passed in so fallback pool skips duplicates.
        rewriteOpener() with a 13-entry rotating pool tries opener swap first;
        full template swap only if that's not enough.
  ↓ simulate-typing-delay.ts
        Server-side UX delay scaled by vendor input + Accordo output word counts.
        COUNTER 6–12s, MESO 8–15s, etc.
  ↓ log-negotiation-step.ts
        Winston audit. Logs action / firmness / round / tone / dealId /
        vendorStyle / validationFailureReason / escapeHatchApplied / messageWordCount.
        Health targets documented in the file.
  ↓ Accordo response
```

### NegotiationIntent (the LLM-safe interface)

```typescript
interface NegotiationIntent {
  action:
    | "ACCEPT"
    | "COUNTER"
    | "ESCALATE"
    | "WALK_AWAY"
    | "MESO"
    | "ASK_CLARIFY";
  firmness: number; // 0–1
  commercialPosition: string; // Pre-vetted phrase pool
  allowedPrice?: number; // Only for COUNTER, in [targetPrice, maxAcceptablePrice]
  allowedPaymentTerms?: string;
  allowedDelivery?: string;
  weakestPrimaryParameter?: string;
  offerVariants?: MesoOfferVariant[];
  acknowledgeConcerns: string[]; // Only concerns explicitly listed here may be referenced
  vendorTone: VendorTone;
  vendorStyle?: VendorStyle; // Adaptive humanization signals
  vendorMovement?: "significant" | "moderate" | "minor";
  vendorPriceFormatted?: string; // Locale-aware ("₹3,55,000")
  atCeiling?: boolean; // True when allowedPrice ≈ maxAcceptablePrice
  roundNumber?: number;
  phrasingHistory?: string[];
  openQuestions?: string[];
  currencyCode?: string;
  currencySymbol?: string;
  // dealTitle, vendorName, productCategory passed alongside but never bundled with strategy
}
```

### Hard-boundary invariants

- **The LLM never sees**: utility scores, weights, thresholds, target price, max price, decision-engine config, or any internal state.
- **The LLM only receives**: `NegotiationIntent` + `vendorMessage` + minimal deal metadata.
- **Validation errors → silent fallback template**. The vendor never sees a failure.
- **Vendors always bid on TOTAL contract price**, not per-unit. `total_price` in `Offer` and the config thresholds are total contract values; the config builder multiplies `targetUnitPrice × minOrderQuantity`.

### Endgame state machine

Triggered in `conversation-service.ts` (section 7a) when `vendor.total_price <= 1.10 * maxAcceptablePrice` AND `round >= 5`. State persists on `ConversationState`:

```typescript
{
  endgamePhase: "MESO_WITH_OTHERS" |
    "COUNTER_AT_MAX" |
    "FINAL_MESO_WITH_OTHERS" |
    null;
  endgameCounterRounds: number; // 0–2 in COUNTER_AT_MAX
  endgameMesoRound: number | null; // Round when first endgame MESO shown
  endgameFinalMesoRound: number | null;
}
```

Transitions:

```
detect endgame → MESO_WITH_OTHERS
   vendor selects Others (above max) → COUNTER_AT_MAX
   counter at max for 2 rounds → FINAL_MESO_WITH_OTHERS
   vendor still above max:
     within 10% above → ESCALATE
     beyond 10%        → WALK_AWAY
```

The legacy "repeat-offer escape hatch" is preserved as a fallback for cases the endgame check doesn't catch.

### Locale-aware price formatting

- `humanRoundPrice()` rounds to natural numbers (procurement managers don't quote to the penny). Applied at all 12+ MESO price computation sites and in `calculateDynamicCounter`.
- `formatPriceForDisplay(amount, currencyCode)` uses `en-IN` for INR (`₹3,55,000`) and `en-US` for everything else; strips `.00` for whole numbers. Lives in `src/negotiation/intent/build-negotiation-intent.ts` and is mirrored on the frontend.
- `latestOfferJson.total_price` is persisted as the **rounded** price the vendor was actually shown — keeps the monotonic-floor and auto-accept logic consistent with rendered output.

### LLM safety summary

- `persona-renderer.ts` — the only entry point. Static system prompt (rules 1–17). Temperature 0.5. Adaptive max-words per action.
- `validate-llm-output.ts` — sanitize + validate. Runs on **both** LLM output and fallbacks. See pipeline above for the full check list.
- `fallback-templates.ts` — 5+ humanized variants per (action × tone). Selected via `phrasing-history` to avoid repeats.
- `phrasing-history.ts` — in-process LRU. Records 5-word fingerprint and 3-word opener fingerprint. Provides `rewriteOpener()` for partial template swaps.
- Provider chain: OpenAI (when `OPENAI_API_KEY` set) → Ollama (`LLM_BASE_URL`/`LLM_MODEL`) → templates. The vendor never sees a failure.

## Database

### 40+ models

Organised by domain:

- **Identity / RBAC** (owned by Auth, read here): User, Role, RolePermission, Company, Address, AuthToken, OTP
- **Procurement**: Requisition, RequisitionProduct, RequisitionAttachment, Approval, Contract, PO, Product, Project, ProjectPoc
- **Vendor**: VendorCompany, VendorSelection, VendorBid, VendorNotification, VendorNegotiationProfile
- **Negotiation**: ChatbotDeal, ChatbotMessage, ChatbotTemplate, ChatbotTemplateParameter, MesoRound, Negotiation, NegotiationRound, NegotiationPattern, NegotiationTrainingData
- **Bid analysis**: BidComparison, BidActionHistory
- **Vector / ML**: DealEmbedding, MessageEmbedding, VectorMigrationStatus, ApiUsageLog
- **System**: ChatSession, EmailLog, UserAction

All model files are kebab-case (e.g., `chatbot-deal.ts`, `vendor-company.ts`); associations live in `src/models/index.ts`.

### Migrations

Eight consolidated CommonJS files in `migrations/` cover the full schema. They are intentionally non-incremental — schema changes are added **in-place** to the appropriate file with idempotent helpers (`safeCreateTable`, `safeAddIndex`, `describeTable` checks before `addColumn`). New migration files only for genuinely new domains.

```bash
npm run migrate              # Apply pending migrations
npm run migrate:undo         # Revert last migration
npm run migrate:undo:all     # Revert all migrations
npm run db:reset             # Drop + recreate + migrate + seed (dev only)
```

In production, auto-migration is **disabled** when `NODE_ENV=production`. Run `npm run migrate` manually before each deploy.

### Migrating from the old 46-file set

If your database was set up with the 46 individual migrations, run the marker script once:

```bash
DATABASE_URL=… node scripts/mark-migrations-run.cjs --dry-run   # preview
DATABASE_URL=… node scripts/mark-migrations-run.cjs             # apply
```

Idempotent.

## Configuration

`src/config/env.ts` parses environment variables and exposes a typed config object. Defaults match local dev; production must set real secrets.

### Critical env vars

| Variable                   | Default                        | Notes                                        |
| -------------------------- | ------------------------------ | -------------------------------------------- |
| `PORT`                     | `5002`                         |                                              |
| `NODE_ENV`                 | `development`                  | Controls auto-migrate + auto-seed            |
| `DATABASE_URL`             | —                              | Preferred; managed providers auto-detect SSL |
| `DB_*`                     | local defaults                 | Alternative to DATABASE_URL                  |
| `JWT_ACCESS_TOKEN_SECRET`  | —                              | **Identical to Accordo-auth's value**        |
| `JWT_REFRESH_TOKEN_SECRET` | —                              | Same                                         |
| `LLM_BASE_URL`             | `http://localhost:11434`       | Ollama URL                                   |
| `LLM_MODEL`                | `qwen3`                        | Ollama model                                 |
| `LLM_NEGOTIATION_MODEL`    | —                              | Override model for negotiations only         |
| `OPENAI_API_KEY`           | —                              | Optional; primary provider when set          |
| `OPENAI_MODEL`             | `gpt-4o-mini`                  |                                              |
| `EMBEDDING_PROVIDER`       | `local`                        | `local` (ONNX) / `openai` / `bedrock`        |
| `SMTP_HOST` / `SMTP_*`     | —                              | AWS SES SMTP                                 |
| `VENDOR_PORTAL_URL`        | `http://localhost:5001/vendor` | Used in vendor emails                        |
| `CORS_ORIGIN`              | `*`                            | Comma-separated allow-list                   |
| `FORCE_SEED`               | —                              | Force seed outside dev mode                  |
| `DB_LOGGING`               | `false`                        | Log SQL queries                              |

Full list in [DEPLOY.md](./DEPLOY.md).

## Authentication

### JWT flow

1. Client posts credentials to `Accordo-auth` (`POST /api/auth/login`, port 5003).
2. Auth returns `{ accessToken, refreshToken }`.
3. Client sends `Authorization: Bearer <accessToken>` to this backend.
4. `authMiddleware` either verifies the JWT locally with `JWT_ACCESS_TOKEN_SECRET` **or** calls `Accordo-auth` `/api/auth/validate-token`. Both modes are supported.
5. `req.context` is populated with `{ userId, userType, companyId?, email? }`.

### API key / secret (service-to-service)

When `AUTH_SERVICE_SECRET` is configured on both services, requests can carry `apiKey` + `apiSecret` headers instead of a Bearer token. Used for cron jobs and internal calls without a user context.

## LLM providers

### OpenAI (primary when configured)

Token usage logged to `ApiUsageLog`. Auto-fallback to Ollama on failure. Configurable via `OPENAI_API_KEY` + `OPENAI_MODEL`.

### Ollama (local fallback)

Default model `qwen3`. Set `LLM_BASE_URL=http://host.docker.internal:11434` for Docker. Override the negotiation-only model with `LLM_NEGOTIATION_MODEL`.

### Templates (last resort)

If both providers fail or validation rejects all retries, `fallback-templates.ts` produces a humanized response. `getValidatedFallback()` runs the chosen template through the same validator, with up to 5 attempts. The vendor never sees a fallback.

## Email

AWS SES via nodemailer. Required env: `SMTP_HOST` (`email-smtp.<region>.amazonaws.com`), `SMTP_PORT` (typically 465), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_EMAIL`. The sender address must be verified with SES.

For local testing run MailHog and point `SMTP_HOST=localhost`, `SMTP_PORT=5004`.

## Background jobs

### Bid-comparison deadline scheduler

`src/modules/bid-comparison/scheduler/deadline-checker.ts`. Cron started in `loaders/express.ts` after the HTTP server boots. Runs comparisons when bid-collection deadlines pass.

## Testing

Two Vitest configs:

- `vitest.unit.config.ts` — no DB. Covers `src/llm/**`, `src/negotiation/**`, `src/modules/chatbot/engine/**`, `src/services/**`, etc.
- `vitest.config.ts` — integration. Requires PostgreSQL with `DB_NAME_TEST` (defaults to `accordo_test`). Setup file enforces test-only DB names so production data can't be wiped.

### Running

```bash
npm run test:unit            # No DB
npm run test:unit:watch
npm run test:unit:coverage

npm test                     # Integration; needs DB
npm run test:watch
npm run test:coverage

npx vitest run path/to.test.ts
npx vitest -t "test name"
```

### Test helpers

- `tests/helpers/setup.ts` — DB sync/teardown for integration runs
- `tests/helpers/factories.ts` — test-data factories

## Coding conventions

- **All imports use `.js` extensions** (TypeScript ESM):

  ```typescript
  import { User } from "../models/user.js"; // correct
  import { User } from "../models/user"; // wrong, runtime error
  ```

- **Files**: kebab-case with dot-separation (`bid-comparison.controller.ts`, `parse-offer.ts`).
- **Folders**: kebab-case (`bid-analysis/`, `vendor-chat/`).
- **Routes**: RESTful, kebab-case (`/api/vendor-chat`, `/api/bid-analysis`).
- **Route params**: camelCase (`:userId`, `:requisitionId`).
- **Throw, don't return errors**. The global error handler renders them.
- **Joi / Zod validates everything** that crosses a route boundary.
- **No verbose CRUD prefixes**:

  ```typescript
  // Correct
  router.post('/',         createHandler);
  router.get('/:id',       getHandler);

  // Wrong
  router.post('/create',   ...);
  router.get('/get/:id',   ...);
  ```

## Key patterns

### Hard-boundary intent layer

The single most important rule: **strategy stays out of the LLM**. Adding any field to `NegotiationIntent` that exposes a threshold, weight, target, or max breaks the model. Use signals derived from the vendor message (tone, style, repetition) — those are safe.

### Non-destructive migrations

Schema changes go in-place into the eight base files. Helpers (`safeAddColumn`, `describeTable`-then-`addColumn`) make migrations re-runnable. Never write a migration that drops or alters production data without a migration plan.

### Graceful shutdown

`SIGTERM` / `SIGINT` close the HTTP server, stop the cron scheduler, and disconnect the Sequelize pool. Containers should send SIGTERM with a >10s grace period.

### Price model

Vendors always bid on TOTAL contract price. `total_price` in `Offer` and config thresholds (`target`, `max_acceptable`, `anchor`) are total contract values. The config builder in `chatbot.service.ts` multiplies `targetUnitPrice × minOrderQuantity`.

## Logging

### Winston configuration (`src/config/logger.ts`)

- Daily rotation under `logs/combined/` (14d) and `logs/error/` (30d)
- Structured JSON in production; coloured human format in development

### Negotiation audit log

`src/metrics/log-negotiation-step.ts` writes per-turn rows with `action / firmness / round / tone / dealId / vendorStyle / validationFailureReason / escapeHatchApplied / messageWordCount / fromLlm`. Health targets documented inline:

- `fallbackRate` (= 1 − `fromLlm`): target < 15%
- `validationFailureReason` distribution: no single rule > 50%
- `messageWordCount` per action: COUNTER/MESO 25–80, REJECT 20–60, ACCEPT 8–40, ASK 10–40
- `escapeHatchApplied`: < 5% of turns

## Common gotchas

- **Auto-migrate is disabled in production.** Run `npm run migrate` manually before each deploy. Forgetting this is the #1 deploy bug.
- **Phrasing-history cache is per-Node-process.** Multi-instance deployments fragment fingerprints. Documented as accepted; swap to Redis behind the same `phrasing-history.ts` API if it ever matters.
- **JWT secrets are required in production.** `resolveJwtSecret()` in `src/config/env.ts` throws at startup when `JWT_ACCESS_TOKEN_SECRET` / `JWT_REFRESH_TOKEN_SECRET` are unset under `NODE_ENV=production`. In dev a random 32-byte hex secret is generated per-process — by design, so accidental fallbacks never reach prod.
- **`OPENAI_MODEL` defaults to `gpt-4o-mini`.** If you swap it for a more expensive model, watch `ApiUsageLog`.
- **`humanRoundPrice` is intentionally lossy.** Don't introduce a new MESO/counter price calc that bypasses it — vendors notice "rounder" prices.
- **`atCeiling` is a string-affecting flag**. Setting it in the intent layer changes phrasing in the persona renderer ("our best position") without telling the LLM the literal max. Don't expose the max value as a workaround.
- **The endgame state machine lives in conversation-service**, not the engine. Strategy intentionally bypasses the LLM rendering layer when needed.
- **Sequelize sequence drift**: if `INSERT` fails with `id must be unique`, run `SELECT setval('"<Table>_id_seq"', (SELECT MAX(id) FROM "<Table>"));`.
- **The 503 under load** comes from `toobusy-js` shedding. Scale up or reduce CPU pressure; don't disable.
- **`FORCE_SEED` only fires when `NODE_ENV=development` or `FORCE_SEED=true`** — it's not a flag the seed scripts read on their own.

## Related repos

- `Accordo-auth` — JWT issuance and validation, RBAC tables (port 5003)
- `Accordo-ai-frontend` — React UI (port 5001)
