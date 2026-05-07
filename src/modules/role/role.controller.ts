import type { Request, Response, NextFunction } from "express";
import { getUserService } from "../user/user.service.js";
import {
  createRoleService,
  getRolesService,
  deleteRoleService,
  updateRoleService,
  getRoleService,
} from "./role.service.js";
import { getParam } from '../../types/index.js';

/**
 * Create a new role
 */
export const createRole = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userData = await getUserService(req.context.userId);
    const data = await createRoleService(req.body, userData);
    res.status(201).json({ message: "Role created successfully", data });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all roles for the user's company
 */
export const getAllRoles = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userData = await getUserService(req.context.userId);
    const data = await getRolesService(userData.companyId);
    res.status(201).json({ message: "Roles", data });
  } catch (error) {
    next(error);
  }
};

/**
 * Get a specific role by ID
 */
export const getRole = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const data = await getRoleService(getParam(req.params.roleId));
    res.status(201).json({ message: "Role", data });
  } catch (error) {
    next(error);
  }
};

/**
 * Update a role
 */
export const updateRole = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const data = await updateRoleService(getParam(req.params.roleId), req.body, req.context.userId);
    res.status(201).json({ message: "Role updated successfully", data });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete (archive) a role
 */
export const deleteRole = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const data = await deleteRoleService(getParam(req.params.roleId));
    res.status(201).json({ message: "Role deleted successfully", data });
  } catch (error) {
    next(error);
  }
};
