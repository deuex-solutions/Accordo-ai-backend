# Accordo-AI Backend — Deployment Guide

## Prerequisites

- Node.js 20+ (Alpine in Docker)
- npm 10+
- PostgreSQL 15+ (or a managed provider: Render, Neon, Supabase)
- Ollama (optional — LLM fallback; OpenAI works without it)
- Docker & Docker Compose (for containerised deployment)
- A reachable `Accordo-auth` service on port 5003 (issues and validates JWTs). Both services must share `JWT_ACCESS_TOKEN_SECRET` and the same Postgres database.

---

## Environment Variables

Copy `.env.example` → `.env` and configure the sections below. Only critical variables are listed — see `.env.example` for the full set.

### Required

| Variable                   | Default       | Description                                                       |
| -------------------------- | ------------- | ----------------------------------------------------------------- |
| `PORT`                     | `5002`        | Server listen port                                                |
| `NODE_ENV`                 | `development` | `development` / `production` — `production` disables auto-migrate |
| `JWT_SECRET`               | —             | **Must change.** Fallback for the two specific secrets below      |
| `JWT_ACCESS_TOKEN_SECRET`  | —             | Access token signing key. **Must match `Accordo-auth`'s value.**  |
| `JWT_REFRESH_TOKEN_SECRET` | —             | Refresh token signing key. **Must match `Accordo-auth`'s value.** |
| `AUTH_SERVICE_SECRET`      | —             | Optional; enables apiKey/apiSecret service-to-service auth        |

### Database (pick one)

**Option A — Individual vars (local PostgreSQL):**

| Variable      | Default     |
| ------------- | ----------- |
| `DB_HOST`     | `127.0.0.1` |
| `DB_PORT`     | `5432`      |
| `DB_NAME`     | `accordo`   |
| `DB_USERNAME` | `postgres`  |
| `DB_PASSWORD` | `postgres`  |

**Option B — Connection string (managed providers):**

| Variable       | Description                                                        |
| -------------- | ------------------------------------------------------------------ |
| `DATABASE_URL` | Full connection string. SSL auto-detected for Render/Neon/Supabase |

Additional flags: `DB_SSL`, `DB_SSL_REJECT_UNAUTHORIZED`, `DB_LOGGING`.

### LLM

| Variable                | Default                  | Description                                                          |
| ----------------------- | ------------------------ | -------------------------------------------------------------------- |
| `OPENAI_API_KEY`        | —                        | Optional; primary provider when set, auto-falls back to Ollama       |
| `OPENAI_MODEL`          | `gpt-4o-mini`            | OpenAI model for response generation                                 |
| `LLM_BASE_URL`          | `http://localhost:11434` | Ollama URL (in Docker: `http://host.docker.internal:11434`)          |
| `LLM_MODEL`             | `qwen3`                  | Ollama model                                                         |
| `LLM_NEGOTIATION_MODEL` | —                        | Optional override; only used for negotiations                        |
| `EMBEDDING_PROVIDER`    | `local`                  | `local` (ONNX) / `openai` / `bedrock` — choice of embedding provider |

### Email (AWS SES SMTP)

| Variable          | Description                                               |
| ----------------- | --------------------------------------------------------- |
| `SMTP_HOST`       | SES endpoint (e.g. `email-smtp.ap-south-1.amazonaws.com`) |
| `SMTP_PORT`       | `465`                                                     |
| `SMTP_USER`       | SES SMTP username                                         |
| `SMTP_PASS`       | SES SMTP password                                         |
| `SMTP_FROM_EMAIL` | Verified sender address                                   |

### Frontend URLs

| Variable               | Default                        | Description                              |
| ---------------------- | ------------------------------ | ---------------------------------------- |
| `VENDOR_PORTAL_URL`    | `http://localhost:5001/vendor` | Vendor portal base URL (for email links) |
| `CHATBOT_FRONTEND_URL` | `http://localhost:5001`        | Frontend base URL                        |
| `CHATBOT_API_URL`      | `http://localhost:5002/api`    | Backend API URL (used in emails)         |

---

## Option 1 — Local Deployment

```bash
# 1. Install dependencies
npm install

# 2. Create env file
cp .env.example .env
# Edit .env — set DB credentials, JWT secrets, etc.

# 3. Ensure PostgreSQL is running
# The app auto-creates the database if it doesn't exist

# 4. Build TypeScript
npm run build

# 5. Start the server (runs migrations + seeds automatically)
npm start
```

The server listens on `0.0.0.0:5002` by default.

### What happens on startup

1. Connects to PostgreSQL (creates the database if missing).
2. **In dev**: runs all pending Sequelize migrations (8 consolidated `.cjs` files in `migrations/`). **In production (`NODE_ENV=production`)**: auto-migrate is **disabled** — run `npm run migrate` manually before each deploy.
3. Syncs models (`alter: false` — non-destructive, only creates missing tables).
4. Seeds development data (only when `NODE_ENV=development` or `FORCE_SEED=true`).
5. Starts the bid-comparison deadline scheduler (cron).
6. Registers graceful shutdown handlers (SIGTERM/SIGINT) that close the HTTP server, stop the cron, and disconnect the Sequelize pool.

