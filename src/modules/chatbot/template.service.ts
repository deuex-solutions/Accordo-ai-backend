/**
 * Template Service
 *
 * Business logic layer for negotiation template management.
 */

import * as templateRepo from './template.repo.js';
import type { ChatbotTemplate } from '../../models/chatbot-template.js';
import { CustomError } from '../../utils/custom-error.js';

export interface CreateTemplateInput {
  name: string;
  description?: string;
  configJson?: object;
  isActive?: boolean;
}

export interface UpdateTemplateInput {
  name?: string;
  description?: string;
  configJson?: object;
  isActive?: boolean;
}

export interface ListTemplatesQuery {
  isActive?: boolean;
  page?: number;
  limit?: number;
}

export interface TemplateListResponse {
  templates: ChatbotTemplate[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Create a new negotiation template
 */
export const createTemplateService = async (
  input: CreateTemplateInput
): Promise<ChatbotTemplate> => {
  try {
    // Validate input
    if (!input.name || input.name.trim() === '') {
      throw new CustomError('Template name is required', 400);
    }

    // Check for duplicate names
    const existingTemplates = await templateRepo.listTemplates({
      isActive: true,
    });

    const duplicateName = existingTemplates.templates.find(
      (t) => t.name.toLowerCase() === input.name.trim().toLowerCase()
    );

    if (duplicateName) {
      throw new CustomError(
        `Template with name "${input.name}" already exists`,
        400
      );
    }

    // Create template
    const template = await templateRepo.createTemplate({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      configJson: input.configJson || null,
      isActive: input.isActive !== undefined ? input.isActive : true,
    });

    return template;
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      `Failed to create template: ${(error as Error).message}`,
      500
    );
  }
};

/**
 * Get a template by ID
 */
export const getTemplateService = async (
  id: string,
  includeParameters = false
): Promise<ChatbotTemplate> => {
  try {
    const template = await templateRepo.getTemplateById(id, includeParameters);

    if (!template) {
      throw new CustomError('Template not found', 404);
    }

    return template;
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      `Failed to get template: ${(error as Error).message}`,
      500
    );
  }
};

/**
 * List all templates with pagination
 */
export const listTemplatesService = async (
  query: ListTemplatesQuery = {}
): Promise<TemplateListResponse> => {
  try {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 10;
    const offset = (page - 1) * limit;

    const result = await templateRepo.listTemplates({
      isActive: query.isActive,
      limit,
      offset,
    });

    const totalPages = Math.ceil(result.total / limit);

    return {
      templates: result.templates,
      total: result.total,
      page,
      limit,
      totalPages,
    };
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      `Failed to list templates: ${(error as Error).message}`,
      500
    );
  }
};

/**
 * Update a template by ID
 */
export const updateTemplateService = async (
  id: string,
  input: UpdateTemplateInput
): Promise<ChatbotTemplate> => {
  try {
    // Check if template exists
    const existingTemplate = await templateRepo.getTemplateById(id);

    if (!existingTemplate) {
      throw new CustomError('Template not found', 404);
    }

    // If updating name, check for duplicates
    if (input.name && input.name.trim() !== '') {
      const allTemplates = await templateRepo.listTemplates({
        isActive: true,
      });

      const duplicateName = allTemplates.templates.find(
        (t) =>
          t.id !== id &&
          t.name.toLowerCase() === input.name!.trim().toLowerCase()
      );

      if (duplicateName) {
        throw new CustomError(
          `Template with name "${input.name}" already exists`,
          400
        );
      }
    }

    // Update template
    const updatedTemplate = await templateRepo.updateTemplate(id, {
      name: input.name?.trim(),
      description: input.description?.trim() || null,
      configJson: input.configJson,
      isActive: input.isActive,
    });

    return updatedTemplate;
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      `Failed to update template: ${(error as Error).message}`,
      500
    );
  }
};

/**
 * Delete a template by ID (soft delete)
 */
export const deleteTemplateService = async (id: string): Promise<void> => {
  try {
    // Check if template exists
    const template = await templateRepo.getTemplateById(id);

    if (!template) {
      throw new CustomError('Template not found', 404);
    }

    // Soft delete
    await templateRepo.deleteTemplate(id);
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      `Failed to delete template: ${(error as Error).message}`,
      500
    );
  }
};

/**
 * Permanently delete a template by ID
 */
export const permanentDeleteTemplateService = async (
  id: string
): Promise<void> => {
  try {
    await templateRepo.permanentDeleteTemplate(id);
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      `Failed to permanently delete template: ${(error as Error).message}`,
      500
    );
  }
};

/**
 * Get the default template
 */
export const getDefaultTemplateService = async (): Promise<ChatbotTemplate | null> => {
  try {
    const template = await templateRepo.getDefaultTemplate();
    return template;
  } catch (error) {
    throw new CustomError(
      `Failed to get default template: ${(error as Error).message}`,
      500
    );
  }
};

/**
 * Set a template as default (activate it and optionally deactivate others)
 */
export const setDefaultTemplateService = async (
  id: string,
  deactivateOthers = false
): Promise<ChatbotTemplate> => {
  try {
    // Check if template exists
    const template = await templateRepo.getTemplateById(id);

    if (!template) {
      throw new CustomError('Template not found', 404);
    }

    // If requested, deactivate all other templates
    if (deactivateOthers) {
      const allTemplates = await templateRepo.listTemplates({
        isActive: true,
      });

      for (const t of allTemplates.templates) {
        if (t.id !== id) {
          await templateRepo.updateTemplate(t.id, { isActive: false });
        }
      }
    }

    // Activate the target template
    const updatedTemplate = await templateRepo.updateTemplate(id, {
      isActive: true,
    });

    return updatedTemplate;
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      `Failed to set default template: ${(error as Error).message}`,
      500
    );
  }
};
