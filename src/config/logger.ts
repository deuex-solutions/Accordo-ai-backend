import path from "path";
import { fileURLToPath } from "url";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import env from "./env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logDirectory = path.resolve(__dirname, "../../logs");

// removed unused: interface LogMetadata { [key: string]: unknown }

const consoleFormat = winston.format.printf(
  ({
    level,
    message,
    timestamp,
    ...metadata
  }: winston.Logform.TransformableInfo) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(metadata).length > 0) {
      msg += ` ${JSON.stringify(metadata, null, 2)}`;
    }
    return msg;
  },
);

const transports: winston.transport[] = [
  new winston.transports.Console({
    level: env.logLevel,
    format: winston.format.combine(
      winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
      winston.format.colorize(),
      consoleFormat,
    ),
  }),
];

if (env.nodeEnv !== "test") {
  transports.push(
    new DailyRotateFile({
      dirname: path.join(logDirectory, "combined"),
      filename: "%DATE%.log",
      datePattern: "YYYY-MM-DD",
      zippedArchive: false,
      maxFiles: "14d",
      level: env.logLevel,
    }),
  );

  transports.push(
    new DailyRotateFile({
      dirname: path.join(logDirectory, "error"),
      filename: "%DATE%.error.log",
      datePattern: "YYYY-MM-DD",
      zippedArchive: false,
      level: "error",
      maxFiles: "30d",
    }),
  );
}

export const logger = winston.createLogger({
  level: env.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
  ),
  transports,
});

export default logger;
