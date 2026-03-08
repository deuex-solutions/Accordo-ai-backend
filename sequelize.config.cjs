const path = require("path");
const dotenv = require("dotenv");

const envPath = path.resolve(__dirname, ".env");
dotenv.config({ path: envPath });

const useSSL = process.env.DB_SSL === "true";
const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false";

const shared = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
  database: process.env.DB_NAME || "accordo",
  username: process.env.DB_USERNAME || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  dialect: "postgres",
  logging: process.env.DB_LOGGING === "true" ? console.log : false,
  ...(useSSL
    ? {
        dialectOptions: {
          ssl: {
            require: true,
            rejectUnauthorized,
          },
        },
      }
    : {}),
};

module.exports = {
  development: shared,
  test: {
    ...shared,
    database: process.env.DB_NAME_TEST || `${shared.database}_test`,
  },
  production: shared,
};
