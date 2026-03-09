/**
 * Tests for ensureDatabaseExists skip logic in src/config/database.ts
 *
 * The function has three paths:
 *   1. DATABASE_URL is set → skip immediately (managed provider)
 *   2. adminDatabase === database name → skip (nothing to create)
 *   3. Neither condition → attempt to connect via pg.Client and create DB
 *
 * Since database.ts has top-level side effects (await ensureDatabaseExists(),
 * Sequelize instantiation), we use vi.resetModules() + dynamic imports to
 * get a fresh module for each test. We mock `pg`, `sequelize`, and the
 * env/logger modules so no real database connections are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Save and restore env vars between tests. */
const envSnapshot: Record<string, string | undefined> = {};
const TRACKED_VARS = ['DATABASE_URL', 'DB_NAME', 'DB_ADMIN_DATABASE', 'FORCE_SEED', 'NODE_ENV'];

beforeEach(() => {
  for (const key of TRACKED_VARS) {
    envSnapshot[key] = process.env[key];
  }
  // Ensure FORCE_SEED is off so connectDatabase seeder path is not hit
  process.env.NODE_ENV = 'production';
  delete process.env.FORCE_SEED;
});

afterEach(() => {
  for (const key of TRACKED_VARS) {
    if (envSnapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = envSnapshot[key];
    }
  }
  vi.restoreAllMocks();
  vi.resetModules();
});

// ─────────────────────────────────────────────
// Mock pg.Client to track calls
// ─────────────────────────────────────────────

