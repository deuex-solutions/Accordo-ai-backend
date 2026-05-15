import { Request, Response, NextFunction } from "express";
import logger from "../config/logger.js";

interface RequestBody {
  [key: string]: unknown;
}

interface LogData {
  method: string;
  url: string;
  path: string;
  statusCode: number;
  duration: string;
  timestamp: string;
  user: {
    userId?: number;
    userEmail?: string;
  };
  ip: string | undefined;
  request?: {
    params: Record<string, string>;
    query: Record<string, unknown>;
    body: RequestBody | undefined;
  };
}

const sanitizeRequestBody = (
  body: RequestBody | undefined,
): RequestBody | undefined => {
  if (!body) return body;
  const sanitized = { ...body };
  // Remove sensitive fields from logging
  const sensitiveFields = [
    "password",
    "apiSecret",
    "apiKey",
    "token",
    "authorization",
  ];
  sensitiveFields.forEach((field) => {
    if (sanitized[field]) {
      sanitized[field] = "[REDACTED]";
    }
  });
  return sanitized;
};

export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const logData: LogData = {
      method: req.method,
      url: req.originalUrl,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
      user: {
        userId: req.context?.userId,
        userEmail: req.context?.email,
      },
      ip: req.ip || req.socket.remoteAddress,
    };

    // Include request details for errors
    if (res.statusCode >= 400) {
      logData.request = {
        params: req.params as Record<string, string>,
        query: req.query as Record<string, unknown>,
        body: sanitizeRequestBody(req.body as RequestBody),
      };
    }

    const message = `${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`;
    const ctx = { event: "http.request", requestId: req.id, ...logData };

    if (res.statusCode >= 500) {
      logger.error(ctx, message);
    } else if (res.statusCode >= 400) {
      logger.warn(ctx, message);
    } else {
      logger.info(ctx, message);
    }
  });

  next();
};
