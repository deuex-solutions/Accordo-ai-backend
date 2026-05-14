import crypto from "crypto";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { compareSync, hash } from "bcrypt";

import {
  validateSignIn,
  validateSignUp,
  validateForgotPassword,
  validateOtpData,
  validateUserId,
  validateRefreshToken,
  type SignInData,
  type SignUpData,
  type ForgotPasswordData,
  type OtpData,
  type RefreshTokenData,
} from "./auth.validator.js";
import repo from "./auth.repo.js";
import companyRepo from "../company/company.repo.js";
import otpRepo from "./otp.repo.js";
import { generateJWT, verifyJWT } from "../../middlewares/jwt.service.js";
import { getRoleService } from "../role/role.service.js";
import { Role, RolePermission } from "../../models/index.js";
import CustomError from "../../utils/custom-error.js";
import env from "../../config/env.js";
import { sequelize } from "../../config/database.js";
import logger from "../../config/logger.js";

const { smtp, jwt } = env;

/**
 * Change password data interface
 */
interface ChangePasswordData {
  userId: number;
  currentPassword: string;
  newPassword: string;
}

/**
 * JWT payload interface
 */
interface JWTPayload {
  userId: number;
  userType: string;
  companyId?: number;
  roleData?: unknown;
}

/**
 * User interface (basic structure)
 */
interface User {
  id: number;
  email: string;
  password?: string;
  roleId?: number;
  companyId?: number;
  userType?: string;
}

/**
 * Authentication response interface
 */
interface AuthResponse {
  user: User;
  accessToken?: string;
  refreshToken?: string;
}

/**
 * Build nodemailer transporter
 * @returns Nodemailer transporter instance
 * @throws CustomError if SMTP configuration is missing
 */
const buildTransporter = (): Transporter => {
  if (!smtp.host || !smtp.user) {
    throw new CustomError("SMTP configuration missing", 500);
  }
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port || 587,
    secure: smtp.port === 465,
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
  });
};

/**
 * Reset user password with validation
 * @param userId - User ID as string
 * @param password - New password
 * @returns Update result
 * @throws CustomError if validation fails
 */
export const resetPasswordService = async (userId: string, password: string): Promise<[affectedCount: number]> => {
  const { error } = validateUserId({ user_id: Number(userId), password });
  if (error) {
    throw new CustomError(error.details[0].message, 400);
  }

  const hashedPassword = await hash(password, 10);
  return repo.updatePassword(Number(userId), hashedPassword);
};

/**
 * Generate a strong random password
 * @returns Random password string
 */
const generateStrongPassword = (): string => {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+[]{}|;:,.<>?";
  let password = "";
  const length = 8;
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    password += characters[randomIndex];
  }
  return password;
};

/**
 * Reset password automatically and email to user
 * @param userId - User ID as string
 * @returns Email send result
 * @throws CustomError if user not found
 */
export const resetPasswordAutoService = async (userId: string): Promise<unknown> => {
  const password = generateStrongPassword();
  const hashedPassword = await hash(password, 10);

  await repo.updatePassword(Number(userId), hashedPassword);
  const user = await repo.findUser(Number(userId)) as User | null;
  if (!user) {
    throw new CustomError("User not found", 404);
  }

  const transporter = buildTransporter();
  const mailOptions = {
    to: user.email,
    from: smtp.from,
    subject: "Password Reset Successful",
    text: `Your new password is ${password}`,
  };

  return transporter.sendMail(mailOptions);
};

/**
 * Verify OTP for password reset
 * @param resetPasswordData - Email and OTP data
 * @returns User data
 * @throws CustomError if validation fails or OTP invalid
 */
export const verifyOtpService = async (resetPasswordData: OtpData): Promise<unknown> => {
  const { error } = validateOtpData(resetPasswordData);
  if (error) {
    throw new CustomError(error.details[0].message, 400);
  }

  const user = await repo.verifyOTP(resetPasswordData);
  if (!user) {
    throw new CustomError("Email incorrect or OTP invalid.", 409);
  }

  return user;
};

