import { Router, type Request, type Response, type NextFunction } from "express";
import Joi from "joi";
import {
  getUserProfileService,
  createUserService,
  assignRoleService,
  getUserService,
  updateUserService,
  getAllUsersService,
  deleteUserService,
} from "./user.service.js";
import {
  authMiddleware,
  checkPermission,
} from "../../middlewares/auth.middleware.js";
import { upload } from "../../middlewares/upload.middleware.js";
import { cleanJson } from "../../middlewares/clean.middleware.js";
import { getParam } from "../../utils/types.js";

const userRouter = Router();
const moduleId = 2;

// ============================================================================
// Validators
// ============================================================================

const options = { errors: { wrap: { label: "" } } };

export const validateCreateUser = (userData: Record<string, unknown>) => {
  const schema = Joi.object({
    email: Joi.string().email().required().messages({
      "string.email": "Email format is invalid",
      "any.required": "Email is required",
    }),
  }).unknown(true);
  return schema.validate(userData, options);
};

// ============================================================================
// Endpoint Handlers & Routes
// ============================================================================

userRouter.get("/profile", authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authorization = req.headers.authorization;
    if (!authorization) { res.status(404).json({ message: "User not found" }); return; }
    const accessToken = authorization.split(" ")[1];
    const data = await getUserProfileService(accessToken);
    data.password = undefined;
    res.status(200).json({ message: "User data fetched", data });
  } catch (error) { next(error); }
});

userRouter.post(
  "/",
  authMiddleware,
  upload.any(),
  cleanJson,
  (req: Request, res: Response, next: NextFunction) => checkPermission(req, res, next, moduleId, 3),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userData = { ...req.body };
      if (req.files && Array.isArray(req.files) && req.files.length) {
        userData.profilePic = req.files[0].filename;
      }
      const data = await createUserService(userData, req.context.userId);
      res.status(201).json({ message: "User created successfully", data });
    } catch (error) { next(error); }
  }
);

userRouter.post(
  "/update-profile",
  authMiddleware,
  upload.any(),
  cleanJson,
  (req: Request, res: Response, next: NextFunction) => checkPermission(req, res, next, moduleId, 2),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userData = { ...req.body, userId: req.body.userId ?? req.context.userId };
      if (req.files && Array.isArray(req.files) && req.files.length) {
        userData.profilePic = req.files[0].filename;
      }
      const data = await updateUserService(userData.userId, userData);
      res.status(201).json({ message: "Profile updated successfully", data });
    } catch (error) { next(error); }
  }
);

userRouter.get(
  "/",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) => checkPermission(req, res, next, moduleId, 1),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { search, page = 1, limit = 10, filters } = req.query;
      const data = await getAllUsersService(search as string | undefined, page as string | number, limit as string | number, req.context.userId, filters as string | undefined);
      res.status(200).json({ message: "User", ...data });
    } catch (error) { next(error); }
  }
);

userRouter.get(
  "/:userId",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) => checkPermission(req, res, next, moduleId, 1),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await getUserService(getParam(req.params.userId));
      res.status(201).json({ message: "User", data });
    } catch (error) { next(error); }
  }
);

userRouter.delete(
  "/:userId",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) => checkPermission(req, res, next, moduleId, 4),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const deletedCount = await deleteUserService(getParam(req.params.userId));
      if (deletedCount === 0) { res.status(404).json({ message: "User not found" }); return; }
      res.status(200).json({ message: "User deleted successfully" });
    } catch (error) { next(error); }
  }
);

export default userRouter;
