# Accordo-AI Backend — Developer Guide

## Tech Stack

| Layer      | Technology                                           |
| ---------- | ---------------------------------------------------- |
| Runtime    | Node.js 20, TypeScript 5.7 (ESM)                     |
| Framework  | Express 4.21                                         |
| Database   | PostgreSQL 15+ via Sequelize 6.37                    |
| Auth       | JWT (jsonwebtoken + bcrypt)                          |
| LLM        | OpenAI GPT-3.5 → Ollama (qwen3) → fallback templates |
| Email      | Nodemailer + AWS SES SMTP                            |
| Validation | Joi 17 + Zod 4                                       |
| Logging    | Winston 3 with daily rotation                        |
| Testing    | Vitest 4 + Supertest                                 |
| Docs       | Swagger (swagger-jsdoc + swagger-ui-express)         |

---

## Quick Start

```bash
# Prerequisites: PostgreSQL running, Node 20+

npm install
cp .env.example .env           # edit DB creds, JWT secrets
npm run dev                     # starts on http://localhost:5002
```

The dev server auto-creates the database, runs migrations, seeds data, and watches for file changes.

### Available Scripts

| Script              | Description                             |
| ------------------- | --------------------------------------- |
| `npm run dev`       | Dev server with hot-reload (tsx watch)  |
| `npm run build`     | Compile TypeScript → `dist/`            |
| `npm start`         | Run compiled production build           |
| `npm run migrate`   | Run pending Sequelize migrations        |
| `npm run seed`      | Seed development data                   |
| `npm run test:unit` | Unit tests — no DB required (441 tests) |
| `npm test`          | Integration tests — requires test DB    |
| `npm run lint`      | ESLint                                  |

---

## Project Structure

```
src/
├── index.ts                          # Entry point: DB connect → Express → cron → graceful shutdown
├── config/
│   ├── env.ts                        # Environment config builder (all env vars)
│   ├── database.ts                   # Sequelize setup, auto-create DB, migrations, seeding
│   ├── logger.ts                     # Winston: console + daily rotate files
│   └── swagger.ts                    # Swagger/OpenAPI spec generator
│
├── loaders/
│   └── express.ts                    # Express app factory (middleware stack, route mounting)
│
├── routes/
│   └── index.ts                      # Route aggregator: /api/* → modules
│
├── middlewares/
│   ├── auth.middleware.ts            # JWT / API-key auth → req.context
│   ├── clean.middleware.ts           # Strip null/"null"/"" from request body
│   ├── error-handler.ts             # Global error handler + 404
│   └── upload.middleware.ts          # Multer: images, documents
│
├── models/                           # 42 Sequelize models
│   ├── index.ts                      # Model registry + associations
│   ├── user.ts, role.ts, company.ts  # Core entities
│   ├── chatbotDeal.ts, chatbotMessage.ts  # Negotiation data
│   ├── requisition.ts, contract.ts   # Procurement entities
│   ├── vendorCompany.ts, vendorBid.ts     # Vendor entities
│   ├── bidComparison.ts             # Bid analysis
│   └── dealEmbedding.ts             # Vector/RAG support
│
├── modules/                          # Feature modules (controller → service → repo)
│   ├── auth/                         # Login, JWT refresh, OTP, multi-user
│   ├── chatbot/                      # AI Negotiation — the core module
│   │   ├── chatbot.service.ts        # Orchestration (~5,844 lines)
│   │   ├── chatbot.controller.ts     # Request handlers
│   │   ├── chatbot.routes.ts         # Nested URL routes
│   │   ├── chatbot.validator.ts      # Joi schemas
│   │   └── engine/                   # 24 decision engine files (see below)
│   ├── vendor-chat/                  # Public vendor MESO portal (no auth)
│   ├── bidAnalysis/                  # Bid evaluation & scoring
│   ├── bidComparison/                # Multi-vendor comparison, PDF, deadline scheduler
│   ├── requisition/                  # Purchase requisitions (RFQ)
│   ├── contract/                     # Contract lifecycle
│   ├── vendor/                       # Vendor management & profiling
│   ├── po/                           # Purchase orders
│   ├── product/                      # Product catalog
│   ├── project/                      # Project management
│   ├── user/                         # User CRUD
│   ├── role/, permission/            # RBAC
│   ├── company/, customer/           # Organization management
│   ├── dashboard/                    # Analytics & reporting
│   ├── negotiation/                  # Negotiation tracking & history
│   ├── chat/                         # Legacy chat sessions
│   ├── vector/                       # RAG & semantic search
│   └── document/                     # Document processing (OCR via tesseract.js)
│
├── services/                         # Shared cross-module services
│   ├── openai.service.ts             # OpenAI client + Ollama auto-fallback + token counting
│   ├── llm.service.ts                # Ollama HTTP client with retry logic
│   ├── email.service.ts              # AWS SES SMTP + templates + logging
│   ├── context.service.ts            # Builds negotiation context for LLM prompts
│   └── currency.service.ts           # Multi-currency conversion with caching
│
├── negotiation/                      # Feb 2026 intent pipeline
│   └── intent/
│       └── buildNegotiationIntent.ts # Hard boundary: Decision → NegotiationIntent
│
├── llm/                              # LLM boundary layer
│   ├── personaRenderer.ts            # ONLY LLM entry point (static prompt, temp 0.5)
│   ├── validateLlmOutput.ts          # Rejects banned words, wrong prices, >160 words
│   └── fallbackTemplates.ts          # 30+ humanized templates (5 actions × 6 tones)
│
├── delivery/
│   └── simulateTypingDelay.ts        # Server-side delay: COUNTER 6-12s, MESO 8-15s, etc.
│
├── metrics/
│   └── logNegotiationStep.ts         # Audit logger: action/firmness/round/tone/dealId only
│
├── types/                            # Shared TypeScript types
├── utils/                            # Helpers (date, string, crypto, etc.)
└── seeders/                          # Development seed data

migrations/                           # 43 Sequelize migrations (CommonJS .cjs)
sequelize.config.cjs                  # Sequelize CLI config (supports DATABASE_URL)
```

