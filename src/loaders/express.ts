import express, { Application, Request, Response, NextFunction } from "express";
import compression from "compression";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import toobusy from "toobusy-js";
import swaggerUi from "swagger-ui-express";
import env from "../config/env.js";
import swaggerSpec from "../config/swagger.js";
import { requestLogger } from "../middlewares/request-logger.js";
import { errorHandler, notFoundHandler } from "../middlewares/error-handler.js";
import routes from "../routes/index.js";
import logger from "../config/logger.js";

export const createExpressApp = (): Application => {
  const app = express();

  app.set("trust proxy", 1);

  // Swagger UI documentation — gated by ENABLE_SWAGGER (default off in prod).
  // Mount before Helmet to avoid CSP issues.
  if (env.features.enableSwagger) {
    app.use(
      "/api-docs",
      swaggerUi.serve,
      swaggerUi.setup(swaggerSpec, {
        explorer: true,
        customCss: ".swagger-ui .topbar { display: none }",
        customSiteTitle: "Accordo AI API Documentation",
        swaggerOptions: {
          persistAuthorization: true,
          displayRequestDuration: true,
          filter: true,
          showExtensions: true,
          showCommonExtensions: true,
        },
      }),
    );
  }

  // Helmet security headers (applied after Swagger to avoid CSP conflicts)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
    }),
  );
  app.use(cors(env.cors));
  app.use(compression());

  app.use(
    rateLimit({
      windowMs: env.rateLimit.windowMs,
      max: env.rateLimit.max,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.use((_req: Request, res: Response, next: NextFunction) => {
    if (toobusy()) {
      res.status(503).json({ message: "Server is busy, please try again" });
    } else {
      next();
    }
  });

  // 5 MB is conservative for JSON bodies — real payloads (deal config,
  // chatbot messages) sit well under 1 MB. File uploads go through multer,
  // not this parser. If a legitimate endpoint ever needs more, attach a
  // route-specific parser at that endpoint rather than raising the global cap.
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true, limit: "5mb" }));

  app.use(requestLogger);

  // Root health check for Render/load balancers
  app.get("/", (_req: Request, res: Response) => {
    res.json({ status: "ok", message: "Accordo API is running" });
  });

  if (env.features.enableSwagger) {
    // Swagger JSON endpoint
    app.get("/api-docs.json", (_req: Request, res: Response) => {
      res.setHeader("Content-Type", "application/json");
      res.send(swaggerSpec);
    });
    logger.info(
      `Swagger UI available at http://localhost:${env.port}/api-docs`,
    );
  }

  app.use("/api", routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

export default createExpressApp;
