import type { Request, Response, NextFunction } from "express";
import {
  getUserProfileService,
  createUserService,
  assignRoleService,
  getUserService,
  updateUserService,
  getAllUsersService,
  deleteUserService,
} from "./user.service.js";
import { getParam } from '../../types/index.js';

/**
 * Update user profile
 */
export const updateProfile = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userData = {
      ...req.body,
      userId: req.body.userId ?? req.context.userId,
    };

    if (req.files && Array.isArray(req.files) && req.files.length) {
      userData.profilePic = req.files[0].filename;
    }

    const data = await updateUserService(userData.userId, userData);
    res.status(201).json({ message: "Profile updated successfully", data });
  } catch (error) {
    next(error);
  }
};

/**
 * Get user profile from token
 */
export const getUserProfileController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authorization = req.headers.authorization;
    if (!authorization) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    const accessToken = authorization.split(" ")[1];
    const data = await getUserProfileService(accessToken);
    data.password = undefined;
    res.status(200).json({ message: "User data fetched", data });
  } catch (error) {
    next(error);
  }
};

/**
 * Assign a role to a user
 */
export const assignRole = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { userId, roleId } = req.body;
    const data = await assignRoleService(userId, roleId);
    res.status(200).json({ message: "Role assigned successfully", data });
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new user
 */
export const createUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userData = { ...req.body };
    if (req.files && Array.isArray(req.files) && req.files.length) {
      userData.profilePic = req.files[0].filename;
    }
    const data = await createUserService(userData, req.context.userId);
    res.status(201).json({ message: "User created successfully", data });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all users with pagination and filtering
 */
export const getAllUsers = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { search, page = 1, limit = 10, filters } = req.query;
    const data = await getAllUsersService(
      search as string | undefined,
      page as string | number,
      limit as string | number,
      req.context.userId,
      filters as string | undefined
    );
    res.status(200).json({ message: "User", ...data });
  } catch (error) {
    next(error);
  }
};

/**
 * Get a specific user by ID
 */
export const getUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const data = await getUserService(getParam(req.params.userId));
    res.status(201).json({ message: "User", data });
  } catch (error) {
    next(error);
  }
};

/**
 * Get user role permissions
 */
export const getUserRolePermission = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const data = await getUserService(getParam(req.params.userId));
    res.status(201).json({ message: "User Role Permission", data });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a user
 */
export const deleteUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const deletedCount = await deleteUserService(getParam(req.params.userId));
    if (deletedCount === 0) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    next(error);
  }
};
