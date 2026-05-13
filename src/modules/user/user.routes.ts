import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import {
  getUserProfileController,
  createUser,
  assignRole,
  getUserRolePermission,
  updateProfile,
  getAllUsers,
  getUser,
  deleteUser,
} from "./user.controller.js";
import {
  authMiddleware,
  checkPermission,
} from "../../middlewares/auth.middleware.js";
import { upload } from "../../middlewares/upload.middleware.js";
import { cleanJson } from "../../middlewares/clean.middleware.js";

const userRouter = Router();
const moduleId = 2;

/**
 * Get current user profile
 * Requires: Authentication
 */
userRouter.get("/profile", authMiddleware, getUserProfileController);

/**
 * Create a new user
 * Requires: Authentication + Create permission (level 3)
 */
userRouter.post(
  "/create",
  authMiddleware,
  upload.any(),
  cleanJson,
  (req: Request, res: Response, next: NextFunction) =>
    checkPermission(req, res, next, moduleId, 3),
  createUser,
);

/**
 * Update user profile
 * Requires: Authentication + Update permission (level 2)
 */
userRouter.post(
  "/update-profile",
  authMiddleware,
  upload.any(),
  cleanJson,
  (req: Request, res: Response, next: NextFunction) =>
    checkPermission(req, res, next, moduleId, 2),
  updateProfile,
);

/**
 * Get a specific user by ID
 * Requires: Authentication + Read permission (level 1)
 */
userRouter.get(
  "/get/:userid",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) =>
    checkPermission(req, res, next, moduleId, 1),
  getUser,
);

/**
 * Get all users with pagination and filtering
 * Requires: Authentication + Read permission (level 1)
 */
userRouter.get(
  "/get-all",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) =>
    checkPermission(req, res, next, moduleId, 1),
  getAllUsers,
);

/**
 * Assign a role to a user
 * Requires: Authentication + Update permission (level 2)
 */
userRouter.post(
  "/assign-role",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) =>
    checkPermission(req, res, next, moduleId, 2),
  assignRole,
);

/**
 * Get user role permissions
 * Requires: Authentication + Read permission (level 1)
 */
userRouter.get(
  "/user-role-permission/:userid",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) =>
    checkPermission(req, res, next, moduleId, 1),
  getUserRolePermission,
);

/**
 * Delete a user
 * Requires: Authentication + Delete permission (level 4)
 */
userRouter.delete(
  "/delete/:userid",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) =>
    checkPermission(req, res, next, moduleId, 4),
  deleteUser,
);

// RESTful aliases (frontend uses these; verbose paths above kept for back-compat)
userRouter.post(
  "/",
  authMiddleware,
  upload.any(),
  cleanJson,
  (req: Request, res: Response, next: NextFunction) =>
    checkPermission(req, res, next, moduleId, 3),
  createUser,
);
userRouter.get(
  "/",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) =>
    checkPermission(req, res, next, moduleId, 1),
  getAllUsers,
);
userRouter.get(
  "/:userid",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) =>
    checkPermission(req, res, next, moduleId, 1),
  getUser,
);
userRouter.delete(
  "/:userid",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) =>
    checkPermission(req, res, next, moduleId, 4),
  deleteUser,
);

export default userRouter;
