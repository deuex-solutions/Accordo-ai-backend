import type { PermissionLevel } from "../../utils/types.js";
import repo from "./role.repo.js";
import userRepo from "../user/user.repo.js";
import CustomError from "../../utils/custom-error.js";

/**
 * Interface for role creation data
 */
interface CreateRoleData {
  name: string;
  permissions?: PermissionLevel[];
}

/**
 * Interface for role table data
 */
interface RoleTableData {
  name: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: number;
  updatedBy: number;
  companyId: number;
  isArchived: boolean;
}

/**
 * Interface for role permission array item
 */
interface RolePermissionItem {
  roleId: number;
  moduleId: number;
  permission: PermissionLevel;
}

/**
 * Interface for user data
 */
interface UserData {
  id: number;
  companyId: number;
  [key: string]: unknown;
}

/**
 * Interface for created role response
 */
interface CreatedRole {
  id: number;
  [key: string]: unknown;
}

/**
 * Create permission array from role data
 */
const createPermissionArray = (
  roleData: CreateRoleData,
  createdRole: CreatedRole
): RolePermissionItem[] => {
  const roleId = createdRole.id;
  let count = 1;
  const permissionsArray: RolePermissionItem[] = [];
  for (const permission of roleData.permissions || []) {
    permissionsArray.push({
      roleId,
      moduleId: count,
      permission,
    });
    count += 1;
  }
  return permissionsArray;
};

/**
 * Create a new role with permissions
 */
export const createRoleService = async (
  roleData: CreateRoleData,
  userData: UserData
): Promise<CreatedRole> => {
  try {
    const roleTableData: RoleTableData = {
      name: roleData.name,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: userData.id,
      updatedBy: userData.id,
      companyId: userData.companyId,
      isArchived: false,
    };
    const createRoleResponse = await repo.createRole(roleTableData as any);
    const permissionsArray = createPermissionArray(roleData, createRoleResponse);
    if (permissionsArray.length) {
      await repo.createRolePermission(permissionsArray);
    }
    return createRoleResponse;
  } catch (error) {
    throw new CustomError(`Service ${error}`, 400);
  }
};

/**
 * Get all roles for a company
 */
export const getRolesService = async (companyId: number): Promise<unknown[]> => {
  try {
    return repo.getRoles(companyId);
  } catch (error) {
    throw new CustomError(`Service ${error}`, 400);
  }
};

/**
 * Get a single role by ID
 */
export const getRoleService = async (roleId: string | number): Promise<unknown> => {
  try {
    return repo.getRole(String(roleId));
  } catch (error) {
    throw new CustomError(`Service ${error}`, 400);
  }
};

/**
 * Update a role and its permissions
 */
export const updateRoleService = async (
  roleId: string,
  roleData: CreateRoleData,
  userId: number
): Promise<void> => {
  try {
    const roleTableData = {
      name: roleData.name,
      updatedAt: new Date(),
      updatedBy: userId,
    };
    const permissionsArray = createPermissionArray(roleData, { id: Number(roleId) });
    return repo.updateRole(roleId, roleTableData, permissionsArray);
  } catch (error) {
    throw new CustomError(`Service ${error}`, 400);
  }
};

/**
 * Delete (archive) a role
 */
export const deleteRoleService = async (roleId: string): Promise<unknown> => {
  try {
    return repo.deleteRole(roleId);
  } catch (error) {
    throw new CustomError(`Service ${error}`);
  }
};

/**
 * Check if a user has permission for a specific module and action
 */
export const checkPermissionService = async (
  userId: number,
  moduleId: number,
  permission: PermissionLevel
): Promise<boolean> => {
  if (moduleId > 6 || permission >= 4) {
    throw new CustomError(`Incorrect module name or permission`, 401);
  }

  const user = await userRepo.getUser(userId);
  if (!user?.Role) {
    return true;
  }

  const rolePermission = user.Role.RolePermission;
  if (!rolePermission) {
    throw new CustomError(`You don't have permission - P`, 401);
  }

  for (const rp of rolePermission) {
    if (rp.moduleId === moduleId) {
      if (rp.permission >= permission) {
        return true;
      }
      return false;
    }
  }

  throw new CustomError(`You don't have permission - R`, 401);
};