---

## Module Pattern

Every feature module follows the same structure:

```
modules/<feature>/
├── <feature>.controller.ts    # Express request handlers (thin — delegates to service)
├── <feature>.service.ts       # Business logic
├── <feature>.repo.ts          # Database queries (when complex)
├── <feature>.routes.ts        # Express router + middleware binding
├── <feature>.validator.ts     # Joi/Zod request schemas
└── index.ts                   # Barrel exports
```

### Adding a New Module

1. Create the directory under `src/modules/<feature>/`
2. Add controller, service, routes, validator files
3. Register the router in `src/routes/index.ts`
4. Add Sequelize model(s) in `src/models/` and register in `src/models/index.ts`
5. Create a migration in `migrations/` (CommonJS `.cjs`)
6. Add types in `src/types/` if shared across modules

---

## API Routes

All routes are prefixed with `/api`.

### Public (no auth)

| Method | Path                                   | Description                              |
| ------ | -------------------------------------- | ---------------------------------------- |
| `GET`  | `/api/health`                          | Service health check                     |
| `POST` | `/api/vendor-chat/quote`               | Vendor submits initial quote             |
| `GET`  | `/api/vendor-chat/deal`                | Vendor gets deal data (targets stripped) |
| `POST` | `/api/vendor-chat/enter`               | Vendor enters chat                       |
| `POST` | `/api/vendor-chat/message`             | Vendor sends message                     |
| `POST` | `/api/vendor-chat/pm-response`         | Get AI PM response                       |
| `POST` | `/api/vendor-chat/meso/select`         | Select MESO option                       |
| `POST` | `/api/vendor-chat/meso/others`         | Submit custom counter-offer              |
| `POST` | `/api/vendor-chat/final-offer/confirm` | Confirm final offer                      |

### Authenticated (JWT Bearer or API Key/Secret)

