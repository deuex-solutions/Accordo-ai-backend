/**
 * Vector Controller - HTTP request handlers for vector operations
 */

import { Request, Response, NextFunction } from 'express';
import * as vectorService from './vector.service.js';
import * as migrationJob from './migration.job.js';
import { embeddingClient } from './embedding.client.js';
import logger from '../../config/logger.js';
import { getParam } from '../../types/index.js';

/**
 * Search for similar messages
 * POST /api/vector/search/messages
 */
export async function searchMessages(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { query, topK, similarityThreshold, filters } = req.body;

    if (!query || typeof query !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Query string is required',
      });
      return;
    }

    const results = await vectorService.searchSimilarMessages(query, {
      topK: topK || 5,
      similarityThreshold: similarityThreshold || 0.7,
      filters: filters || {},
    });

    res.json({
      success: true,
      message: 'Search completed',
      data: {
        results,
        count: results.length,
      },
    });
  } catch (error) {
    logger.error('Error in searchMessages:', error);
    next(error);
  }
}

/**
 * Search for similar deals
 * POST /api/vector/search/deals
 */
export async function searchDeals(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { query, topK, similarityThreshold, filters } = req.body;

    if (!query || typeof query !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Query string is required',
      });
      return;
    }

    const results = await vectorService.searchSimilarDeals(query, {
      topK: topK || 5,
      similarityThreshold: similarityThreshold || 0.7,
      filters: filters || {},
    });

    res.json({
      success: true,
      message: 'Search completed',
      data: {
        results,
        count: results.length,
      },
    });
  } catch (error) {
    logger.error('Error in searchDeals:', error);
    next(error);
  }
}

/**
 * Search for patterns
 * POST /api/vector/search/patterns
 */
export async function searchPatterns(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { query, topK, similarityThreshold, patternType, scenario } = req.body;

    if (!query || typeof query !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Query string is required',
      });
      return;
    }

    const results = await vectorService.searchPatterns(query, {
      topK: topK || 5,
      similarityThreshold: similarityThreshold || 0.6,
      patternType,
      scenario,
    });

    res.json({
      success: true,
      message: 'Search completed',
      data: {
        results,
        count: results.length,
      },
    });
  } catch (error) {
    logger.error('Error in searchPatterns:', error);
    next(error);
  }
}

/**
 * Build AI context for a deal (RAG)
 * POST /api/vector/context/:dealId
 */
export async function buildContext(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dealId = getParam(req.params.dealId);
    const { message } = req.body;

    if (!message || typeof message !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Message string is required',
      });
      return;
    }

    const context = await vectorService.buildAIContext(dealId, message);

    res.json({
      success: true,
      message: 'Context built successfully',
      data: context,
    });
  } catch (error) {
    logger.error('Error in buildContext:', error);
    next(error);
  }
}

/**
 * Get RAG context for system prompt
 * POST /api/vector/rag/:dealId
 */
export async function getRAGContext(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dealId = getParam(req.params.dealId);
    const { message } = req.body;

    if (!message || typeof message !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Message string is required',
      });
      return;
    }

    const ragContext = await vectorService.buildRAGContext(dealId, message);

    res.json({
      success: true,
      message: 'RAG context retrieved',
      data: ragContext,
    });
  } catch (error) {
    logger.error('Error in getRAGContext:', error);
    next(error);
  }
}

/**
 * Manually trigger vectorization for a message
 * POST /api/vector/embed/message/:messageId
 */
export async function embedMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const messageId = getParam(req.params.messageId);

    // Import models here to avoid circular dependency
    const { ChatbotMessage, ChatbotDeal } = await import('../../models/index.js');

    const message = await ChatbotMessage.findByPk(messageId);
    if (!message) {
      res.status(404).json({
        success: false,
        message: 'Message not found',
      });
      return;
    }

    const deal = await ChatbotDeal.findByPk(message.dealId);
    if (!deal) {
      res.status(404).json({
        success: false,
        message: 'Deal not found',
      });
      return;
    }

    const result = await vectorService.vectorizeMessage(message, deal);

    res.json({
      success: result.success,
      message: result.success ? 'Message embedded successfully' : 'Failed to embed message',
      data: result,
    });
  } catch (error) {
    logger.error('Error in embedMessage:', error);
    next(error);
  }
}

/**
 * Manually trigger vectorization for a deal
 * POST /api/vector/embed/deal/:dealId
 */
export async function embedDeal(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dealId = getParam(req.params.dealId);

    const result = await vectorService.vectorizeDeal(dealId);

    res.json({
      success: result.success,
      message: result.success ? 'Deal embedded successfully' : 'Failed to embed deal',
      data: result,
    });
  } catch (error) {
    logger.error('Error in embedDeal:', error);
    next(error);
  }
}

/**
 * Get vector statistics
 * GET /api/vector/stats
 */
export async function getStats(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const stats = await vectorService.getVectorStats();

    res.json({
      success: true,
      message: 'Statistics retrieved',
      data: stats,
    });
  } catch (error) {
    logger.error('Error in getStats:', error);
    next(error);
  }
}

/**
 * Get embedding service health
 * GET /api/vector/health
 */
export async function getHealth(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const health = await embeddingClient.checkHealth();

    res.json({
      success: true,
      message: 'Health check completed',
      data: health,
    });
  } catch (error) {
    logger.error('Error in getHealth:', error);
    next(error);
  }
}

/**
 * Start historical data migration
 * POST /api/vector/migrate
 */
export async function startMigration(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { type = 'full', batchSize = 100 } = req.body;

    if (!['messages', 'deals', 'patterns', 'full'].includes(type)) {
      res.status(400).json({
        success: false,
        message: 'Invalid migration type. Must be: messages, deals, patterns, or full',
      });
      return;
    }

    // Start migration in background
    const migrationId = await migrationJob.startMigration(
      type as 'messages' | 'deals' | 'patterns' | 'full',
      batchSize
    );

    res.json({
      success: true,
      message: 'Migration started',
      data: { migrationId },
    });
  } catch (error) {
    logger.error('Error in startMigration:', error);
    next(error);
  }
}

/**
 * Get migration status
 * GET /api/vector/migrate/status
 */
export async function getMigrationStatus(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const status = await migrationJob.getMigrationStatus();

    res.json({
      success: true,
      message: 'Migration status retrieved',
      data: status,
    });
  } catch (error) {
    logger.error('Error in getMigrationStatus:', error);
    next(error);
  }
}

/**
 * Cancel ongoing migration
 * POST /api/vector/migrate/cancel
 */
export async function cancelMigration(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await migrationJob.cancelMigration();

    res.json({
      success: true,
      message: 'Migration cancelled',
    });
  } catch (error) {
    logger.error('Error in cancelMigration:', error);
    next(error);
  }
}

export default {
  searchMessages,
  searchDeals,
  searchPatterns,
  buildContext,
  getRAGContext,
  embedMessage,
  embedDeal,
  getStats,
  getHealth,
  startMigration,
  getMigrationStatus,
  cancelMigration,
};