/**
 * Send forgot password OTP email
 * @param userData - Email data
 * @returns Email send result
 * @throws CustomError if validation fails or user not found
 */
export const forgotPasswordService = async (userData: ForgotPasswordData): Promise<unknown> => {
  const { error } = validateForgotPassword(userData);
  if (error) {
    throw new CustomError(error.details[0].message, 400);
  }

  const user = await repo.findUserByEmail(userData.email) as User | null;
  if (!user) {
    throw new CustomError("User not found", 409);
  }

  const otp = crypto.randomInt(100000, 1000000);
  await otpRepo.createOtp({
    user_id: user.id,
    for: "forgot_password",
    otp: String(otp),
    createdAt: new Date(),
  });

  const transporter = buildTransporter();
  const mailOptions = {
    to: user.email,
    from: smtp.from,
    subject: "Password Reset OTP",
    text: `Your OTP for password reset is ${otp}. It is valid for 1 hour.`,
  };

  return transporter.sendMail(mailOptions);
};

/**
 * Sign up new user with company creation
 * @param userData - Sign up data
 * @returns Created user data
 * @throws CustomError if validation fails or email exists
 */
export const signUpService = async (userData: SignUpData): Promise<AuthResponse> => {
  const { error } = validateSignUp(userData);
  if (error) {
    throw new CustomError(error.details[0].message, 400);
  }

  const existing = await repo.findUserByEmail(userData.email);
  if (existing) {
    throw new CustomError(`Email ${userData.email} already exists`, 409);
  }

  const transaction = await sequelize.transaction();

  try {
    const username = `${userData.email}`;
    const hashedPassword = await hash(userData.password, 10);
    const company = await companyRepo.createCompany({}, transaction) as { id: number };

    // Seed default roles for the new company
    const defaultRoleNames = [
      'Super Admin', 'Admin', 'CEO', 'CFO', 'HOD',
      'Procurement Manager', 'Procurement Manager Approver',
    ];
    const createdRoles = await Role.bulkCreate(
      defaultRoleNames.map((name) => ({ name, companyId: company.id, isArchived: false })),
      { transaction, returning: true }
    );

    // Build a name->id map for the new roles
    const roleMap: Record<string, number> = {};
    for (const role of createdRoles) {
      roleMap[(role as any).name] = (role as any).id;
    }

    // Seed role permissions for each role (permission levels: 1=Read, 3=R/W, 7=R/W/U, 15=Full)
    const permissionTemplates: Record<string, { moduleId: number; permission: number }[]> = {
      'Super Admin': [1, 2, 3, 4, 5, 6].map((m) => ({ moduleId: m, permission: 15 })),
      'Admin': [1, 2, 3, 4, 5, 6].map((m) => ({ moduleId: m, permission: 15 })),
      'CEO': [1, 2, 3, 4, 5, 6].map((m) => ({ moduleId: m, permission: 15 })),
      'CFO': [
        { moduleId: 1, permission: 15 }, { moduleId: 2, permission: 7 },
        { moduleId: 3, permission: 15 }, { moduleId: 4, permission: 15 },
        { moduleId: 5, permission: 15 }, { moduleId: 6, permission: 15 },
      ],
      'HOD': [
        { moduleId: 1, permission: 7 }, { moduleId: 2, permission: 3 },
        { moduleId: 3, permission: 15 }, { moduleId: 4, permission: 15 },
        { moduleId: 5, permission: 7 }, { moduleId: 6, permission: 7 },
      ],
      'Procurement Manager': [
        { moduleId: 1, permission: 1 }, { moduleId: 3, permission: 15 },
        { moduleId: 4, permission: 15 }, { moduleId: 5, permission: 7 },
      ],
      'Procurement Manager Approver': [
        { moduleId: 1, permission: 1 }, { moduleId: 4, permission: 3 },
        { moduleId: 6, permission: 7 },
      ],
    };

    const allPermissions: { roleId: number; moduleId: number; permission: number }[] = [];
    for (const [roleName, perms] of Object.entries(permissionTemplates)) {
      const roleId = roleMap[roleName];
      if (roleId) {
        for (const p of perms) {
          allPermissions.push({ roleId, moduleId: p.moduleId, permission: p.permission });
        }
      }
    }
    await RolePermission.bulkCreate(allPermissions, { transaction });

    // Assign the Admin role to the registering user
    const adminRoleId = roleMap['Admin'];
    const userDataWithCompany = { ...userData, companyId: company.id, roleId: adminRoleId };

    const newUser = await repo.createUser(
      {
        ...userDataWithCompany,
        username,
        password: hashedPassword,
        userType: (userData.userType || 'admin') as 'super_admin' | 'admin' | 'procurement' | 'vendor',
        status: 'active',
      },
      transaction
    ) as User;

    const apiSecret = crypto.randomBytes(32).toString("hex");
    const payload: JWTPayload = {
      userId: newUser.id,
      userType: (userData.userType || 'admin') as string,
      companyId: userDataWithCompany.companyId,
    };
    const apiKey = await generateJWT(payload, apiSecret);
    await companyRepo.updateCompany(
      userDataWithCompany.companyId,
      {
        apiKey: apiKey.replace("Bearer ", ""),
        apiSecret,
      },
      transaction
    );

    await transaction.commit();
    return { user: newUser };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

/**
 * Refresh access token using refresh token
 * @param refreshTokenData - Refresh token string
 * @returns New access token
 * @throws CustomError if token invalid or expired
 */
export const refreshTokenService = async (refreshTokenData: string): Promise<{ accessToken: string }> => {
  const { error } = validateRefreshToken({ refreshToken: refreshTokenData });
  if (error) {
    throw new CustomError(error.details[0].message, 400);
  }

  const refreshToken = refreshTokenData;

  // Remove Bearer prefix if present
  const token = refreshToken.replace(/^Bearer\s+/i, "");

  // Verify refresh token
  let decoded: JWTPayload;
  try {
    decoded = await verifyJWT(token, jwt.refreshSecret) as JWTPayload;
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "jwt expired") {
      // Delete expired refresh token from database
      await repo.deleteRefreshToken(token);
      throw new CustomError("Refresh token expired. Please login again", 401);
    }
    throw new CustomError("Invalid refresh token", 401);
  }

  // Check if refresh token exists in database
  const storedToken = await repo.findRefreshToken(token);
  if (!storedToken) {
    throw new CustomError("Refresh token not found or revoked", 401);
  }

  // Get user to check if still exists and get role
  const user = await repo.findUser(decoded.userId) as User | null;
  if (!user) {
    await repo.deleteRefreshToken(token);
    throw new CustomError("User not found", 404);
  }

  // Generate new access token
  let payload: JWTPayload = {
    userId: user.id,
    userType: user.userType ?? 'procurement',
    companyId: user.companyId,
  };

  if (user.roleId) {
    const role = await getRoleService(user.roleId);
    payload = {
      userId: user.id,
      userType: user.userType ?? 'procurement',
      companyId: user.companyId,
      roleData: role,
    };
  }

  const newAccessToken = await generateJWT(payload, jwt.accessSecret, {
    expiresIn: jwt.accessExpiry as any,
  });

  return { accessToken: newAccessToken };
};

/**
 * Logout user by deleting all refresh tokens
 * @param userId - User ID
 * @returns Success message
 * @throws CustomError if user ID missing
 */
export const logoutService = async (userId: number | undefined): Promise<{ message: string }> => {
  if (!userId) {
    throw new CustomError("User ID is required", 400);
  }
  // Delete all refresh tokens for the user
  await repo.deleteAllUserRefreshTokens(userId);
  return { message: "Logged out successfully" };
};

/**
 * Validate access token and return user context (for service-to-service use)
 * Used by other backend services to verify tokens issued by this auth API
 * @param token - Access token (Bearer token or raw JWT)
 * @returns Decoded context with userId, userType, companyId, email
 * @throws CustomError if token invalid or expired
 */
export const validateTokenService = async (token: string): Promise<{
  userId: number;
  userType: string;
  companyId?: number;
  email?: string;
}> => {
  if (!token || typeof token !== 'string') {
    throw new CustomError('Token is required', 400);
  }
  try {
    const decoded = await verifyJWT(token, jwt.accessSecret);
    // logger.debug(decoded);
    if (decoded.userId) {
      const user = await repo.findUser(decoded.userId) as User | null;
      if (!user) {
        throw new CustomError('User not found', 404);
      }
      return {
        userId: user.id,
        userType: user.userType ?? 'customer',
        companyId: user.companyId,
        email: user.email,
      };
    }
    throw new CustomError('Invalid token', 401);
  } catch (error: unknown) {
    const err = error as Error;
    if (err.message === 'jwt expired') {
      throw new CustomError('Token expired. Please refresh your token', 401);
    }
    if (err.message === 'invalid signature' || err.message === 'jwt malformed') {
      throw new CustomError('Invalid token', 401);
    }
    throw new CustomError(err.message || 'Authentication failed', 401);
  }
};

/**
 * Change user password with current password verification
 * @param userData - Change password data including current and new password
 * @returns Update result
 * @throws CustomError if validation fails
 */
export const changePasswordService = async (userData: ChangePasswordData): Promise<[affectedCount: number]> => {
  const hashedPassword = await hash(userData.newPassword, 10);
  const user = await repo.findUser(userData.userId, true) as User | null;
  if (!user) {
    throw new CustomError("Email entered is invalid", 401);
  }
  if (!user.password) {
    throw new CustomError("Old password doesn't exist", 401);
  }
  const validateCurrentPassword = compareSync(
    userData.currentPassword,
    user.password
  );
  if (!validateCurrentPassword) {
    throw new CustomError("Current password entered is invalid", 401);
  }
  return repo.updatePassword(user.id, hashedPassword);
};

/**
 * Sign in user with email and password
 * @param userData - Sign in credentials
 * @returns User data with access and refresh tokens
 * @throws CustomError if validation fails or credentials invalid
 */
export const signInService = async (userData: SignInData): Promise<AuthResponse> => {
  const { error } = validateSignIn(userData);
  if (error) {
    throw new CustomError(error.details[0].message, 400);
  }

  const user = await repo.findUserByEmail(userData.email) as User | null;
  if (!user) {
    throw new CustomError("Email or password is invalid", 400);
  }

  if (!user.password) {
    throw new CustomError("Email or password is invalid", 400);
  }

  const validPassword = compareSync(userData.password, user.password);
  if (!validPassword) {
    throw new CustomError("Email or password is invalid", 400);
  }

  let payload: JWTPayload = {
    userId: user.id,
    userType: user.userType ?? 'procurement',
    companyId: user.companyId,
  };

  if (user.roleId) {
    const role = await getRoleService(user.roleId);
    payload = {
      userId: user.id,
      userType: user.userType ?? 'procurement',
      companyId: user.companyId,
      roleData: role,
    };
  }

  const accessToken = await generateJWT(payload, jwt.accessSecret, {
    expiresIn: jwt.accessExpiry as any,
  });

  const refreshToken = await generateJWT(payload, jwt.refreshSecret, {
    expiresIn: jwt.refreshExpiry as any,
  });

  // Store refresh token in database
  await repo.saveRefreshToken({
    user_id: user.id,
    token: refreshToken.replace("Bearer ", ""),
    email: user.email,
  });

  return { user, accessToken, refreshToken };
};
