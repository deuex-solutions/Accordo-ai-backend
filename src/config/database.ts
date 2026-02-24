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

interface SSLConfig {
  ssl?: {
    require: boolean;
    rejectUnauthorized: boolean;
  };
}

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

const sslConfig: SSLConfig = env.database.ssl
  ? {
      ssl: {
        require: true,
        rejectUnauthorized: env.database.sslRejectUnauthorized,
      },
    }
  : {};

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

export const ensureDatabaseExists = async (): Promise<void> => {
  const adminDatabase = env.database.adminDatabase || 'postgres';
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
      if (env.database.logging) {
        console.log(`Database ${env.database.name} created successfully.`);
      }
    }
  } catch (error) {
    console.error('Failed to ensure database exists:', error);
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
};

// Ensure database exists before creating Sequelize instance
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

export const sequelize = new Sequelize(
  env.database.name,
  env.database.username,
  env.database.password,
  sequelizeOptions
);

export const connectDatabase = async (): Promise<void> => {
  await sequelize.authenticate();
  logger.info('Database authenticated');

  // Run pending migrations
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
  await sequelize.sync();

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
