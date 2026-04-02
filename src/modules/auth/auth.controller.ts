import type { Request, Response, NextFunction } from "express";
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
import { getParam } from '../../types/index.js';
import { Role } from '../../models/index.js';

/**
 * Request with context (added by auth middleware)
 */
interface RequestWithContext extends Request {
  context: {
    userId: number;
    userType: string;
    companyId?: number;
    email?: string;
  };
}

/**
 * Reset password for a user
 * @param req - Express request with userid param and password body
 * @param res - Express response
 * @param next - Express next function
 */
export const resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userid = getParam(req.params.userid);
    const { password } = req.body;
    const data = await resetPasswordService(userid, password);
    res.status(201).json({ message: "Password updated successfully", data });
  } catch (error) {
    next(error);
  }
};

/**
 * Reset password automatically with generated password
 * @param req - Express request with userid param
 * @param res - Express response
 * @param next - Express next function
 */
export const resetPasswordAuto = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userid = getParam(req.params.userid);
    const data = await resetPasswordAutoService(userid);
    res.status(201).json({ message: "Password updated successfully", data });
  } catch (error) {
    next(error);
  }
};

/**
 * Change password for authenticated user
 * @param req - Express request with context and password data
 * @param res - Express response
 * @param next - Express next function
 */
export const changePassword = async (req: RequestWithContext, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userData = { ...req.body, userId: req.context.userId };
    const data = await changePasswordService(userData);
    res.status(201).json({ message: "Password changed succesfully", data });
  } catch (error) {
    next(error);
  }
};

/**
 * Verify OTP for password reset
 * @param req - Express request with email and otp in body
 * @param res - Express response
 * @param next - Express next function
 */
export const verifyOtp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await verifyOtpService(req.body);
    res.status(201).json({ message: "Password reset successful", data });
  } catch (error) {
    next(error);
  }
};

/**
 * Send forgot password OTP email
 * @param req - Express request with email in body
 * @param res - Express response
 * @param next - Express next function
 */
export const forgotPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await forgotPasswordService(req.body);
    res.status(201).json({
      message: "Forgot password email sent successfully",
      data: req.body.email,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Register new user
 * @param req - Express request with user data in body
 * @param res - Express response
 * @param next - Express next function
 */
export const registerUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const response = await signUpService(req.body);
    response.user.password = undefined;
    res.status(201).json({
      message: "Successfully signed up",
      data: response.user,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Sign in user with email and password
 * @param req - Express request with credentials in body
 * @param res - Express response
 * @param next - Express next function
 */
export const signInUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const response = await signInService(req.body);
    response.user.password = undefined;
    res.status(200).json({
      message: "Successfully signed in",
      data: response,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Refresh access token using refresh token
 * @param req - Express request with refreshToken in body or header
 * @param res - Express response
 * @param next - Express next function
 */
export const refreshToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const refreshTokenValue = req.body.refreshToken || req.header("x-refresh-token");
    const response = await refreshTokenService(refreshTokenValue);
    res.status(200).json({
      message: "Token refreshed successfully",
      data: response,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Validate token - for use by other backend services to verify JWTs
 * Accepts token via Authorization header or body.token
 * Optional: set AUTH_SERVICE_SECRET to require X-Service-Secret header
 * @param req - Express request with token
 * @param res - Express response
 * @param next - Express next function
 */
export const validateToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.header('Authorization') || req.header('authorization');
    const token = authHeader?.replace(/^Bearer\s+/i, '') || req.body?.token;
    const context = await validateTokenService(token || '');
    res.status(200).json({
      message: 'Token valid',
      data: { valid: true, context },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Logout user by revoking refresh tokens
 * @param req - Express request with context
 * @param res - Express response
 * @param next - Express next function
 */
export const logout = async (req: RequestWithContext, res: Response, next: NextFunction): Promise<void> => {
  try {
    const response = await logoutService(req.context.userId);
    res.status(200).json({
      message: "Logged out successfully",
      data: response,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get available roles (public, no auth required)
 * Filters out Super Admin, Admin, and Vendor User roles
 */
export const getRoles = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const EXCLUDED_ROLES = ['Super Admin', 'Admin', 'Vendor User'];
    const roles = await Role.findAll({
      where: { isArchived: false },
      attributes: ['id', 'name'],
      order: [['id', 'ASC']],
    });
    const filteredRoles = roles.filter((role: any) => !EXCLUDED_ROLES.includes(role.name));
    res.status(200).json({ data: filteredRoles });
  } catch (error) {
    next(error);
  }
};
