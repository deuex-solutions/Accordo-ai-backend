import { Router, type Request, type Response, type NextFunction } from "express";
import { getUserService } from "../user/user.service.js";
import {
  createRoleService,
  getRolesService,
  deleteRoleService,
  updateRoleService,
  getRoleService,
} from "./role.service.js";
import {
  authMiddleware,
  checkPermission,
} from "../../middlewares/auth.middleware.js";
import { getParam } from "../../utils/types.js";

const roleRouter = Router();
const moduleId = 6;

// ============================================================================
// Endpoint Handlers & Routes
// ============================================================================

roleRouter.post(
  "/",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) => checkPermission(req, res, next, moduleId, 3),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userData = await getUserService(req.context.userId);
      const data = await createRoleService(req.body, userData);
      res.status(201).json({ message: "Role created successfully", data });
    } catch (error) { next(error); }
  }
);

roleRouter.get(
  "/",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) => checkPermission(req, res, next, moduleId, 1),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userData = await getUserService(req.context.userId);
      const data = await getRolesService(userData.companyId);
      res.status(201).json({ message: "Roles", data });
    } catch (error) { next(error); }
  }
);

roleRouter.get(
  "/:roleId",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) => checkPermission(req, res, next, moduleId, 1),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await getRoleService(getParam(req.params.roleId));
      res.status(201).json({ message: "Role", data });
    } catch (error) { next(error); }
  }
);

roleRouter.put(
  "/:roleId",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) => checkPermission(req, res, next, moduleId, 2),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await updateRoleService(getParam(req.params.roleId), req.body, req.context.userId);
      res.status(201).json({ message: "Role updated successfully", data });
    } catch (error) { next(error); }
  }
);

roleRouter.delete(
  "/:roleId",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) => checkPermission(req, res, next, moduleId, 3),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await deleteRoleService(getParam(req.params.roleId));
      res.status(201).json({ message: "Role deleted successfully", data });
    } catch (error) { next(error); }
  }
);

export default roleRouter;
