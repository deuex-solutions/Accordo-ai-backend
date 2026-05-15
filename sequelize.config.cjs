const path = require("path");
const dotenv = require("dotenv");

const envPath = path.resolve(__dirname, ".env");
dotenv.config({ path: envPath });

const useSSL = process.env.DB_SSL === "true";
const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false";

// Support DATABASE_URL connection string (Render, Heroku, etc.)
// When DATABASE_URL is set, it takes precedence over individual DB_* vars.
const databaseUrl = process.env.DATABASE_URL;

const sslDialectOptions = {
  ssl: {
    require: true,
    rejectUnauthorized,
  },
};

if (databaseUrl) {
  // Parse DATABASE_URL and build config from it
  const shared = {
    url: databaseUrl,
    dialect: "postgres",
    logging: process.env.DB_LOGGING === "true" ? console.log : false,
    dialectOptions: sslDialectOptions,
  };

  module.exports = {
    development: shared,
    test: shared,
    production: shared,
    staging: shared,
  };
} else {
  const shared = {
    host: process.env.DB_HOST || "127.0.0.1",
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
    database: process.env.DB_NAME || "accordo",
    username: process.env.DB_USERNAME || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    dialect: "postgres",
    logging: process.env.DB_LOGGING === "true" ? console.log : false,
    ...(useSSL ? { dialectOptions: sslDialectOptions } : {}),
  };

  module.exports = {
    development: shared,
    test: {
      ...shared,
      database: process.env.DB_NAME_TEST || `${shared.database}_test`,
    },
    production: shared,
    staging: shared,
  };
}
