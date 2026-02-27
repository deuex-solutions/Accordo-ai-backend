import { expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

// CRITICAL: Set env vars BEFORE importing any modules that read them.
// The database module reads DB_NAME at import time, so it must be set first.
process.env.NODE_ENV = 'test';
process.env.DB_NAME = process.env.DB_NAME_TEST || 'accordo_test';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-secret-key';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-key';

// Import AFTER env vars are configured
import sequelize from '../../src/config/database.js';

// Safety: abort if connected to the dev database
const dbName = (sequelize as any).config?.database || process.env.DB_NAME;
if (dbName && !dbName.includes('test')) {
  throw new Error(`REFUSING TO RUN TESTS: connected to "${dbName}" which is not a test database. Tests would destroy all data. Set DB_NAME_TEST or ensure DB_NAME contains "test".`);
}

/**
 * Before all tests, sync database
 */
beforeAll(async () => {
  try {
    // Authenticate connection
    await sequelize.authenticate();
    console.log('✓ Database connection established for testing');

    // Clean slate: drop and recreate public schema, then sync models
    await sequelize.query('DROP SCHEMA public CASCADE;');
    await sequelize.query('CREATE SCHEMA public;');
    await sequelize.sync({ force: true });
    console.log('✓ Database schema synced for testing');
  } catch (error) {
    console.error('Failed to setup test database:', error);
    throw error;
  }
});

/**
 * After each test, clean up data
 */
afterEach(async () => {
  // Truncate all tables to ensure clean state for next test
  try {
    const models = Object.values(sequelize.models);
    for (const model of models) {
      await model.destroy({ where: {}, truncate: true, cascade: true });
    }
  } catch (error) {
    console.error('Failed to clean up test data:', error);
  }
});

/**
 * After all tests, close database connection
 */
afterAll(async () => {
  try {
    await sequelize.close();
    console.log('✓ Database connection closed');
  } catch (error) {
    console.error('Failed to close database connection:', error);
  }
});

// Export expect for convenience
export { expect };
