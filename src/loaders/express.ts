import express, { Application, Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import toobusy from "toobusy-js";
import swaggerUi from "swagger-ui-express";
import env from "../config/env.js";
import swaggerSpec from "../config/swagger.js";
import { requestLogger } from "../middlewares/request-logger.js";
import { requestIdMiddleware } from "../middlewares/request-id.js";
import { errorHandler, notFoundHandler } from "../middlewares/error-handler.js";
import routes from "../routes/index.js";
import logger from "../config/logger.js";

export const createExpressApp = (): Application => {
  const app = express();

  app.set("trust proxy", 1);

  // Swagger UI documentation - MUST be before Helmet to avoid CSP issues
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

  app.use(
    rateLimit({
      windowMs: env.rateLimit.windowMs,
      max: env.rateLimit.max,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (toobusy()) {
      res.status(503).json({ message: "Server is busy, please try again" });
    } else {
      next();
    }
  });

  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Request ID must come before the logger so each request line carries it.
  app.use(requestIdMiddleware);
  app.use(requestLogger);

  // Root health check for Render/load balancers
  app.get("/", (_req: Request, res: Response) => {
    res.json({ status: "ok", message: "Accordo API is running" });
  });

  // Swagger JSON endpoint
  app.get("/api-docs.json", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "application/json");
    res.send(swaggerSpec);
  });

  logger.info(`Swagger UI available at http://localhost:${env.port}/api-docs`);

  app.use("/api", routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

export default createExpressApp;