| Prefix                | Module        | Key Endpoints                                            |
| --------------------- | ------------- | -------------------------------------------------------- |
| `/api/auth`           | auth          | `POST /login`, `POST /refresh-token`, `POST /otp`        |
| `/api/chatbot`        | chatbot       | Nested deal CRUD, messaging, utility scoring (see below) |
| `/api/bid-analysis`   | bidAnalysis   | Bid evaluation, winner selection                         |
| `/api/bid-comparison` | bidComparison | Multi-vendor comparison, PDF reports                     |
| `/api/requisition`    | requisition   | RFQ CRUD                                                 |
| `/api/contract`       | contract      | Contract lifecycle                                       |
| `/api/vendor`         | vendor        | Vendor CRUD & profiling                                  |
| `/api/po`             | po            | Purchase order management                                |
| `/api/product`        | product       | Product catalog                                          |
| `/api/project`        | project       | Project CRUD                                             |
| `/api/user`           | user          | User management                                          |
| `/api/role`           | role          | Role management                                          |
| `/api/permission`     | permission    | Permission management                                    |
| `/api/company`        | company       | Company management                                       |
| `/api/dashboard`      | dashboard     | Analytics                                                |
| `/api/negotiation`    | negotiation   | Negotiation history                                      |
| `/api/vector`         | vector        | RAG / semantic search                                    |
| `/api/document`       | document      | Document processing (OCR)                                |

### Chatbot Nested Routes

```
/api/chatbot/requisitions                                          # List requisitions with deals
/api/chatbot/requisitions/:rfqId/deals                             # Deals for requisition
/api/chatbot/requisitions/:rfqId/vendors                           # Vendors for requisition
/api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals           # Deals for RFQ+vendor
/api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId   # Deal CRUD
  /config                                                          # Negotiation config
  /utility                                                         # Weighted utility breakdown
  /summary                                                         # Deal summary
  /messages                                                        # Send message
  /reset                                                           # Reset deal
  /archive, /unarchive                                             # Archive lifecycle
  /simulate                                                        # Vendor simulation
/api/chatbot/requisitions/:rfqId/vendors/:vendorId/smart-defaults  # AI-suggested defaults
/api/chatbot/requisitions/:rfqId/vendors/:vendorId/drafts          # Deal drafts
```

---

## Authentication

### JWT Flow

1. `POST /api/auth/login` → returns `{ accessToken, refreshToken }`
2. Client sends `Authorization: Bearer <token>` on protected routes
3. `auth.middleware.ts` decodes token → sets `req.context`
4. On 401, client calls `POST /api/auth/refresh-token` with `{ refreshToken }`

### Alternative: API Key/Secret

Send `x-api-key` and `x-api-secret` headers instead of Bearer token.

### Request Context

After auth middleware, every request has:

```typescript
req.context = {
  userId: number;
  userType: 'admin' | 'customer' | 'vendor';  // defaults to 'customer'
  companyId?: number;
  email?: string;
};
```

---

## Negotiation Engine

### Two Modes

| Mode             | Flow                                                     | Use Case               |
| ---------------- | -------------------------------------------------------- | ---------------------- |
| **INSIGHTS**     | `chatbot.service` → `decide.ts` → `responseGenerator.ts` | Deterministic analysis |
| **CONVERSATION** | `conversationService` → intent pipeline → LLM render     | Human-like negotiation |

### Decision Engine (`src/modules/chatbot/engine/`)

24 files handling the full negotiation lifecycle:

| File                      | Purpose                                                      |
| ------------------------- | ------------------------------------------------------------ |
| `decide.ts`               | Main decision logic — utility thresholds, counter generation |
| `weightedUtility.ts`      | Multi-parameter weighted utility scoring                     |
| `parameterUtility.ts`     | Individual parameter utility functions                       |
| `parseOffer.ts`           | Regex-based offer extraction from vendor messages            |
| `offerAccumulator.ts`     | Merges multi-message partial offers                          |
| `toneDetector.ts`         | Vendor tone analysis (formal/casual/urgent/firm/friendly)    |
| `behavioralAnalyzer.ts`   | Concession velocity, convergence, momentum                   |
| `stallDetector.ts`        | Detects negotiation stalls                                   |
| `concernExtractor.ts`     | Extracts vendor concerns                                     |
| `meso.ts`                 | MESO option generation & phase control                       |
| `crossDealLearning.ts`    | Learns from other deals with same vendor                     |
| `vendorProfileService.ts` | Vendor historical profiling                                  |
| `responseGenerator.ts`    | Hardcoded response templates (INSIGHTS mode)                 |
| `config.ts`               | Engine configuration constants                               |
| `types.ts`                | Type definitions                                             |

