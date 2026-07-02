import { Router, type Request, type Response, type NextFunction } from "express";
import Joi from "joi";
import {
  signInService,
  signUpService,
  forgotPasswordService,
  verifyOtpService,
  resetPasswordService,
  changePasswordService,
  resetPasswordAutoService,
  refreshTokenService,
  logoutService,
  validateTokenService,
} from "./auth.service.js";
import { authMiddleware, checkPermission } from "../../middlewares/auth.middleware.js";
import { getParam } from "../../utils/types.js";
import { Role } from "../../models/index.js";

const authRouter = Router();
const moduleId = 2;

// ============================================================================
// Interfaces & Joi Validation
// ============================================================================

const options: Joi.ValidationOptions = { errors: { wrap: { label: "" } } };

export interface SignUpData { email: string; name: string; username?: string; companyId?: number; password: string; roleId?: number; userType?: string; }
export interface SignInData { email: string; password: string; }
export interface ForgotPasswordData { email: string; }
export interface UserIdData { user_id: number; password: string; }
export interface OtpData { email: string; otp: number; }
export interface RefreshTokenData { refreshToken: string; }

export const validateSignUp = (userData: SignUpData): Joi.ValidationResult => {
  const schema = Joi.object({
    email: Joi.string().email().required().messages({ "string.email": "Email format is invalid", "any.required": "Email is required" }),
    name: Joi.string().min(1).required().messages({ "string.min": "Name should at least minimum 1 character", "any.required": "Name is required" }),
    username: Joi.string().optional(),
    companyId: Joi.number().integer().optional(),
    roleId: Joi.number().integer().optional(),
    userType: Joi.string().valid("admin", "procurement", "vendor").optional(),
    password: Joi.string().min(8).pattern(new RegExp("^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^a-zA-Z\\d]).+$")).required().messages({
      "string.min": "Password must have at least 8 characters.",
      "string.pattern.base": "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character.",
      "any.required": "Password is required.",
    }),
  });
  return schema.validate(userData, options);
};

export const validateSignIn = (userData: SignInData): Joi.ValidationResult => {
  const schema = Joi.object({
    email: Joi.string().email().required().messages({ "string.email": "Email format is invalid", "any.required": "Email is required" }),
    password: Joi.string().required(),
  });
  return schema.validate(userData, options);
};

export const validateForgotPassword = (userData: ForgotPasswordData): Joi.ValidationResult => {
  const schema = Joi.object({
    email: Joi.string().email().required().messages({ "string.email": "Email format is invalid", "any.required": "Email is required" }),
  });
  return schema.validate(userData, options);
};

export const validateUserId = (userData: UserIdData): Joi.ValidationResult => {
  const schema = Joi.object({
    user_id: Joi.number().integer().required(),
    password: Joi.string().required().messages({ "any.required": "New password is required" }),
  });
  return schema.validate(userData, options);
};

export const validateOtpData = (userData: OtpData): Joi.ValidationResult => {
  const schema = Joi.object({
    email: Joi.string().email().required().messages({ "string.email": "Email format is invalid", "any.required": "Email is required" }),
    otp: Joi.number().integer().required().messages({ "any.required": "Otp is required" }),
  });
  return schema.validate(userData, options);
};

export const validateRefreshToken = (data: RefreshTokenData): Joi.ValidationResult => {
  const schema = Joi.object({
    refreshToken: Joi.string().required().messages({ "any.required": "Refresh token is required" }),
  });
  return schema.validate(data, options);
};

// ============================================================================
// Endpoint Handlers & Routes
// ============================================================================

authRouter.post("/register", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const response = await signUpService(req.body);
    response.user.password = undefined;
    res.status(201).json({ message: "Successfully signed up", data: response.user });
  } catch (error) { next(error); }
});

authRouter.post("/login", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const response = await signInService(req.body);
    response.user.password = undefined;
    res.status(200).json({ message: "Successfully signed in", data: response });
  } catch (error) { next(error); }
});

authRouter.post("/refresh-token", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const refreshTokenValue = req.body.refreshToken || req.header("x-refresh-token");
    const response = await refreshTokenService(refreshTokenValue);
    res.status(200).json({ message: "Token refreshed successfully", data: response });
  } catch (error) { next(error); }
});

authRouter.post("/forgot-password", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await forgotPasswordService(req.body);
    res.status(201).json({ message: "Forgot password email sent successfully", data: req.body.email });
  } catch (error) { next(error); }
});

authRouter.post("/verify-otp", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await verifyOtpService(req.body);
    res.status(201).json({ message: "Password reset successful", data });
  } catch (error) { next(error); }
});

authRouter.put("/reset-password/:userId", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userid = getParam(req.params.userId);
    const { password } = req.body;
    const data = await resetPasswordService(userid, password);
    res.status(201).json({ message: "Password updated successfully", data });
  } catch (error) { next(error); }
});

authRouter.put("/reset-password-auto/:userId", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userid = getParam(req.params.userId);
    const data = await resetPasswordAutoService(userid);
    res.status(201).json({ message: "Password updated successfully", data });
  } catch (error) { next(error); }
});

authRouter.get("/roles", async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const EXCLUDED_ROLES = ["Super Admin", "Admin", "Vendor User"];
    const roles = await Role.findAll({ where: { isArchived: false }, attributes: ["id", "name"], order: [["id", "ASC"]] });
    const filteredRoles = roles.filter((role: any) => !EXCLUDED_ROLES.includes(role.name));
    res.status(200).json({ data: filteredRoles });
  } catch (error) { next(error); }
});

authRouter.post("/logout", authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const response = await logoutService(req.context.userId);
    res.status(200).json({ message: "Logged out successfully", data: response });
  } catch (error) { next(error); }
});

authRouter.post(
  "/change-password",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) => checkPermission(req, res, next, moduleId, 2),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userData = { ...req.body, userId: req.context.userId };
      const data = await changePasswordService(userData);
      res.status(201).json({ message: "Password changed succesfully", data });
    } catch (error) { next(error); }
  }
);

export default authRouter;
