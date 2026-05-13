import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import {
  createRole,
  getAllRoles,
  getRole,
  updateRole,
  deleteRole,
} from "./role.controller.js";
import {
  authMiddleware,
  checkPermission,
} from "../../middlewares/auth.middleware.js";

const roleRouter = Router();
const moduleId = 6;

/**
 * Create a new role
 * Requires: Authentication + Create permission (level 3)
 */
roleRouter.post(
  "/",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) =>
    checkPermission(req, res, next, moduleId, 3),
  createRole,
);

/**
 * Get all roles for the user's company
 * Requires: Authentication + Read permission (level 1)
 */
roleRouter.get(
  "/",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) =>
    checkPermission(req, res, next, moduleId, 1),
  getAllRoles,
);

/**
 * Get a specific role by ID
 * Requires: Authentication + Read permission (level 1)
 */
roleRouter.get(
  "/:roleId",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) =>
    checkPermission(req, res, next, moduleId, 1),
  getRole,
);

/**
 * Update a role
 * Requires: Authentication + Update permission (level 2)
 */
roleRouter.put(
  "/:roleId",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) =>
    checkPermission(req, res, next, moduleId, 2),
  updateRole,
);

/**
 * Delete (archive) a role
 * Requires: Authentication + Delete permission (level 3)
 */
roleRouter.delete(
  "/:roleId",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) =>
    checkPermission(req, res, next, moduleId, 3),
  deleteRole,
);

export default roleRouter;
