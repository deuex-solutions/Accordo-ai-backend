#!/usr/bin/env node
/**
 * mark-migrations-run.cjs
 *
 * One-time script for production databases that used the old 46-migration setup.
 * Replaces the old migration entries in SequelizeMeta with the 8 consolidated
 * migration filenames, so Sequelize CLI treats them as "already applied".
 *
 * Usage:
 *   # Dry run (shows what would change, no modifications)
 *   node scripts/mark-migrations-run.cjs --dry-run
 *
 *   # Apply changes
 *   node scripts/mark-migrations-run.cjs
 *
 *   # With DATABASE_URL (Render, Heroku, etc.)
 *   DATABASE_URL=postgres://... node scripts/mark-migrations-run.cjs
 *
 * Safe to run multiple times — idempotent.
 */

const { Client } = require('pg');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const isDryRun = process.argv.includes('--dry-run');

// The 8 consolidated migration filenames
const CONSOLIDATED_MIGRATIONS = [
  '20260217000001-foundation.cjs',
  '20260217000002-projects-products.cjs',
  '20260217000003-requisitions.cjs',
  '20260217000004-vendors-contracts.cjs',
  '20260217000005-chatbot-core.cjs',
  '20260217000006-bid-analysis.cjs',
  '20260217000007-vectors-ml.cjs',
  '20260217000008-indexes-and-constraints.cjs',
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL;

  const clientConfig = databaseUrl
    ? { connectionString: databaseUrl, ssl: { rejectUnauthorized: false } }
    : {
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 5432),
        database: process.env.DB_NAME || 'accordo',
        user: process.env.DB_USERNAME || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
      };

  const client = new Client(clientConfig);

  try {
    await client.connect();
    console.log('Connected to database.\n');

    // Check current state of SequelizeMeta
    const current = await client.query('SELECT name FROM "SequelizeMeta" ORDER BY name');
    const currentNames = current.rows.map(r => r.name);

    console.log(`Current SequelizeMeta entries: ${currentNames.length}`);
    if (currentNames.length > 0) {
      currentNames.forEach(n => console.log(`  - ${n}`));
    }
    console.log('');

    // Check which consolidated migrations are already present
    const alreadyPresent = CONSOLIDATED_MIGRATIONS.filter(m => currentNames.includes(m));
    const toInsert = CONSOLIDATED_MIGRATIONS.filter(m => !currentNames.includes(m));

    // Identify old migrations to remove (anything not in consolidated list)
    const toRemove = currentNames.filter(n => !CONSOLIDATED_MIGRATIONS.includes(n));

    if (alreadyPresent.length === CONSOLIDATED_MIGRATIONS.length && toRemove.length === 0) {
      console.log('✅ SequelizeMeta is already up to date. Nothing to do.');
      return;
    }

    console.log('Plan:');
    if (toRemove.length > 0) {
      console.log(`  Remove ${toRemove.length} old migration entries:`);
      toRemove.forEach(n => console.log(`    - ${n}`));
    }
    if (toInsert.length > 0) {
      console.log(`  Insert ${toInsert.length} consolidated migration entries:`);
      toInsert.forEach(n => console.log(`    + ${n}`));
    }
    console.log('');

    if (isDryRun) {
      console.log('🔍 DRY RUN — no changes made. Remove --dry-run to apply.');
      return;
    }

    // Execute in a transaction
    await client.query('BEGIN');

    // Remove old entries
    if (toRemove.length > 0) {
      const placeholders = toRemove.map((_, i) => `$${i + 1}`).join(', ');
      await client.query(
        `DELETE FROM "SequelizeMeta" WHERE name IN (${placeholders})`,
        toRemove
      );
      console.log(`Removed ${toRemove.length} old entries.`);
    }

    // Insert new entries
    for (const name of toInsert) {
      await client.query(
        'INSERT INTO "SequelizeMeta" (name) VALUES ($1) ON CONFLICT DO NOTHING',
        [name]
      );
    }
    if (toInsert.length > 0) {
      console.log(`Inserted ${toInsert.length} consolidated entries.`);
    }

    await client.query('COMMIT');

    // Verify
    const after = await client.query('SELECT name FROM "SequelizeMeta" ORDER BY name');
    console.log(`\n✅ Done. SequelizeMeta now has ${after.rows.length} entries:`);
    after.rows.forEach(r => console.log(`  - ${r.name}`));

  } catch (error) {
    console.error('❌ Error:', error.message);
    try { await client.query('ROLLBACK'); } catch {}
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
