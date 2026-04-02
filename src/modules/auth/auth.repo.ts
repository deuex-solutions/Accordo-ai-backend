import models from "../../models/index.js";
import { Op } from "sequelize";
import type { Transaction } from "sequelize";

/**
 * OTP data structure for verification
 */
interface OtpVerificationData {
  email: string;
  otp: number;
}

/**
 * Token data for refresh token storage
 */
interface TokenData {
  user_id: number;
  token: string;
  email: string;
}

/**
 * User data for creation
 */
interface UserData {
  email: string;
  name: string;
  username?: string;
  password: string;
  companyId?: number;
  roleId?: number;
  userType: 'super_admin' | 'admin' | 'procurement' | 'vendor';
  status: string;
  approvalLevel?: 'NONE' | 'L1' | 'L2' | 'L3';
  approvalLimit?: number | null;
}

const repo = {
  /**
   * Update user password
   * @param userId - User ID
   * @param password - Hashed password
   * @returns Update result
   */
  updatePassword: async (userId: number, password: string): Promise<[affectedCount: number]> => {
    return models.User.update(
      { password },
      {
        where: {
          id: userId,
        },
      }
    );
  },

  /**
   * Verify OTP for password reset
   * @param userData - Email and OTP data
   * @returns User with matching OTP or null
   */
  verifyOTP: async (userData: OtpVerificationData): Promise<unknown> => {
    return models.User.findOne({
      where: { email: userData.email },
      include: [
        {
          model: models.Otp,
          as: "Otps",
          where: {
            for: "forgot_password",
            otp: userData.otp,
            createdAt: { [Op.gt]: new Date(Date.now() - 3600000) },
          },
          order: [["createdAt", "DESC"]],
        },
      ],
    });
  },

  /**
   * Find user by ID
   * @param id - User ID
   * @param withPassword - Include password field in result
   * @returns User or null
   */
  findUser: async (id: number, withPassword: boolean = false): Promise<unknown> => {
    if (withPassword) {
      return models.User.scope("withPassword").findByPk(id);
    }
    return models.User.findByPk(id);
  },

  /**
   * Find user by email with role and permissions
   * @param email - User email
   * @returns User with role data or null
   */
  findUserByEmail: async (email: string): Promise<unknown> => {
    return models.User.scope("withPassword").findOne({
      where: { email },
      include: [
        {
          model: models.Role,
          as: "Role",
          required: false,
          attributes: ["name"],
          include: [
            {
              model: models.RolePermission,
              as: "RolePermission",
              required: false,
              attributes: ["moduleId", "permission"],
            },
          ],
        },
      ],
    });
  },

  /**
   * Create new user
   * @param userData - User data to create
   * @param transaction - Optional database transaction
   * @returns Created user
   */
  createUser: async (userData: UserData, transaction: Transaction | null = null): Promise<unknown> => {
    return models.User.create(userData, { transaction });
  },

  /**
   * Save refresh token for user (replaces existing tokens)
   * @param tokenData - Token data including user_id and token
   * @returns Created token record
   */
  saveRefreshToken: async (tokenData: TokenData): Promise<unknown> => {
    // Delete existing refresh tokens for this user
    await models.AuthToken.destroy({
      where: { user_id: tokenData.user_id },
    });
    // Create new refresh token
    return models.AuthToken.create(tokenData);
  },

  /**
   * Find refresh token in database
   * @param token - Refresh token string
   * @returns Token record or null
   */
  findRefreshToken: async (token: string): Promise<unknown> => {
    return models.AuthToken.findOne({
      where: { token },
    });
  },

  /**
   * Delete specific refresh token
   * @param token - Refresh token string
   * @returns Number of deleted records
   */
  deleteRefreshToken: async (token: string): Promise<number> => {
    return models.AuthToken.destroy({
      where: { token },
    });
  },

  /**
   * Delete all refresh tokens for a user
   * @param userId - User ID
   * @returns Number of deleted records
   */
  deleteAllUserRefreshTokens: async (userId: number): Promise<number> => {
    return models.AuthToken.destroy({
      where: { user_id: userId },
    });
  },
};

export default repo;
