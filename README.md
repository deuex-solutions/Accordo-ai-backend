# Accordo AI — Backend

AI-powered B2B procurement negotiation backend built with TypeScript, Node.js, Express, Sequelize, and PostgreSQL. Owns the procurement domain (requisitions, vendors, contracts, POs), the negotiation engine, and the deal lifecycle. Identity and RBAC live in the separate `Accordo-auth` service.

For deeper docs, see:

- [DEVELOPER.md](./DEVELOPER.md) — module layout, decision engine, intent pipeline, conventions, gotchas
- [DEPLOY.md](./DEPLOY.md) — production runbook, env vars, Docker, troubleshooting

## What this service does

- **Procurement domain**: companies, projects, products, requisitions, vendors, contracts, POs.
- **Negotiation engine**: utility-based decision making with two modes — INSIGHTS (deterministic) and CONVERSATION (LLM-rendered with a hard boundary). Owns counter-offer generation, MESO options, an endgame state machine, and a strict `max_acceptable` ceiling.
- **Vendor portal**: token-authenticated MESO flow for vendors (no JWT).
- **Bid analysis & comparison**: cross-vendor bid comparison, winner selection, PDF reports.
- **Vector / RAG**: deal/message embeddings via local ONNX, OpenAI, or Bedrock.
- **Email**: vendor notifications, deal summaries, contract emails (AWS SES via nodemailer).

What it does **not** do: identity, JWT issuance, RBAC tables. Those live in `Accordo-auth` (port 5003). The two services share a Postgres database.

## Quick start

```bash
npm install
cp .env.example .env
# Edit .env: DB credentials, JWT secrets, OPENAI_API_KEY (optional), SMTP_*
npm run dev
```

Default port **5002**. Health check: `GET /api/health`. Swagger UI: `http://localhost:5002/api-docs`.

PostgreSQL must be running. The app auto-creates the database if it doesn't exist and runs migrations on startup (see [DEPLOY.md](./DEPLOY.md) for the production override).

## Tech stack

- **Runtime**: Node.js 20+ (Alpine in Docker), TypeScript 5+ with ES Modules
- **Framework**: Express 4.21
- **Database**: PostgreSQL 15+ via Sequelize 6.37 (pg 8.16)
- **Validation**: Joi + Zod
- **LLM**: Ollama (local, default `qwen3`) with OpenAI auto-fallback (`OPENAI_MODEL`)
- **Embeddings**: local ONNX (`@huggingface/transformers`) | OpenAI | AWS Bedrock — chosen by `EMBEDDING_PROVIDER`
- **Email**: nodemailer + AWS SES
- **PDF**: PDFKit + Chart.js
- **Logging**: Winston with daily rotation
- **Testing**: Vitest 3 (unit + integration configs), 1100+ unit tests

## Commands

```bash
# Development
npm run dev              # tsx watch, auto-reload TypeScript
npm run dev:clean        # Kill existing dev processes and restart
npm run dev:kill         # Kill dev processes only

# Build & production
npm run build            # tsc → dist/
npm start                # node dist/index.js
npm run type-check       # Type-check without emit

# Database
npm run migrate          # Apply pending migrations
npm run migrate:undo     # Revert last migration
npm run migrate:undo:all # Revert all migrations
npm run db:reset         # Drop + recreate + migrate + seed (fresh start)
npm run seed             # Seed dev data
npm run seed:comprehensive  # Full test scenarios

# Testing (Vitest — two configs)
npm run test:unit        # Unit tests, no DB needed
npm run test:unit:watch  # Watch mode
npm run test:unit:coverage
npm test                 # Integration tests, requires DB
npm run test:watch
npm run test:coverage

# Single file
npx vitest run tests/unit/llm/validateLlmOutput.test.ts

# Code quality
npm run lint             # ESLint on src/**/*.ts
```

## Project layout