### Feb 2026 Intent Pipeline (CONVERSATION mode)

```
decideNextMove()                        # Engine produces Decision
    ↓
buildNegotiationIntent()                # Hard boundary: Decision → NegotiationIntent
    ↓                                   # LLM NEVER sees: utility, weights, thresholds, targets
renderNegotiationMessage()              # personaRenderer.ts — only LLM entry point
    ↓
validateLlmOutput()                     # Rejects banned words, wrong prices, >160 words
    ↓
simulateTypingDelay()                   # 6-15s server-side delay
    ↓
Response
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
  firmness: number; // 0-1
  commercialPosition: string; // Pre-written phrase
  allowedPrice?: number; // Only for COUNTER, bounded [target, max]
  allowedPaymentTerms?: string;
  allowedDelivery?: string;
  weakestPrimaryParameter?: string;
  offerVariants?: MesoOfferVariant[];
  acknowledgeConcerns: string[];
  vendorTone: string;
}
```

### LLM Safety Rules

- **personaRenderer.ts**: Static system prompt, temperature 0.5, max 200 tokens
- **validateLlmOutput.ts**: 19 banned keyword patterns, price fuzzy matching (0.5% tolerance), 160-word limit
- **fallbackTemplates.ts**: 30+ templates (5 actions × 6 tones) — used when LLM fails or validation rejects
- **Fallback chain**: OpenAI → Ollama → templates. Vendor never sees failures.

---

## Database

### 42 Models

Organized by domain:

- **Core:** User, Role, RolePermission, Company, Address
- **Procurement:** Requisition, RequisitionProduct, Contract, PO, Product, Project
- **Vendor:** VendorCompany, VendorSelection, VendorBid, VendorNotification, VendorNegotiationProfile
- **Negotiation:** ChatbotDeal, ChatbotMessage, ChatbotTemplate, ChatbotTemplateParameter, Negotiation, NegotiationRound, NegotiationPattern
- **Bid Analysis:** BidComparison, BidActionHistory
- **Vector/RAG:** DealEmbedding, MessageEmbedding, VectorMigrationStatus
- **Admin:** Module, Approval, EmailLog, UserAction, OTP, AuthToken, ApiUsageLog

### Migrations

43 migrations in `migrations/` (CommonJS `.cjs` format). Run automatically on startup.

```bash
npm run migrate              # Apply pending
npm run migrate:undo         # Revert last
npm run migrate:undo:all     # Revert all
```

### Creating a New Migration

```bash
npx sequelize-cli migration:generate --name add-some-column
```

This creates a `.cjs` file in `migrations/`. Write `up` and `down` methods.

### Model Sync

On startup: `sequelize.sync({ alter: false })` — only creates missing tables, never drops or alters existing ones.

---

## Middleware Stack

Applied in order by `src/loaders/express.ts`:

1. **JSON body parser** (10 MB limit)
2. **URL-encoded parser**
3. **Helmet** — security headers (CSP, X-Frame-Options, etc.)
4. **Rate limiter** — 100 requests per 15-minute window
5. **toobusy-js** — 503 under CPU pressure
6. **CORS** — configurable origins
7. **Request logging** — method, path, status, response time
8. **Clean middleware** — strips null/"null"/"" from body
9. **Routes** — mounted at `/api`
10. **404 handler** — unknown routes
11. **Error handler** — global catch-all with structured logging

---

## LLM Providers

### OpenAI (primary)

- Model: `gpt-3.5-turbo` (configurable via `OPENAI_MODEL`)
- Token counting via tiktoken (prevents context overflow)
- Usage tracked in `ApiUsageLog` table
- Auto-falls back to Ollama on failure

### Ollama (fallback)

- Default model: `qwen3` (configurable via `LLM_MODEL`)
- HTTP API at `LLM_BASE_URL` (default `localhost:11434`)
- Exponential backoff retry (3 attempts)
- Health check: `GET /api/tags`

### Template Fallback (last resort)

