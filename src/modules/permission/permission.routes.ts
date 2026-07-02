import { Router, type Request, type Response, type NextFunction } from 'express';
import models from '../../models/index.js';
import type { RolePermission } from '../../models/auth/role-permission.js';
import { CustomError } from '../../utils/custom-error.js';
import userRepo from '../user/user.repo.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';

const permissionRouter = Router();

// ============================================================================
// Repository & Service Logic
// ============================================================================

export const getPermissionFromDb = async (roleId: number | null): Promise<RolePermission | null> => {
  if (!roleId) return null;
  return models.RolePermission.findOne({ where: { roleId } });
};

export const getPermissionService = async (userId: number): Promise<RolePermission | null> => {
  try {
    const user = await userRepo.getUserProfile(userId);
    if (!user) throw new CustomError('User not found', 404);
    return getPermissionFromDb(user.roleId);
  } catch (error) {
    throw new CustomError(`Service ${error}`, 400);
  }
};

// ============================================================================
// Route Handlers & Endpoints
// ============================================================================

permissionRouter.get('/get', authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await getPermissionService(req.context.userId);
    res.status(200).json({ message: 'Permission', data });
  } catch (error) {
    next(error);
  }
});

export default permissionRouter;