```
src/
├── config/              # env, database, logger, swagger
├── loaders/             # Express app factory
├── middlewares/         # auth, error-handler, jwt, request-logger, upload, clean
├── models/              # 40+ Sequelize models
├── modules/             # 23 feature modules
│   ├── auth/            # JWT validation hooks (Auth service issues tokens)
│   ├── chatbot/         # Negotiation chatbot (largest module)
│   │   ├── engine/      # Deterministic decision engine
│   │   ├── convo/       # CONVERSATION mode pipeline
│   │   ├── vendor/      # Vendor agent / simulator
│   │   ├── pdf/         # Deal-summary PDF generation
│   │   └── prompts/     # LLM prompt templates
│   ├── vendor-chat/     # Public vendor MESO portal (uniqueToken auth)
│   ├── bid-analysis/    # Bid comparison + winner selection
│   ├── bid-comparison/  # Multi-vendor comparison + PDF reports
│   ├── vector/          # Embeddings + semantic search
│   ├── chat/            # LLM chat sessions
│   ├── negotiation/     # Negotiation tracking
│   └── …                # project, product, company, po, role, dashboard, document
├── llm/                 # LLM boundary layer
│   ├── persona-renderer.ts     # Only entry point to the LLM
│   ├── validate-llm-output.ts  # Sanitize + reject; runs on LLM and fallbacks
│   ├── fallback-templates.ts   # Tone-aware humanized templates
│   ├── phrasing-history.ts     # Cross-message dedup + opener rotation
│   └── arc-summary.ts
├── negotiation/intent/
│   └── build-negotiation-intent.ts   # Hard boundary Decision → Intent
├── delivery/
│   └── simulate-typing-delay.ts      # Server-side UX delay
├── metrics/
│   └── log-negotiation-step.ts       # Audit / observability
├── routes/              # Route aggregator
├── services/            # email, llm, openai, currency, context
├── seeders/             # Database seeders
├── types/               # Shared TypeScript types
└── utils/

migrations/              # 8 consolidated CommonJS migration files
tests/
├── unit/                # No DB; engine + LLM + intent tests
└── integration/         # Real DB; e2e flows
```

### Module pattern

Each feature module follows:

```
modules/<feature>/
├── <feature>.controller.ts   # Express handlers — no business logic
├── <feature>.service.ts      # Business logic, calls repo
├── <feature>.repo.ts         # Sequelize queries — only place that touches models
├── <feature>.validator.ts    # Joi / Zod schemas
└── <feature>.routes.ts       # Router definition
```

## Environment

Copy `.env.example` to `.env`. Critical values:

| Variable                   | Default                        | Purpose                                                |
| -------------------------- | ------------------------------ | ------------------------------------------------------ |
| `PORT`                     | `5002`                         | API server port                                        |
| `NODE_ENV`                 | `development`                  | `development` / `production`                           |
| `DATABASE_URL`             | —                              | Connection string (preferred); managed providers       |
| `DB_HOST` / `DB_PORT` / …  | local defaults                 | Discrete vars (alternative to `DATABASE_URL`)          |
| `JWT_ACCESS_TOKEN_SECRET`  | —                              | **Must match `Accordo-auth`'s value**                  |
| `JWT_REFRESH_TOKEN_SECRET` | —                              | **Must match `Accordo-auth`'s value**                  |
| `LLM_BASE_URL`             | `http://localhost:11434`       | Ollama URL                                             |
| `LLM_MODEL`                | `qwen3`                        | Ollama model                                           |
| `LLM_NEGOTIATION_MODEL`    | —                              | Override model used for negotiation only               |
| `OPENAI_API_KEY`           | —                              | OpenAI fallback (auto-falls back to Ollama on failure) |
| `OPENAI_MODEL`             | `gpt-4o-mini`                  | OpenAI model                                           |
| `EMBEDDING_PROVIDER`       | `local`                        | `local` / `openai` / `bedrock`                         |
| `SMTP_HOST` / `SMTP_*`     | —                              | AWS SES SMTP for email                                 |
| `VENDOR_PORTAL_URL`        | `http://localhost:5001/vendor` | Vendor portal base URL (used in emails)                |
| `CORS_ORIGIN`              | `*`                            | Comma-separated allow-list                             |
| `FORCE_SEED`               | —                              | Force seeding outside dev mode                         |

See [DEPLOY.md](./DEPLOY.md) for the full env-var matrix and production guidance.

## API surface

All routes under `/api`. Highlights:

| Group             | Base path                                                          | Auth        |
| ----------------- | ------------------------------------------------------------------ | ----------- |
| Health            | `/api/health`                                                      | public      |
| Vendor Chat       | `/api/vendor-chat`                                                 | uniqueToken |
| Auth              | `/api/auth/*`                                                      | (proxied)   |
| Chatbot           | `/api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId` | JWT         |
| Bid Analysis      | `/api/bid-analysis`                                                | JWT         |
| Bid Comparison    | `/api/bid-comparison`                                              | JWT         |
| Requisition       | `/api/requisition`                                                 | JWT         |
| Contract / PO     | `/api/contract`, `/api/po`                                         | JWT         |
| Vendor / Company  | `/api/vendor`, `/api/company`                                      | JWT         |
| Product / Project | `/api/product`, `/api/project`                                     | JWT         |
| Dashboard         | `/api/dashboard`                                                   | JWT         |
| Vector / RAG      | `/api/vector`                                                      | JWT         |
| Document          | `/api/document`                                                    | JWT         |

