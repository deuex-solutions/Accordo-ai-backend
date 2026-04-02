#!/usr/bin/env bash
#
# db-reset.sh — Drop and recreate the Accordo database, run migrations + seed
#
# Usage:
#   npm run db:reset          # uses defaults from .env
#   DB_NAME=accordo_dev npm run db:reset   # override database name
#
# Requirements:
#   - PostgreSQL must be running
#   - .env file must exist with DB_* variables (or defaults are used)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load .env if present
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  source "$PROJECT_ROOT/.env"
  set +a
fi

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-accordo}"
DB_USERNAME="${DB_USERNAME:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"

export PGPASSWORD="$DB_PASSWORD"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║         Accordo Database Reset                   ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  Host:     $DB_HOST:$DB_PORT"
echo "║  Database: $DB_NAME"
echo "║  User:     $DB_USERNAME"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# Confirm
read -p "⚠️  This will DROP and recreate '$DB_NAME'. Continue? (y/N) " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

echo ""
echo "1/4  Dropping database '$DB_NAME'..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d postgres \
  -c "DROP DATABASE IF EXISTS \"$DB_NAME\";" 2>/dev/null || true

echo "2/4  Creating database '$DB_NAME'..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USERNAME" -d postgres \
  -c "CREATE DATABASE \"$DB_NAME\";"

echo "3/4  Running migrations..."
cd "$PROJECT_ROOT"
npx sequelize-cli db:migrate \
  --config "$PROJECT_ROOT/sequelize.config.cjs" \
  --migrations-path "$PROJECT_ROOT/migrations"

echo "4/4  Running seed data..."
npx tsx "$PROJECT_ROOT/scripts/seed.ts"

echo ""
echo "✅  Database '$DB_NAME' reset successfully!"
echo "    - 8 consolidated migrations applied"
echo "    - Seed data loaded"
echo ""
