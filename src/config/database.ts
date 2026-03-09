import path from 'path';
import { fileURLToPath } from 'url';
import { Sequelize, Options } from 'sequelize';
import { execSync } from 'child_process';
import pg from 'pg';
import env from './env.js';
import logger from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../');

interface ClientConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: {
    require: boolean;
    rejectUnauthorized: boolean;
  };
}

const buildClientConfig = (database: string): ClientConfig => ({
  host: env.database.host,
  port: env.database.port,
  user: env.database.username,
  password: env.database.password,
  database,
  ...(env.database.ssl
    ? {
        ssl: {
          require: true,
          rejectUnauthorized: env.database.sslRejectUnauthorized,
        },
      }
    : {}),
});

/**
 * Ensure database exists. On managed providers (Render, etc.) the database
 * is pre-provisioned and CREATE DATABASE is not allowed, so this step is
 * skipped entirely when DATABASE_URL is set or DB_ADMIN_DATABASE points to
 * the same database.
 */
export const ensureDatabaseExists = async (): Promise<void> => {
  // Skip on managed providers — the DB is already provisioned.
  // Connecting to a non-existent admin DB (e.g. "postgres") causes a FATAL
  // error on Render/Neon/Supabase where only the provisioned DB exists.
  if (process.env.DATABASE_URL) {
    logger.info('DATABASE_URL detected — skipping ensureDatabaseExists (managed provider).');
    return;
  }

  const adminDatabase = env.database.adminDatabase || 'postgres';

  // If adminDatabase is the same as the target database, nothing to create
  if (adminDatabase === env.database.name) {
    logger.info('Admin database is the same as target — skipping ensureDatabaseExists.');
    return;
  }

  const client = new pg.Client(buildClientConfig(adminDatabase));

  try {
    await client.connect();
    const result = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [env.database.name]
    );

    if (result.rowCount === 0) {
      const dbName = env.database.name;
      if (!/^[a-zA-Z0-9_-]+$/.test(dbName)) {
        throw new Error('Invalid database name');
      }
      await client.query(`CREATE DATABASE "${dbName}"`);
      logger.info(`Database ${env.database.name} created successfully.`);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    // On managed DB providers the admin database or CREATE privilege may not
    // exist. This is expected — the database is already provisioned.
    logger.warn(
      `ensureDatabaseExists skipped (${msg}). If the database is managed (Render, RDS, etc.) this is expected.`
    );
  } finally {
    await client.end().catch(() => {});
  }
};

// Try to ensure the DB exists, but don't block startup if it fails
await ensureDatabaseExists();

const sequelizeOptions: Options = {
  host: env.database.host,
  port: env.database.port,
  dialect: 'postgres',
  dialectModule: pg,
  logging: env.database.logging ? console.log : false,
  dialectOptions: env.database.ssl
    ? {
        ssl: {
          require: true,
          rejectUnauthorized: env.database.sslRejectUnauthorized,
        },
      }
    : undefined,
};

// Support DATABASE_URL connection string (Render, Heroku, etc.)
const databaseUrl = process.env.DATABASE_URL;

export const sequelize = databaseUrl
  ? new Sequelize(databaseUrl, {
      dialect: 'postgres',
      dialectModule: pg,
      logging: env.database.logging ? console.log : false,
      dialectOptions: {
        ssl: {
          require: true,
          rejectUnauthorized: env.database.sslRejectUnauthorized,
        },
      },
    })
  : new Sequelize(
      env.database.name,
      env.database.username,
      env.database.password,
      sequelizeOptions
    );

export const connectDatabase = async (): Promise<void> => {
  await sequelize.authenticate();
  logger.info('Database authenticated');

  // Run pending migrations via sequelize-cli.
  // The CLI reads its own config from sequelize.config.cjs which also
  // supports DATABASE_URL for managed providers.
  try {
    logger.info('Running database migrations...');
    const configPath = path.join(projectRoot, 'sequelize.config.cjs');
    const migrationsPath = path.join(projectRoot, 'migrations');
    execSync(
      `npx sequelize-cli db:migrate --config "${configPath}" --migrations-path "${migrationsPath}"`,
      { stdio: 'inherit', cwd: projectRoot }
    );
    logger.info('Migrations complete');
  } catch (error) {
    logger.error('Migration failed', error);
    throw error;
  }

  // Sync models to create any tables not covered by migrations
  // alter: false ensures no destructive changes; it only creates missing tables
  await sequelize.sync({ alter: false });

  // Seed data only in development (or when explicitly forced)
  if (env.nodeEnv === 'development' || process.env.FORCE_SEED === 'true') {
    logger.info('Running seed data (development mode)...');
    const { seedAll } = await import('../seeders/index.js');
    await seedAll();
  } else {
    logger.info(`Skipping seed data (NODE_ENV=${env.nodeEnv})`);
  }
};

export default sequelize;
