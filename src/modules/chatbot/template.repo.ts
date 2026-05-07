/**
 * Template Repository
 *
 * Data access layer for negotiation template CRUD operations.
 */

import { ChatbotTemplate } from '../../models/chatbot-template.js';
import { ChatbotTemplateParameter } from '../../models/chatbot-template-parameter.js';
import { CustomError } from '../../utils/custom-error.js';

export interface CreateTemplateData {
  name: string;
  description?: string | null;
  configJson?: object | null;
  isActive?: boolean;
}

export interface UpdateTemplateData {
  name?: string;
  description?: string | null;
  configJson?: object | null;
  isActive?: boolean;
}

export interface ListTemplatesOptions {
  isActive?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Create a new negotiation template
 */
export const createTemplate = async (
  data: CreateTemplateData
): Promise<ChatbotTemplate> => {
  try {
    const template = await ChatbotTemplate.create({
      name: data.name,
      description: data.description || null,
      configJson: data.configJson || null,
      isActive: data.isActive !== undefined ? data.isActive : true,
    });
    return template;
  } catch (error) {
    throw new CustomError(
      `Failed to create template: ${(error as Error).message}`,
      500
    );
  }
};

/**
 * Get a template by ID with optional parameters
 */
export const getTemplateById = async (
  id: string,
  includeParameters = false
): Promise<ChatbotTemplate | null> => {
  try {
    const include = includeParameters
      ? [
          {
            model: ChatbotTemplateParameter,
            as: 'Parameters',
          },
        ]
      : [];

    const template = await ChatbotTemplate.findByPk(id, { include });
    return template;
  } catch (error) {
    throw new CustomError(
      `Failed to get template: ${(error as Error).message}`,
      500
    );
  }
};

/**
 * List all templates with optional filters
 */
export const listTemplates = async (
  options: ListTemplatesOptions = {}
): Promise<{ templates: ChatbotTemplate[]; total: number }> => {
  try {
    const where: any = {};

    if (options.isActive !== undefined) {
      where.isActive = options.isActive;
    }

    const { count, rows } = await ChatbotTemplate.findAndCountAll({
      where,
      limit: options.limit,
      offset: options.offset,
      order: [['createdAt', 'DESC']],
    });

    return {
      templates: rows,
      total: count,
    };
  } catch (error) {
    throw new CustomError(
      `Failed to list templates: ${(error as Error).message}`,
      500
    );
  }
};

/**
 * Update a template by ID
 */
export const updateTemplate = async (
  id: string,
  data: UpdateTemplateData
): Promise<ChatbotTemplate> => {
  try {
    const template = await ChatbotTemplate.findByPk(id);

    if (!template) {
      throw new CustomError('Template not found', 404);
    }

    const updateData: any = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.configJson !== undefined) updateData.configJson = data.configJson;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    await template.update(updateData);
    return template;
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      `Failed to update template: ${(error as Error).message}`,
      500
    );
  }
};

/**
 * Delete a template by ID (soft delete by setting isActive = false)
 */
export const deleteTemplate = async (id: string): Promise<void> => {
  try {
    const template = await ChatbotTemplate.findByPk(id);

    if (!template) {
      throw new CustomError('Template not found', 404);
    }

    // Soft delete by setting isActive to false
    await template.update({ isActive: false });
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
export const permanentDeleteTemplate = async (id: string): Promise<void> => {
  try {
    const template = await ChatbotTemplate.findByPk(id);

    if (!template) {
      throw new CustomError('Template not found', 404);
    }

    // Check if template is in use by any deals
    // Import ChatbotDeal model to count deals using this template
    const { ChatbotDeal } = await import('../../models/index.js');
    const dealsCount = await ChatbotDeal.count({ where: { templateId: id } });

    if (dealsCount > 0) {
      throw new CustomError(
        `Cannot delete template: ${dealsCount} deal(s) are using this template`,
        400
      );
    }

    // Delete all associated parameters first
    await ChatbotTemplateParameter.destroy({
      where: { templateId: id },
    });

    // Hard delete the template
    await template.destroy();
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      `Failed to permanently delete template: ${(error as Error).message}`,
      500
    );
  }
};

/**
 * Get the default/active template
 */
export const getDefaultTemplate = async (): Promise<ChatbotTemplate | null> => {
  try {
    const template = await ChatbotTemplate.findOne({
      where: { isActive: true },
      order: [['createdAt', 'ASC']], // Get the oldest active template as default
    });
    return template;
  } catch (error) {
    throw new CustomError(
      `Failed to get default template: ${(error as Error).message}`,
      500
    );
  }
};

/**
 * Count templates with optional filters
 */
export const countTemplates = async (
  isActive?: boolean
): Promise<number> => {
  try {
    const where: any = {};

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const count = await ChatbotTemplate.count({ where });
    return count;
  } catch (error) {
    throw new CustomError(
      `Failed to count templates: ${(error as Error).message}`,
      500
    );
  }
};
