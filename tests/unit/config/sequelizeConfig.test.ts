/**
 * Tests for sequelize.config.cjs
 *
 * Validates that the Sequelize CLI configuration correctly handles:
 * - DATABASE_URL mode (Render, Heroku managed providers)
 * - Individual DB_* environment variable mode
 * - SSL dialect options in both modes
 * - Test environment DB name override
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Loads the sequelize config fresh by clearing the require cache.
 * The config is a CJS module so we use require() via createRequire.
 */
function loadConfig(): Record<string, any> {
  const { createRequire } = require('module');
  const req = createRequire(import.meta.url);
  const configPath = require('path').resolve(
    __dirname,
    '../../../sequelize.config.cjs',
  );
  // Clear cached version so process.env changes take effect
  delete req.cache[configPath];
  return req(configPath);
}

/** Save and restore env vars between tests. */
const envSnapshot: Record<string, string | undefined> = {};
const TRACKED_VARS = [
  'DATABASE_URL',
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_NAME_TEST',
  'DB_USERNAME',
  'DB_PASSWORD',
  'DB_SSL',
  'DB_SSL_REJECT_UNAUTHORIZED',
  'DB_LOGGING',
];

beforeEach(() => {
  for (const key of TRACKED_VARS) {
    envSnapshot[key] = process.env[key];
  }
});

afterEach(() => {
  for (const key of TRACKED_VARS) {
    if (envSnapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = envSnapshot[key];
    }
  }
});

// ─────────────────────────────────────────────
// DATABASE_URL mode
// ─────────────────────────────────────────────

describe('sequelize.config.cjs – DATABASE_URL mode', () => {
  it('uses url field when DATABASE_URL is set', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@host:5432/mydb';
    delete process.env.DB_HOST;
    const config = loadConfig();
    expect(config.development.url).toBe('postgres://user:pass@host:5432/mydb');
    expect(config.production.url).toBe('postgres://user:pass@host:5432/mydb');
    expect(config.test.url).toBe('postgres://user:pass@host:5432/mydb');
  });

  it('sets dialect to postgres when DATABASE_URL is present', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@host:5432/mydb';
    const config = loadConfig();
    expect(config.development.dialect).toBe('postgres');
  });

  it('includes SSL dialectOptions when DATABASE_URL is set', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@host:5432/mydb';
    const config = loadConfig();
    expect(config.development.dialectOptions).toBeDefined();
    expect(config.development.dialectOptions.ssl).toBeDefined();
    expect(config.development.dialectOptions.ssl.require).toBe(true);
  });

  it('all environments share the same config when DATABASE_URL is set', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@host:5432/mydb';
    const config = loadConfig();
    expect(config.development.url).toBe(config.test.url);
    expect(config.development.url).toBe(config.production.url);
  });

  it('does not include individual host/database fields when DATABASE_URL is set', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@host:5432/mydb';
    const config = loadConfig();
    expect(config.development.host).toBeUndefined();
    expect(config.development.database).toBeUndefined();
    expect(config.development.username).toBeUndefined();
    expect(config.development.password).toBeUndefined();
  });
});

// ─────────────────────────────────────────────
// Individual DB_* variables mode
// ─────────────────────────────────────────────

describe('sequelize.config.cjs – individual DB_* variables mode', () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('uses DB_HOST, DB_PORT, DB_NAME, DB_USERNAME, DB_PASSWORD', () => {
    process.env.DB_HOST = 'custom-host';
    process.env.DB_PORT = '5433';
    process.env.DB_NAME = 'custom_db';
    process.env.DB_USERNAME = 'custom_user';
    process.env.DB_PASSWORD = 'custom_pass';
    const config = loadConfig();
    expect(config.development.host).toBe('custom-host');
    expect(config.development.port).toBe(5433);
    expect(config.development.database).toBe('custom_db');
    expect(config.development.username).toBe('custom_user');
    expect(config.development.password).toBe('custom_pass');
  });

  it('falls back to hardcoded defaults when no DB_* vars are set', () => {
    delete process.env.DB_HOST;
    delete process.env.DB_PORT;
    delete process.env.DB_NAME;
    delete process.env.DB_USERNAME;
    delete process.env.DB_PASSWORD;
    const config = loadConfig();
    // dotenv may load .env at require-time, so defaults could come from
    // there. We just assert the shape and types are correct.
    expect(typeof config.development.host).toBe('string');
    expect(typeof config.development.port).toBe('number');
    expect(typeof config.development.database).toBe('string');
    expect(typeof config.development.username).toBe('string');
    expect(typeof config.development.password).toBe('string');
    expect(config.development.dialect).toBe('postgres');
  });

  it('does not include url field when DATABASE_URL is absent', () => {
    const config = loadConfig();
    expect(config.development.url).toBeUndefined();
  });
});

// ─────────────────────────────────────────────
// SSL handling with individual vars
// ─────────────────────────────────────────────

describe('sequelize.config.cjs – SSL with individual vars', () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('includes dialectOptions.ssl when DB_SSL=true', () => {
    process.env.DB_SSL = 'true';
    const config = loadConfig();
    expect(config.development.dialectOptions).toBeDefined();
    expect(config.development.dialectOptions.ssl.require).toBe(true);
  });

  it('omits dialectOptions when DB_SSL is not set', () => {
    delete process.env.DB_SSL;
    const config = loadConfig();
    expect(config.development.dialectOptions).toBeUndefined();
  });

  it('sslRejectUnauthorized defaults to true', () => {
    process.env.DB_SSL = 'true';
    delete process.env.DB_SSL_REJECT_UNAUTHORIZED;
    const config = loadConfig();
    expect(config.development.dialectOptions.ssl.rejectUnauthorized).toBe(true);
  });

  it('sets rejectUnauthorized to false when DB_SSL_REJECT_UNAUTHORIZED=false', () => {
    process.env.DB_SSL = 'true';
    process.env.DB_SSL_REJECT_UNAUTHORIZED = 'false';
    const config = loadConfig();
    expect(config.development.dialectOptions.ssl.rejectUnauthorized).toBe(false);
  });
});

// ─────────────────────────────────────────────
// Test environment override
// ─────────────────────────────────────────────

describe('sequelize.config.cjs – test environment', () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('test env uses DB_NAME_TEST when set', () => {
    process.env.DB_NAME = 'accordo';
    process.env.DB_NAME_TEST = 'accordo_ci_test';
    const config = loadConfig();
    expect(config.test.database).toBe('accordo_ci_test');
  });

  it('test env defaults to {DB_NAME}_test when DB_NAME_TEST is absent', () => {
    process.env.DB_NAME = 'accordo';
    delete process.env.DB_NAME_TEST;
    const config = loadConfig();
    expect(config.test.database).toBe('accordo_test');
  });

  it('development and production share the same database name', () => {
    process.env.DB_NAME = 'mydb';
    const config = loadConfig();
    expect(config.development.database).toBe('mydb');
    expect(config.production.database).toBe('mydb');
  });
});

// ─────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────

describe('sequelize.config.cjs – logging', () => {
  it('enables logging when DB_LOGGING=true', () => {
    delete process.env.DATABASE_URL;
    process.env.DB_LOGGING = 'true';
    const config = loadConfig();
    expect(config.development.logging).toBe(console.log);
  });

  it('disables logging when DB_LOGGING is not set', () => {
    delete process.env.DATABASE_URL;
    delete process.env.DB_LOGGING;
    const config = loadConfig();
    expect(config.development.logging).toBe(false);
  });
});