function createMockClient(queryResult = { rowCount: 1 }) {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue(queryResult),
    end: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Dynamically imports database.ts with mocked dependencies.
 * Returns the ensureDatabaseExists function and the mock client instance.
 */
async function loadWithMocks(
  envOverrides: Record<string, any> = {},
  queryResult = { rowCount: 1 },
) {
  const mockClient = createMockClient(queryResult);

  // pg.Client must be a real constructor function (not arrow fn)
  function MockClientClass() {
    return mockClient;
  }
  const clientSpy = vi.fn(MockClientClass);

  // Mock pg — database.ts does `import pg from 'pg'` then uses `pg.Client`
  vi.doMock('pg', () => ({
    default: { Client: clientSpy },
    Client: clientSpy,
  }));

  // Mock Sequelize — must be a constructor (function, not arrow)
  const mockSequelizeInstance = {
    authenticate: vi.fn().mockResolvedValue(undefined),
    sync: vi.fn().mockResolvedValue(undefined),
    define: vi.fn(),
  };
  function MockSequelize() {
    return mockSequelizeInstance;
  }

  vi.doMock('sequelize', () => ({
    Sequelize: MockSequelize,
    DataTypes: {},
  }));

  // Mock logger
  vi.doMock('../../../src/config/logger.js', () => ({
    default: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  }));

  // Mock env with overrides
  const defaultEnv = {
    database: {
      host: '127.0.0.1',
      port: 5432,
      name: 'accordo',
      username: 'postgres',
      password: 'postgres',
      adminDatabase: 'postgres',
      ssl: false,
      sslRejectUnauthorized: true,
      logging: false,
      ...envOverrides,
    },
    nodeEnv: 'production',
  };

  vi.doMock('../../../src/config/env.js', () => ({
    default: defaultEnv,
    env: defaultEnv,
  }));

  // Mock child_process to avoid real execSync
  vi.doMock('child_process', () => ({
    execSync: vi.fn(),
  }));

  const mod = await import('../../../src/config/database.js');
  return { ensureDatabaseExists: mod.ensureDatabaseExists, mockClient, clientSpy };
}

// ─────────────────────────────────────────────
// Skip logic: DATABASE_URL present
// ─────────────────────────────────────────────

describe('ensureDatabaseExists – DATABASE_URL skip', () => {
  it('returns early without connecting when DATABASE_URL is set', async () => {
    process.env.DATABASE_URL = 'postgres://user:pass@host:5432/managed_db';
    const { ensureDatabaseExists, clientSpy } = await loadWithMocks();
    await ensureDatabaseExists();
    expect(clientSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────
// Skip logic: adminDatabase === database name
// ─────────────────────────────────────────────

describe('ensureDatabaseExists – adminDatabase === target skip', () => {
  it('returns early when adminDatabase equals database name', async () => {
    delete process.env.DATABASE_URL;
    const { ensureDatabaseExists, clientSpy } = await loadWithMocks({
      name: 'mydb',
      adminDatabase: 'mydb',
    });
    await ensureDatabaseExists();
    expect(clientSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────
// Normal path: creates database when it does not exist
// ─────────────────────────────────────────────

describe('ensureDatabaseExists – normal path', () => {
  it('connects to admin database and checks for target DB', async () => {
    delete process.env.DATABASE_URL;
    const { ensureDatabaseExists, mockClient } = await loadWithMocks(
      { name: 'accordo', adminDatabase: 'postgres' },
      { rowCount: 1 },
    );
    // Note: ensureDatabaseExists also runs at top-level import (line 94 of database.ts),
    // so connect/query may already have been called once. We call it again explicitly.
    await ensureDatabaseExists();
    expect(mockClient.connect).toHaveBeenCalled();
    expect(mockClient.query).toHaveBeenCalledWith(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      ['accordo'],
    );
  });

  it('creates database when it does not exist (rowCount=0)', async () => {
    delete process.env.DATABASE_URL;
    const { ensureDatabaseExists, mockClient } = await loadWithMocks(
      { name: 'accordo_new', adminDatabase: 'postgres' },
      { rowCount: 0 },
    );
    await ensureDatabaseExists();
    expect(mockClient.query).toHaveBeenCalledWith('CREATE DATABASE "accordo_new"');
  });

  it('does NOT create database when it already exists (rowCount=1)', async () => {
    delete process.env.DATABASE_URL;
    const { ensureDatabaseExists, mockClient } = await loadWithMocks(
      { name: 'accordo', adminDatabase: 'postgres' },
      { rowCount: 1 },
    );
    await ensureDatabaseExists();
    const calls = mockClient.query.mock.calls;
    const createCalls = calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].startsWith('CREATE'),
    );
    expect(createCalls).toHaveLength(0);
  });

  it('always calls client.end() in finally block', async () => {
    delete process.env.DATABASE_URL;
    const { ensureDatabaseExists, mockClient } = await loadWithMocks(
      { name: 'accordo', adminDatabase: 'postgres' },
    );
    // Top-level import already called ensureDatabaseExists once, so end()
    // has been called once. Call it again and verify end() was called at least twice.
    await ensureDatabaseExists();
    expect(mockClient.end.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────
// Error handling: warns instead of throwing
// ─────────────────────────────────────────────

describe('ensureDatabaseExists – error handling', () => {
  it('does not throw when pg.Client.connect rejects', async () => {
    delete process.env.DATABASE_URL;
    const mockClient = createMockClient();
    mockClient.connect.mockRejectedValue(new Error('connection refused'));

    function MockClientClass() {
      return mockClient;
    }

    vi.doMock('pg', () => ({
      default: { Client: vi.fn(MockClientClass) },
      Client: vi.fn(MockClientClass),
    }));

    const mockSeq = {
      authenticate: vi.fn().mockResolvedValue(undefined),
      sync: vi.fn().mockResolvedValue(undefined),
      define: vi.fn(),
    };
    function MockSequelize() {
      return mockSeq;
    }

    vi.doMock('sequelize', () => ({
      Sequelize: MockSequelize,
      DataTypes: {},
    }));

    vi.doMock('../../../src/config/logger.js', () => ({
      default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    }));

    const envData = {
      database: {
        host: '127.0.0.1',
        port: 5432,
        name: 'accordo',
        username: 'postgres',
        password: 'postgres',
        adminDatabase: 'postgres',
        ssl: false,
        sslRejectUnauthorized: true,
        logging: false,
      },
      nodeEnv: 'production',
    };

    vi.doMock('../../../src/config/env.js', () => ({
      default: envData,
      env: envData,
    }));

    vi.doMock('child_process', () => ({
      execSync: vi.fn(),
    }));

    const mod = await import('../../../src/config/database.js');
    // Should not throw — just warns
    await expect(mod.ensureDatabaseExists()).resolves.toBeUndefined();
  });
});
