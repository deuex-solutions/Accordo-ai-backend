import { Op } from 'sequelize';
import models, { sequelize } from '../../models/index.js';
import userRepo from '../user/user.repo.js';
import CustomError from '../../utils/custom-error.js';

/**
 * Interface for query options
 */
interface QueryOptions {
  where?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  [key: string]: unknown;
}

/**
 * Interface for find and count result
 */
interface FindAndCountResult {
  rows: any[];
  count: number;
}

/**
 * Project repository with database operations
 */
const repo = {
  /**
   * Create a new project
   */
  createProject: async (projectData: Record<string, unknown>): Promise<any> => {
    return models.Project.create(projectData);
  },

  /**
   * Create a project point of contact
   */
  createProjectPoc: async (
    projectId: string | number,
    userId: number,
    contact: number
  ): Promise<any> => {
    return models.ProjectPoc.create({
      projectId: projectId as any,
      userId: contact,
      createdBy: userId,
    });
  },

  /**
   * Get a project by ID with its point of contacts
   */
  getProject: async (projectId: string): Promise<any> => {
    return models.Project.findByPk(projectId, {
      include: {
        model: models.ProjectPoc,
        as: 'ProjectPoc',
        include: [{
          model: models.User,
          as: 'User',
        }],
      },
    });
  },

  /**
   * Get all projects with filtering and pagination
   * Super Admin users (userType === 'super_admin') see all projects across companies
   */
  getProjects: async (
    queryOptions: QueryOptions = {},
    userId: number,
    searchTerm?: string
  ): Promise<FindAndCountResult> => {
    const user = await userRepo.getUserProfile(userId);

    // Super Admin users see all projects, other users only see their company's projects
    const isAdmin = user?.userType === 'super_admin';
    const companyFilter = (!isAdmin && user?.companyId) ? { companyId: user.companyId } : {};

    // Build include with optional POC name search
    const pocInclude: any = {
      model: models.ProjectPoc,
      as: 'ProjectPoc',
      include: {
        model: models.User,
        as: 'User',
      },
    };

    // If searching, add POC name search to include
    if (searchTerm) {
      pocInclude.include = {
        model: models.User,
        as: 'User',
        where: {
          name: { [Op.iLike]: `%${searchTerm}%` },
        },
        required: false,
      };
      pocInclude.required = false;
    }

    const options = {
      ...queryOptions,
      where: {
        ...(queryOptions.where || {}),
        ...companyFilter,
      },
      include: [pocInclude],
      distinct: true, // Ensures correct count when using includes
      subQuery: false, // Needed for proper OR search with includes
    };

    return models.Project.findAndCountAll(options as any);
  },

  /**
   * Delete a project and all related entities (cascading delete)
   */
  deleteProject: async (projectId: string): Promise<number> => {
    const transaction = await sequelize.transaction();
    try {
      const requisitions = await models.Requisition.findAll({
        where: { projectId },
        attributes: ['id'],
        transaction,
      });
      const requisitionIds = requisitions.map((req) => req.id);

      if (requisitionIds.length) {
        await models.RequisitionAttachment.destroy({
          where: { requisitionId: requisitionIds },
          transaction,
        });
        await models.RequisitionProduct.destroy({
          where: { requisitionId: requisitionIds },
          transaction,
        });
        await models.Contract.destroy({
          where: { requisitionId: requisitionIds },
          transaction,
        });
        await models.Requisition.destroy({
          where: { projectId },
          transaction,
        });
      }

      await models.ProjectPoc.destroy({ where: { projectId }, transaction });
      const result = await models.Project.destroy({ where: { id: projectId }, transaction });

      await transaction.commit();
      return result;
    } catch (error) {
      await transaction.rollback();
      const err = error as Error;
      throw new CustomError(err.message || String(error), 400);
    }
  },

  /**
   * Delete all point of contacts for a project
   */
  deleteProjectPoc: async (projectId: string): Promise<number> => {
    return models.ProjectPoc.destroy({ where: { projectId } });
  },

  /**
   * Update a project
   */
  updateProject: async (
    projectId: string,
    projectData: Record<string, unknown>
  ): Promise<[affectedCount: number]> => {
    return models.Project.update(projectData, { where: { id: projectId } });
  },
};

export default repo;