When both OpenAI and Ollama fail, `fallbackTemplates.ts` provides humanized responses. The vendor never sees a failure — they always get a coherent response.

---

## Email

- **Provider:** AWS SES via SMTP (nodemailer)
- **Templates:** Vendor assignment, bid comparison, status updates, contract notifications
- **Logging:** All emails logged to `EmailLog` table
- **Attachments:** Supports PDF attachments (e.g., bid comparison reports)
- **Config:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_EMAIL`

---

## Background Jobs

### Bid Comparison Deadline Scheduler

- **Library:** node-cron
- **Started:** at app boot in `src/index.ts`
- **Purpose:** monitors bid comparison round deadlines, triggers actions when deadlines pass
- **Shutdown:** gracefully stopped on SIGTERM/SIGINT

---

## Testing

### Unit Tests (no DB)

```bash
npm run test:unit                # Run all (441 tests)
npm run test:unit:watch          # Watch mode
npm run test:unit:coverage       # Coverage report
```

Config: `vitest.unit.config.ts`. Timeout: 15s. Tests the negotiation engine, LLM boundary, delivery, and metrics modules.

### Integration Tests (requires DB)

```bash
npm test                         # Run all
npm run test:watch               # Watch mode
npm run test:coverage            # Coverage report
npx vitest run tests/integration/chatbot/chatbot.test.ts  # Single file
```

Config: `vitest.config.ts`. Timeout: 30s. Requires a test database (name must contain "test").

### Test Helpers

- `tests/helpers/setup.ts` — DB sync and teardown
- `tests/helpers/factories.ts` — Test data builders

---

## TypeScript Conventions

- **Module system:** ESM (NodeNext)
- **Import extensions:** Always use `.js` (TypeScript ESM convention)
  ```typescript
  import { User } from "../models/user.js"; // NOT .ts
  ```
- **Imports:** Use relative paths only (e.g. `../models/user.js`). Path aliases are not configured.
- **Strict mode:** Fully enabled with `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`

---

## Key Patterns

### Price Model

All negotiation prices are **total contract values**, not per-unit:

```typescript
// Config builder multiplies unit × quantity
const config = {
  target: targetUnitPrice * minOrderQuantity,
  max_acceptable: maxAcceptablePrice * minOrderQuantity,
};
```

### Hard Boundary Design

The `NegotiationIntent` is the **only** interface between the decision engine and LLM. The LLM never sees utility scores, weights, thresholds, target prices, or config. This prevents prompt injection and information leakage.

### Non-Destructive Migrations

`sequelize.sync({ alter: false })` — only creates missing tables. Combined with migration files for schema evolution. Safe for production.

### Graceful Shutdown

SIGTERM/SIGINT → stop cron scheduler → flush logs (1s grace) → exit. Prevents data loss and orphaned connections.

---

## Logging

### Winston Configuration

| Transport     | Location         | Retention |
| ------------- | ---------------- | --------- |
| Console       | stdout           | —         |
| Combined file | `logs/combined/` | 14 days   |
| Error file    | `logs/error/`    | 30 days   |

### Negotiation Audit Log

Via `logNegotiationStep()` — logs action, firmness, round, counterPrice, vendorTone, dealId, fromLlm. **Never logs**: LLM prompts, utility scores, vendor messages, or PII.

---

## Common Gotchas

- **Import extensions:** Must use `.js` in all imports (TypeScript ESM). The compiler won't catch missing extensions at build time but it will fail at runtime.
- **Migration format:** Migrations are CommonJS (`.cjs`), not ESM. Use `module.exports` and `require`.
- **Token prefix:** The access token stored client-side includes `"Bearer "` — the auth middleware handles stripping it.
- **Login endpoint:** `POST /api/auth/login` (not `/signin`).
- **DB auto-creation:** The app tries to create the database on startup. On managed providers (detected via `DATABASE_URL`), this step is skipped.
- **Seeding in prod:** Seeds only run when `NODE_ENV=development` or `FORCE_SEED=true`. Don't leave `FORCE_SEED` on.
- **Sequelize CLI:** Uses `sequelize.config.cjs` (CommonJS) — separate from the app's ESM config.
