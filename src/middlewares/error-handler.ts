import { Request, Response, NextFunction } from "express";
import logger from "../config/logger.js";
import { CustomError, AppError } from "../utils/custom-error.js";

interface RequestBody {
  [key: string]: unknown;
}

interface ErrorWithDetails extends Error {
  statusCode?: number;
  details?: unknown;
  original?: {
    message: string;
    code?: string;
    sql?: string;
  };
}

interface ErrorLogData {
  error: {
    message: string;
    name: string;
    statusCode: number;
    stack?: string;
    details?: unknown;
    originalError?: {
      message: string;
      code?: string;
      sql?: string;
    };
  };
  request: {
    method: string;
    url: string;
    path: string;
    params: Record<string, string>;
    query: Record<string, unknown>;
    body: RequestBody | undefined;
    headers: {
      "content-type"?: string;
      "user-agent"?: string;
      referer?: string;
    };
    ip: string | undefined;
  };
  user: {
    userId?: number;
    userEmail?: string;
  };
  timestamp: string;
}

interface ErrorResponse {
  message: string;
  details?: unknown;
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

export const notFoundHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  next(new AppError(`Route ${req.originalUrl} not found`, 404));
};

export const errorHandler = (
  err: ErrorWithDetails,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  // Determine status code
  // Priority: 1. err.statusCode (from CustomError/AppError), 2. Check error message for auth errors, 3. Default to 500
  let statusCode = err.statusCode;

  // If no statusCode set, check for common authentication/JWT errors
  if (!statusCode) {
    const errorMessage = err.message?.toLowerCase() || "";
    if (
      errorMessage.includes("jwt expired") ||
      errorMessage.includes("token expired") ||
      errorMessage.includes("authorization header missing") ||
      errorMessage.includes("invalid token") ||
      errorMessage.includes("authentication failed") ||
      errorMessage.includes("unauthorized") ||
      (err instanceof CustomError && !statusCode) // CustomError should always have statusCode, but double-check
    ) {
      statusCode = 401;
    } else {
      statusCode = 500; // Default to 500 for unexpected errors
    }
  }

  // Ensure CustomError and AppError instances use their statusCode
  if (
    (err instanceof CustomError || err instanceof AppError) &&
    err.statusCode
  ) {
    statusCode = err.statusCode;
  }

  const response: ErrorResponse = {
    message: err.message || "Internal Server Error",
  };

  if (err.details) {
    response.details = err.details;
  }

  // Prepare error log object with full context
  const errorLog: ErrorLogData = {
    error: {
      message: err.message || "Internal Server Error",
      name: err.name || "Error",
      statusCode,
      stack: err.stack,
      details: err.details,
      originalError: err.original
        ? {
            message: err.original.message,
            code: err.original.code,
            sql: err.original.sql,
          }
        : undefined,
    },
    request: {
      method: req.method,
      url: req.originalUrl,
      path: req.path,
      params: req.params as Record<string, string>,
      query: req.query as Record<string, unknown>,
      body: sanitizeRequestBody(req.body as RequestBody),
      headers: {
        "content-type": req.headers["content-type"],
        "user-agent": req.headers["user-agent"],
        referer: req.headers["referer"] as string | undefined,
      },
      ip: req.ip || req.socket.remoteAddress,
    },
    user: {
      userId: req.context?.userId,
      userEmail: req.context?.email,
    },
    timestamp: new Date().toISOString(),
  };

  if (statusCode >= 500) {
    logger.error("API Error (5xx):", errorLog);
  } else {
    logger.warn("API Error (4xx):", errorLog);
  }

  res.status(statusCode).json(response);
};