---

## Option 2 — Docker (Recommended for Production)

### Production

```bash
docker compose --profile prod up -d --build
```

This runs a multi-stage build:

1. **deps** — installs `node_modules` with native build tools
2. **builder** — compiles TypeScript → `dist/`
3. **runtime** — lean Node 20 Alpine image, runs `npm start`

Includes PostgreSQL 17 as a shared service.

**Resource limits:** 1 GB max memory, 512 MB reserved. Adjust in `docker-compose.yml`.

### Development (with hot-reload)

```bash
docker compose --profile dev up -d --build
```

Source files are volume-mounted — changes trigger automatic restart via `tsx watch`.

### Viewing Logs

```bash
docker compose --profile prod logs -f backend-prod
docker compose --profile dev logs -f backend
```

### Health Check

```
GET http://localhost:5002/api/health
```

Returns comprehensive service status. Docker uses this for container health monitoring.

---

## Option 3 — Managed Platforms (Render, Railway, Fly.io)

1. Set `DATABASE_URL` to your managed PostgreSQL connection string
2. Set all other env vars (JWT secrets, SMTP, OpenAI key)
3. Build command: `npm run build`
4. Start command: `npm start`
5. Health check path: `/api/health`

The app auto-detects managed database providers and configures SSL accordingly.

---

## Database Management

### Migrations

Migrations run automatically on every startup. For manual control:

```bash
npm run migrate              # Apply pending migrations
npm run migrate:undo         # Revert last migration
npm run migrate:undo:all     # Revert all migrations
```

Migrations are CommonJS (`.cjs`) files in `migrations/`. They use `alter: false` — non-destructive by design.

### Seeding

- **Development:** auto-seeds on startup
- **Production:** set `FORCE_SEED=true` to seed once, then remove
- Admin account seeded: `admin@accordo.ai` / `password123`

---

## Ollama Setup (Optional)

Ollama provides the LLM fallback chain: OpenAI → Ollama → hardcoded templates.

```bash
# Install Ollama (macOS)
brew install ollama

# Pull the default model
ollama pull qwen3

# Start Ollama (default port 11434)
ollama serve
```

**Docker note:** The compose file uses `host.docker.internal:11434` to reach Ollama running on the host machine.

If you only use OpenAI and don't need a local fallback, Ollama is not required — the system falls back to humanized template responses.

---

## API Documentation

Swagger UI is available at:

```
http://localhost:5002/api-docs
```

Raw OpenAPI spec:

```
http://localhost:5002/api-docs.json
```

---

## CI/CD checklist

1. `npm ci` — clean install
2. `npm run lint` — ESLint
3. `npm run type-check` — TypeScript without emit
4. `npm run test:unit` — 1100+ unit tests (no DB required)
5. `npm test` — integration tests (requires test DB; setup file enforces a test-only DB name)
6. `npm run build` — TypeScript compilation
7. **Run `npm run migrate` against the production DB** — auto-migrate is disabled in production, so this step is required before traffic shifts to the new build.
8. Deploy compiled `dist/` or build the Docker `prod` target.

---

## Logging

Logs are written to `logs/` with daily rotation:

| Directory        | Retention | Content        |
| ---------------- | --------- | -------------- |
| `logs/combined/` | 14 days   | All log levels |
| `logs/error/`    | 30 days   | Errors only    |

Format: JSON structured logs with timestamps. Console output is colorized in development.

---

## Troubleshooting

| Problem                                 | Fix                                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `ECONNREFUSED` on DB                    | PostgreSQL not running or wrong creds.                                                              |
| Migrations fail                         | `DB_NAME` doesn't exist; the app creates it automatically but needs `DB_ADMIN_DATABASE` access.     |
| Migrations missing in production        | Auto-migrate is disabled when `NODE_ENV=production`. Run `npm run migrate` manually.                |
| `JsonWebTokenError: invalid signature`  | `JWT_ACCESS_TOKEN_SECRET` differs from `Accordo-auth`'s value. Sync them.                           |
| OpenAI 401/429                          | Bad `OPENAI_API_KEY`; system auto-falls back to Ollama → templates.                                 |
| Ollama connection refused               | Start `ollama serve` or set `LLM_BASE_URL` (in Docker: `http://host.docker.internal:11434`).        |
| Email not sending                       | SES SMTP creds wrong or sender not verified in AWS SES.                                             |
| Contract create: `id must be unique`    | Sequelize sequence drift: `SELECT setval('"Contracts_id_seq"', (SELECT MAX(id) FROM "Contracts"));` |
| 503 responses                           | `toobusy-js` shedding under CPU pressure. Scale up or reduce load.                                  |
| `FORCE_SEED` not running                | Only fires when `NODE_ENV=development` or `FORCE_SEED=true`.                                        |
| Port 5002 in use                        | Change `PORT` in `.env` (and the Docker port mapping).                                              |
| Vendor sees raw "1 days" / "$355000.00" | Frontend not consuming `formattedLabels` payload — pull the latest frontend.                        |