### Negotiation chatbot — nested deal routes

```
GET    /requisitions/:rfqId/vendors/:vendorId/deals
POST   /requisitions/:rfqId/vendors/:vendorId/deals
GET    /requisitions/:rfqId/vendors/:vendorId/deals/:dealId
GET    /requisitions/:rfqId/vendors/:vendorId/deals/:dealId/config
GET    /requisitions/:rfqId/vendors/:vendorId/deals/:dealId/utility
GET    /requisitions/:rfqId/vendors/:vendorId/deals/:dealId/summary
POST   /requisitions/:rfqId/vendors/:vendorId/deals/:dealId/messages
POST   /requisitions/:rfqId/vendors/:vendorId/deals/:dealId/reset
POST   /requisitions/:rfqId/vendors/:vendorId/deals/:dealId/archive
POST   /requisitions/:rfqId/vendors/:vendorId/deals/:dealId/unarchive
POST   /requisitions/:rfqId/vendors/:vendorId/deals/:dealId/simulate
```

### Vendor-chat (public, token-authenticated)

```
POST   /api/vendor-chat/quote                    # Submit initial quote
GET    /api/vendor-chat/can-edit-quote           # Quote editable check
PUT    /api/vendor-chat/quote                    # Edit quote (pre-message)
GET    /api/vendor-chat/deal                     # Vendor view of deal (PM targets stripped)
POST   /api/vendor-chat/enter                    # Enter chat (creates opening message)
POST   /api/vendor-chat/message                  # Send vendor message
POST   /api/vendor-chat/pm-response              # Get AI PM response
POST   /api/vendor-chat/meso/select              # Select MESO option (auto-accepts)
POST   /api/vendor-chat/meso/others              # Submit custom counter
POST   /api/vendor-chat/final-offer/confirm      # Confirm/deny final offer
```

## Negotiation engine

Two modes share the same deterministic engine; only the rendering layer differs.

| Mode             | Render path                                                               |
| ---------------- | ------------------------------------------------------------------------- |
| **INSIGHTS**     | `chatbot.service` → `decide.ts` → `response-generator.ts` (templates)     |
| **CONVERSATION** | `conversation-service.ts` → intent pipeline → `persona-renderer.ts` (LLM) |

The CONVERSATION pipeline:

```
vendor message
  ↓ parse-offer.ts                   # Extract price, terms, delivery (Indian formats supported: lakh/crore, X,XX,XXX)
  ↓ tone-detector.ts                 # Tone + style signals
  ↓ decideNextMove() in decide.ts    # Deterministic: ACCEPT/COUNTER/MESO/ESCALATE/WALK_AWAY
  ↓ endgame state machine            # When vendor sits within 10% above max + round ≥ 5
  ↓ buildNegotiationIntent()         # HARD BOUNDARY — strips utility/weights/thresholds
  ↓ persona-renderer.ts              # Only LLM entry point (temp 0.5)
  ↓ validate-llm-output.ts           # Banned words, fabrication catch, opener dedup, price normalization
  ↓ fallback-templates.ts (on fail)  # Validated again, never bypasses sanitizer
  ↓ simulate-typing-delay.ts         # Server-side UX delay
  ↓ log-negotiation-step.ts          # Winston audit
  ↓ Accordo response
```

Key invariants:

- **The LLM never sees**: utility scores, weights, thresholds, target price, max price, config.
- **The LLM only receives**: a `NegotiationIntent` plus the vendor message and minimal deal metadata (`dealTitle`, `vendorName`, `productCategory`).
- **`allowedPrice` only goes to the LLM for COUNTER**, always within `[targetPrice, maxAcceptablePrice]`.
- **Strict `max_acceptable` ceiling**: any path that would ACCEPT above max is overridden to COUNTER at max (defence-in-depth in INSIGHTS, Phase2, and CONVERSATION).
- **Vendors always bid on TOTAL contract price**, not per-unit.

See [DEVELOPER.md](./DEVELOPER.md) for the full pipeline anatomy, the endgame state machine, the language guardrails, and the locale-aware price-formatting rules.

## Database

PostgreSQL with Sequelize. Eight consolidated migration files (`migrations/*.cjs`) cover the full schema:

| #   | File                          | Tables                                                                |
| --- | ----------------------------- | --------------------------------------------------------------------- |
| 1   | `foundation.cjs`              | Companies, Modules, Roles, User, AuthTokens, Otps, RolePermissions, … |
| 2   | `projects-products.cjs`       | Products, Projects, ProjectPocs                                       |
| 3   | `requisitions.cjs`            | Requisitions, RequisitionProducts, Attachments, Approvals             |
| 4   | `vendors-contracts.cjs`       | VendorCompanies, Contracts, Pos, EmailLogs                            |
| 5   | `chatbot-core.cjs`            | chatbot_templates, chatbot_deals, chatbot_messages, meso_rounds, …    |
| 6   | `bid-analysis.cjs`            | vendor_bids, bid_comparisons, bid_action_histories, vendor_selections |
| 7   | `vectors-ml.cjs`              | embeddings, training_data, ApiUsageLogs, Negotiations, ChatSessions   |
| 8   | `indexes-and-constraints.cjs` | Deferred FK constraints                                               |

Migrations are non-destructive (`alter: false`). Schema changes are added in-place to the relevant file with idempotent helpers — no new migration files except for genuinely new domains. Details in [DEVELOPER.md](./DEVELOPER.md).

### Migrating from the old 46-file migration set

If your DB was set up with the older 46 migrations, run the marker script once before deploying the new code:

```bash
DATABASE_URL=your-url node scripts/mark-migrations-run.cjs --dry-run  # preview
DATABASE_URL=your-url node scripts/mark-migrations-run.cjs            # apply
```

Idempotent — safe to run repeatedly.

## Docker

Single `Dockerfile` with multi-stage build (`dev` and `prod` targets) and a single `docker-compose.yml` with profiles. Full runbook in [DEPLOY.md](./DEPLOY.md). Quick reference:

```bash
# Dev (hot reload, auto-seed, volume-mounted source)
docker compose --profile dev up -d --build

# Prod (compiled JS, resource limits, JSON log rotation)
docker compose --profile prod up -d --build

# Direct image builds
docker build --target dev  -t accordo-backend:dev  .
docker build --target prod -t accordo-backend:prod .
```

In Docker, Ollama is reached at `http://host.docker.internal:11434`.

## Port configuration

| Service         | Port     | Notes                          |
| --------------- | -------- | ------------------------------ |
| Frontend        | 5001     | React/Vite (separate repo)     |
| **Backend API** | **5002** | **This Express server**        |
| Auth service    | 5003     | `Accordo-auth` (separate repo) |
| MailHog SMTP    | 5004     | Email testing                  |
| MailHog Web UI  | 5005     | View test emails               |

> Port 5000 is reserved by macOS AirPlay Receiver.

## Naming conventions

| Area              | Convention                     | Example                                            |
| ----------------- | ------------------------------ | -------------------------------------------------- |
| Source files      | kebab-case with dot-separation | `bid-comparison.controller.ts`, `parse-offer.ts`   |
| Folders           | kebab-case                     | `bid-analysis/`, `vendor-chat/`, `bid-comparison/` |
| Route paths       | RESTful, kebab-case            | `/api/vendor-chat`, `/api/bid-analysis`            |
| Route params      | camelCase                      | `:userId`, `:requisitionId`                        |
| Import extensions | `.js` (TypeScript ESM)         | `import { User } from '../models/user.js'`         |

```typescript
// RESTful — correct
router.post('/',         createHandler);
router.get('/:id',       getHandler);

// Verbose CRUD — wrong
router.post('/create',   ...);
router.get('/get/:id',   ...);
```

## Troubleshooting

| Symptom                              | Fix                                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| `ECONNREFUSED` on DB                 | PostgreSQL not running, or wrong creds in `.env`.                                       |
| Migrations fail                      | DB doesn't exist; the app auto-creates it but needs admin access (`DB_ADMIN_DATABASE`). |
| `OpenAI 401/429`                     | Bad `OPENAI_API_KEY`; system auto-falls back to Ollama → templates.                     |
| Ollama `ECONNREFUSED`                | Run `ollama serve` or set `LLM_BASE_URL` correctly (or rely on OpenAI only).            |
| Email not sending                    | SES SMTP creds wrong or sender not verified in SES.                                     |
| Contract create: `id must be unique` | `SELECT setval('"Contracts_id_seq"', (SELECT MAX(id) FROM "Contracts"));`               |
| 503 responses under load             | `toobusy-js` shed shedding; scale up or reduce CPU pressure.                            |
| `FORCE_SEED` not running             | Only fires when `NODE_ENV=development` or `FORCE_SEED=true` is explicit.                |

More detail in [DEPLOY.md](./DEPLOY.md).

## Email testing locally

```bash
docker run -d -p 5004:1025 -p 5005:8025 mailhog/mailhog
```

View captured email at `http://localhost:5005`.

## Related repos

- `Accordo-auth` — issues and validates JWTs (port 5003)
- `Accordo-ai-frontend` — React UI (port 5001)

## License

Proprietary — Accordo AI
