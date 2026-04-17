import { Request, Response, NextFunction } from 'express';
import {
  createProjectService,
  deleteProjectService,
  getProjectsService,
  getProjectService,
  updateProjectService,
} from './project.service.js';
import { getParam } from '../../types/index.js';

/**
 * Create a new project
 */
export const createProject = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { pointOfContact = [] } = req.body;
    const data = await createProjectService(req.context.userId, pointOfContact, req.body);
    res.status(201).json({ message: 'Project created successfully', data });
  } catch (error) {
    next(error);
  }
};

/**
 * Get a single project by ID
 */
export const getProject = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const data = await getProjectService(getParam(req.params.projectId));
    res.status(201).json({ message: 'Project', data });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all projects with pagination and filtering
 */
export const getAllProjects = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
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
  } catch (error) {
    next(error);
  }
};

/**
 * Update an existing project
 */
export const updateProject = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { pointOfContact = [] } = req.body;
    const data = await updateProjectService(
      getParam(req.params.projectId),
      req.context.userId,
      req.body,
      pointOfContact
    );
    res.status(201).json({ message: 'Project updated successfully', data });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a project (cascades to related entities)
 */
export const deleteProject = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const data = await deleteProjectService(getParam(req.params.projectId));
    res.status(201).json({ message: 'Project deleted successfully', data });
  } catch (error) {
    next(error);
  }
};
