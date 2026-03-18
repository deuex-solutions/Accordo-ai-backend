import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import {
  signInUser,
  registerUser,
  forgotPassword,
  verifyOtp,
  resetPassword,
  changePassword,
  resetPasswordAuto,
  refreshToken,
  logout,
  getRoles,
} from "./auth.controller.js";
import { authMiddleware, checkPermission } from "../../middlewares/auth.middleware.js";

const authRouter = Router();
const moduleId = 2;

/**
 * Public routes
 */
authRouter.post("/register", registerUser);
authRouter.post("/login", signInUser);
authRouter.post("/refresh-token", refreshToken);
authRouter.post("/forgot-password", forgotPassword);
authRouter.post("/verify-otp", verifyOtp);
authRouter.put("/reset-password/:userid", resetPassword);
authRouter.put("/reset-password-auto/:userid", resetPasswordAuto);
authRouter.get("/roles", getRoles);

/**
 * Protected routes
 */
authRouter.post("/logout", authMiddleware, logout);
authRouter.post(
  "/change-password",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) => checkPermission(req, res, next, moduleId, 2),
  changePassword
);

export default authRouter;
