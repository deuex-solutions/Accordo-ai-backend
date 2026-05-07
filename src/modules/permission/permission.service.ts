import repo from './permission.repo.js';
import { CustomError } from '../../utils/custom-error.js';
import userRepo from '../user/user.repo.js';
import type { RolePermission } from '../../models/role-permission.js';

export const getPermissionService = async (
  userId: number
): Promise<RolePermission | null> => {
  try {
    const user = await userRepo.getUserProfile(userId);
    if (!user) {
      throw new CustomError('User not found', 404);
    }
    return repo.getPermission(user.roleId);
  } catch (error) {
    throw new CustomError(`Service ${error}`, 400);
  }
};
