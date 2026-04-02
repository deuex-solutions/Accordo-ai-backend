import crypto from "crypto";
import bcrypt from "bcrypt";
import { Op } from "sequelize";

import repo from "./user.repo.js";
import authRepo from "../auth/auth.repo.js";
import companyRepo from "../company/company.repo.js";
import CustomError from "../../utils/custom-error.js";
import { verifyJWT, generateJWT } from "../../middlewares/jwt.service.js";
import util from "../common/util.js";
import { validateCreateUser } from "./user.validator.js";
import env from "../../config/env.js";

/**
 * Interface for user data
 */
interface UserData {
  email: string;
  password: string;
  name?: string;
  profilePic?: string;
  companyId?: number;
  roleId?: number;
  userType?: 'super_admin' | 'admin' | 'procurement' | 'vendor';
  approvalLevel?: 'NONE' | 'L1' | 'L2' | 'L3';
  status?: string;
  [key: string]: unknown;
}

/**
 * Interface for update user data
 */
interface UpdateUserData {
  name?: string;
  email?: string;
  profilePic?: string;
  roleId?: number;
  userType?: 'super_admin' | 'admin' | 'procurement' | 'vendor';
  approvalLevel?: 'NONE' | 'L1' | 'L2' | 'L3';
  [key: string]: unknown;
}

/**
 * Interface for user profile response
 */
interface UserProfile {
  id: number;
  email: string;
  name: string;
  companyId?: number;
  password?: string;
  [key: string]: unknown;
}

/**
 * Interface for filter data
 */
interface FilterData {
  moduleName: string;
  filterBy: string;
  controlType: "inputText" | "rangeNumeric" | "rangeDate" | "checkbox";
  value: string | number[] | string[];
}

/**
 * Interface for query options
 */
interface QueryOptions {
  where: Record<string, unknown>;
  limit: number;
  offset: number;
  role?: string;
}

/**
 * Interface for paginated users response
 */
interface PaginatedUsersResponse {
  data: unknown[];
  total: number;
  page: number;
  totalPages: number;
}

/**
 * Get user profile from access token
 */
export const getUserProfileService = async (accessToken: string): Promise<UserProfile> => {
  try {
    if (!accessToken) {
      throw new CustomError("Access token is required", 400);
    }
    const decoded = await verifyJWT(accessToken, env.jwt.accessSecret);
    const user = await repo.getUserProfile(decoded.userId);
    if (!user) {
      throw new CustomError("User not found", 404);
    }
    return user;
  } catch (error) {
    throw new CustomError(`Service ${error}`, 400);
  }
};

/**
 * Assign a role to a user
 */
export const assignRoleService = async (
  userId: number,
  roleId: number
): Promise<[affectedCount: number]> => {
  try {
    return repo.assignRole(userId, roleId);
  } catch (error) {
    throw new CustomError(`Service ${error}`, 400);
  }
};

/**
 * Get all users with pagination, search, and filters
 */
export const getAllUsersService = async (
  search?: string,
  page: string | number = 1,
  limit: string | number = 10,
  userId?: number,
  filters?: string
): Promise<PaginatedUsersResponse> => {
  try {
    const parsedPage = Number.parseInt(String(page), 10) || 1;
    const parsedLimit = Number.parseInt(String(limit), 10) || 10;
    const offset = (parsedPage - 1) * parsedLimit;

    const user = userId ? await repo.getUser(userId) : null;
    const queryOptions: QueryOptions = {
      where: { companyId: user?.companyId },
      limit: parsedLimit,
      offset,
    };

    if (search) {
      // Multi-field OR search: Name, Email, Phone, Role (via include)
      queryOptions.where = {
        ...queryOptions.where,
        [Op.or]: [
          { name: { [Op.iLike]: `%${search}%` } },
          { email: { [Op.iLike]: `%${search}%` } },
          { phone: { [Op.iLike]: `%${search}%` } },
        ],
      };
      // Store search term for role name search in repo
      (queryOptions as any).searchTerm = search;
    }

    if (filters) {
      try {
        const filterData: FilterData[] = JSON.parse(decodeURIComponent(filters));
        queryOptions.where = {
          ...util.filterUtil(filterData),
          ...queryOptions.where,
        };
        const indexRole = filterData.findIndex((item) => item.filterBy === "role");
        if (indexRole !== -1) {
          queryOptions.role = String(filterData[indexRole].value);
        }
      } catch (error) {
        throw new CustomError("Invalid filters format", 400);
      }
    }

    const { rows, count } = await repo.getAllUsers(queryOptions as any);
    return {
      data: rows,
      total: count,
      page: parsedPage,
      totalPages: parsedLimit ? Math.ceil(count / parsedLimit) : 1,
    };
  } catch (error) {
    throw new CustomError(`Service ${error}`, 400);
  }
};

/**
 * Create a new user
 */
export const createUserService = async (
  userData: UserData,
  userId?: number
): Promise<unknown> => {
  try {
    const { error } = validateCreateUser(userData);
    if (error) {
      throw new CustomError(error.details[0].message, 400);
    }

    const existing = await authRepo.findUserByEmail(userData.email);
    if (existing) {
      throw new CustomError(`Email ${userData.email} already exists`, 409);
    }

    if (userId) {
      const user = await repo.getUser(userId);
      userData.companyId = user?.companyId;
    }

    userData.password = await bcrypt.hash(userData.password, 10);

    // Ensure required fields for createUser
    const userCreateData = {
      ...userData,
      name: userData.name || userData.email.split('@')[0],
      userType: (userData.userType || 'procurement') as 'super_admin' | 'admin' | 'procurement' | 'vendor',
      status: userData.status || 'active'
    };

    const createdUser = await authRepo.createUser(userCreateData) as any;

    const apiSecret = crypto.randomBytes(32).toString("hex");
    const payload = {
      userId: createdUser.id as number,
      companyId: userData.companyId,
    };
    const apiKey = await generateJWT(payload, apiSecret);
    await companyRepo.updateCompany(userData.companyId!, {
      apiKey: apiKey.replace(/^Bearer\s+/i, ""),
      apiSecret,
    });

    return createdUser;
  } catch (error) {
    throw new CustomError(String(error), 400);
  }
};

/**
 * Get a user by ID
 */
export const getUserService = async (userId: number | string): Promise<any> => {
  try {
    return repo.getUser(userId);
  } catch (error) {
    throw new CustomError(String(error), 400);
  }
};

/**
 * Update a user's information
 */
export const updateUserService = async (
  userId: number | string,
  userData: UpdateUserData
): Promise<[affectedCount: number]> => {
  try {
    // Check if user is protected and trying to change role
    if (userData.roleId !== undefined) {
      const user = await repo.getUser(userId);
      if (user?.isProtected) {
        throw new CustomError("Cannot modify role of a protected user", 403);
      }
    }
    return repo.updateUser(userId, userData);
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(`Service ${error}`, 400);
  }
};

/**
 * Delete a user by ID
 */
export const deleteUserService = async (userId: number | string): Promise<number> => {
  try {
    const user = await repo.getUser(userId);
    if (!user) {
      throw new CustomError("User not found", 404);
    }
    if (user.isProtected) {
      throw new CustomError("Cannot delete a protected super admin user", 403);
    }
    return repo.deleteUser(userId);
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(`Service ${error}`, 400);
  }
};
