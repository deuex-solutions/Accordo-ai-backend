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
  "/create",
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
  "/get-all",
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
  "/get/:roleid",
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
  "/update/:roleid",
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
  "/delete/:roleid",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) =>
    checkPermission(req, res, next, moduleId, 3),
  deleteRole,
);

// RESTful aliases (frontend uses these; verbose paths above kept for back-compat)
roleRouter.post(
  "/",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) =>
    checkPermission(req, res, next, moduleId, 3),
  createRole,
);
roleRouter.get(
  "/",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) =>
    checkPermission(req, res, next, moduleId, 1),
  getAllRoles,
);
roleRouter.get(
  "/:roleid",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) =>
    checkPermission(req, res, next, moduleId, 1),
  getRole,
);
roleRouter.put(
  "/:roleid",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) =>
    checkPermission(req, res, next, moduleId, 2),
  updateRole,
);
roleRouter.delete(
  "/:roleid",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) =>
    checkPermission(req, res, next, moduleId, 3),
  deleteRole,
);

export default roleRouter;
