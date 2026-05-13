import { Router } from 'express';
import {
  createProject,
  getAllProjects,
  getProject,
  updateProject,
  deleteProject,
} from './project.controller.js';
import { authMiddleware, checkPermission } from '../../middlewares/auth.middleware.js';

const projectRouter = Router();
const moduleId = 1;

projectRouter.post(
  '/',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 3),
  createProject
);

projectRouter.get(
  '/',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  getAllProjects
);

projectRouter.get(
  '/:projectId',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  getProject
);

projectRouter.put(
  '/:projectId',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 2),
  updateProject
);

projectRouter.delete(
  '/:projectId',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 3),
  deleteProject
);

export default projectRouter;
