import env from "./config/env.js";
import logger from "./config/logger.js";
import { connectDatabase } from "./config/database.js";
import createExpressApp from "./loaders/express.js";
import "./models/index.js";
import {
  startDeadlineScheduler,
  stopDeadlineScheduler,
} from "./modules/bid-comparison/scheduler/deadline-checker.js";

interface ErrorWithStack extends Error {
  stack?: string;
}

interface RejectionReason {
  message?: string;
  stack?: string;
  name?: string;
}

// Handle unhandled promise rejections
process.on(
  "unhandledRejection",
  (reason: unknown, promise: Promise<unknown>) => {
    const r = reason as RejectionReason;
    logger.error(
      {
        event: "process.unhandled_rejection",
        err: {
          name: r?.name || "UnhandledRejection",
          message: r?.message || String(reason),
          stack: r?.stack,
        },
        promise: promise.toString(),
      },
      "unhandled promise rejection",
    );
  },
);

// Handle uncaught exceptions
process.on("uncaughtException", (error: ErrorWithStack) => {
  logger.fatal(
    {
      event: "process.uncaught_exception",
      err: { name: error.name, message: error.message, stack: error.stack },
    },
    "uncaught exception",
  );
  // Give time for logs to flush before exiting
  setTimeout(() => process.exit(1), 1000);
});

(async (): Promise<void> => {
  try {
    await connectDatabase();
    logger.info({ event: "db.connected" }, "database connection established");

    const app = createExpressApp();
    const host = process.env.HOST || "0.0.0.0";
    app.listen(env.port, host, () => {
      logger.info(
        { event: "server.listening", host, port: env.port },
        "server listening",
      );
      startDeadlineScheduler();
      logger.info(
        { event: "scheduler.started", name: "deadline" },
        "deadline scheduler started",
      );
    });

    // Graceful shutdown
    process.on("SIGTERM", () => {
      logger.info(
        { event: "process.shutdown", signal: "SIGTERM" },
        "shutting down gracefully",
      );
      stopDeadlineScheduler();
      process.exit(0);
    });

    process.on("SIGINT", () => {
      logger.info(
        { event: "process.shutdown", signal: "SIGINT" },
        "shutting down gracefully",
      );
      stopDeadlineScheduler();
      process.exit(0);
    });
  } catch (error) {
    const err = error as ErrorWithStack;
    logger.fatal(
      {
        event: "server.start_failed",
        err: { name: err.name, message: err.message, stack: err.stack },
      },
      "failed to start application",
    );
    process.exit(1);
  }
})();
