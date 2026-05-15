import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";

/**
 * Request ID middleware.
 *
 * - Reads incoming `x-request-id` header so an upstream caller (frontend, gateway,
 *   or another service) can pass through an existing correlation id.
 * - Generates a fresh UUID v4 when no header is present.
 * - Echoes the id in the response `x-request-id` header.
 * - Stashes it on `req.id` so downstream code (loggers, outbound HTTP) can read it.
 *
 * See LOGGING.md §3 (Required fields) for why this matters.
 */

declare module "express-serve-static-core" {
  interface Request {
    id?: string;
  }
}

export const requestIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const incoming = (req.headers["x-request-id"] as string | undefined)?.trim();
  const id = incoming && incoming.length <= 128 ? incoming : randomUUID();
  req.id = id;
  res.setHeader("x-request-id", id);
  next();
};
