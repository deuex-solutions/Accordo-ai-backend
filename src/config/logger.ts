/**
 * Logger — see LOGGING.md at repo root for the canonical contract.
 *
 * - Levels: fatal / error / warn / info / debug
 * - Dev (NODE_ENV !== "production"): pretty-printed via pino-pretty
 * - Prod: raw JSON, one event per line, to stdout (no files)
 * - Redaction enforced at the logger; never log secrets explicitly
 * - Use `req.log` inside request handlers to inherit requestId/userId/companyId
 */

import pino from "pino";
import env from "./env.js";

const isProd = env.nodeEnv === "production";

const redactPaths = [
  // top-level common keys
  "password",
  "newPassword",
  "currentPassword",
  "accessToken",
  "refreshToken",
  "token",
  "apiKey",
  "apiSecret",
  "otp",
  // request fields
  "req.headers.authorization",
  'req.headers["x-refresh-token"]',
  "req.headers.cookie",
  "req.body.password",
  "req.body.newPassword",
  "req.body.currentPassword",
  "req.body.refreshToken",
  "req.body.token",
  "req.body.otp",
  // response fields
  'res.headers["set-cookie"]',
  // nested catch-all (one level)
  "*.password",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
];

const pinoInstance = pino({
  level: env.logLevel || "info",
  base: {
    service: "accordo-backend",
    env: env.nodeEnv,
  },
  redact: {
    paths: redactPaths,
    censor: "[REDACTED]",
  },
  // Pretty in dev, raw JSON in prod
  transport: isProd
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:HH:MM:ss.l",
          ignore: "pid,hostname,service,env",
          singleLine: false,
        },
      },
  serializers: pino.stdSerializers,
});

/**
 * Compatibility shim: existing call sites use Winston's `logger.info(msg, meta)`
 * signature; Pino is `logger.info(meta, msg)`. This shim accepts either form
 * so we can swap loggers without breaking 600+ existing calls. New code SHOULD
 * use the Pino-native `({...}, "msg")` form — see LOGGING.md.
 */
type LogFn = (a: unknown, b?: unknown, ...rest: unknown[]) => void;
type Lvl = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

const make =
  (lvl: Lvl): LogFn =>
  (a: unknown, b?: unknown, ...rest: unknown[]): void => {
    // String first → Winston-style. Reorder to Pino's (obj, msg).
    if (
      typeof a === "string" &&
      b !== undefined &&
      typeof b === "object" &&
      b !== null
    ) {
      pinoInstance[lvl](b as object, a, ...rest);
      return;
    }
    // String only → message only. (Extra varargs become printf-style values to Pino.)
    if (typeof a === "string") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pinoInstance as any)[lvl](a, b, ...rest);
      return;
    }
    // Object first → Pino-native shape, pass through.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pinoInstance as any)[lvl](a, b, ...rest);
  };

const logger = {
  fatal: make("fatal"),
  error: make("error"),
  warn: make("warn"),
  info: make("info"),
  debug: make("debug"),
  trace: make("trace"),
  // Escape hatch for code that needs the raw pino instance (pino-http etc.)
  _pino: pinoInstance,
  child: (bindings: object) => pinoInstance.child(bindings),
};

export { logger };
export default logger;
