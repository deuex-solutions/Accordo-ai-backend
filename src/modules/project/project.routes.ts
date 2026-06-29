import { Router, type Request, type Response, type NextFunction } from 'express';
import Joi from 'joi';
import {
  createProjectService,
  deleteProjectService,
  getProjectsService,
  getProjectService,
  updateProjectService,
} from './project.service.js';
import { authMiddleware, checkPermission } from '../../middlewares/auth.middleware.js';
import { getParam } from '../../utils/types.js';

const projectRouter = Router();
const moduleId = 1;

// ============================================================================
// Validators & Schemas
// ============================================================================

export const createProjectSchema = Joi.object({
  projectName: Joi.string().required().min(1).max(255),
  description: Joi.string().allow('', null).optional(),
  startDate: Joi.date().optional(),
  endDate: Joi.date().optional(),
  budget: Joi.number().positive().optional(),
  status: Joi.string().optional(),
  pointOfContact: Joi.array().items(Joi.number().integer()).optional(),
});

export const updateProjectSchema = Joi.object({
  projectName: Joi.string().min(1).max(255).optional(),
  description: Joi.string().allow('', null).optional(),
  startDate: Joi.date().optional(),
  endDate: Joi.date().optional(),
  budget: Joi.number().positive().optional(),
  status: Joi.string().optional(),
  pointOfContact: Joi.array().items(Joi.number().integer()).optional(),
});

export const projectIdSchema = Joi.object({
  projectid: Joi.string().required(),
});

// ============================================================================
// Route Handlers & Endpoints
// ============================================================================

projectRouter.post(
  '/',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 3),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { pointOfContact = [] } = req.body;
      const data = await createProjectService(req.context.userId, pointOfContact, req.body);
      res.status(201).json({ message: 'Project created successfully', data });
    } catch (error) { next(error); }
  }
);

projectRouter.get(
  '/',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { search, page = 1, limit = 10, filters } = req.query;
      const data = await getProjectsService(
        search as string | undefined,
        page as string | number,
        limit as string | number,
        req.context.userId,
        filters as string | undefined
      );
      res.status(201).json({ message: 'Projects', ...data });
    } catch (error) { next(error); }
  }
);

projectRouter.get(
  '/:projectId',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await getProjectService(getParam(req.params.projectId));
      res.status(201).json({ message: 'Project', data });
    } catch (error) { next(error); }
  }
);

projectRouter.put(
  '/:projectId',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 2),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { pointOfContact = [] } = req.body;
      const data = await updateProjectService(getParam(req.params.projectId), req.context.userId, req.body, pointOfContact);
      res.status(201).json({ message: 'Project updated successfully', data });
    } catch (error) { next(error); }
  }
);

projectRouter.delete(
  '/:projectId',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 3),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await deleteProjectService(getParam(req.params.projectId));
      res.status(201).json({ message: 'Project deleted successfully', data });
    } catch (error) { next(error); }
  }
);

export default projectRouter;
