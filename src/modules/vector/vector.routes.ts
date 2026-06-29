import { Router, type Request, type Response, type NextFunction } from 'express';
import * as vectorService from './vector.service.js';
import * as migrationJob from './migration.job.js';
import { embeddingClient } from './embedding.client.js';
import logger from '../../config/logger.js';
import { getParam } from '../../utils/types.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';

const vectorRouter = Router();

// Health check (public)
vectorRouter.get('/health', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const health = await embeddingClient.checkHealth();
    res.json({ success: true, message: 'Health check completed', data: health });
  } catch (error) { logger.error('Error in getHealth:', error); next(error); }
});

// Secured vector routes
vectorRouter.post('/search/messages', authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { query, topK, similarityThreshold, filters } = req.body;
    if (!query || typeof query !== 'string') { res.status(400).json({ success: false, message: 'Query string is required' }); return; }
    const results = await vectorService.searchSimilarMessages(query, { topK: topK || 5, similarityThreshold: similarityThreshold || 0.7, filters: filters || {} });
    res.json({ success: true, message: 'Search completed', data: { results, count: results.length } });
  } catch (error) { logger.error('Error in searchMessages:', error); next(error); }
});

vectorRouter.post('/search/deals', authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { query, topK, similarityThreshold, filters } = req.body;
    if (!query || typeof query !== 'string') { res.status(400).json({ success: false, message: 'Query string is required' }); return; }
    const results = await vectorService.searchSimilarDeals(query, { topK: topK || 5, similarityThreshold: similarityThreshold || 0.7, filters: filters || {} });
    res.json({ success: true, message: 'Search completed', data: { results, count: results.length } });
  } catch (error) { logger.error('Error in searchDeals:', error); next(error); }
});

vectorRouter.post('/search/patterns', authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { query, topK, similarityThreshold, patternType, scenario } = req.body;
    if (!query || typeof query !== 'string') { res.status(400).json({ success: false, message: 'Query string is required' }); return; }
    const results = await vectorService.searchPatterns(query, { topK: topK || 5, similarityThreshold: similarityThreshold || 0.6, patternType, scenario });
    res.json({ success: true, message: 'Search completed', data: { results, count: results.length } });
  } catch (error) { logger.error('Error in searchPatterns:', error); next(error); }
});

vectorRouter.post('/context/:dealId', authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const { message } = req.body;
    if (!message || typeof message !== 'string') { res.status(400).json({ success: false, message: 'Message string is required' }); return; }
    const context = await vectorService.buildAIContext(dealId, message);
    res.json({ success: true, message: 'Context built successfully', data: context });
  } catch (error) { logger.error('Error in buildContext:', error); next(error); }
});

vectorRouter.post('/rag/:dealId', authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const { message } = req.body;
    if (!message || typeof message !== 'string') { res.status(400).json({ success: false, message: 'Message string is required' }); return; }
    const ragContext = await vectorService.buildRAGContext(dealId, message);
    res.json({ success: true, message: 'RAG context retrieved', data: ragContext });
  } catch (error) { logger.error('Error in getRAGContext:', error); next(error); }
});

vectorRouter.post('/embed/message/:messageId', authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const messageId = getParam(req.params.messageId);
    const { ChatbotMessage, ChatbotDeal } = await import('../../models/index.js');
    const message = await ChatbotMessage.findByPk(messageId);
    if (!message) { res.status(404).json({ success: false, message: 'Message not found' }); return; }
    const deal = await ChatbotDeal.findByPk(message.dealId);
    if (!deal) { res.status(404).json({ success: false, message: 'Deal not found' }); return; }
    const result = await vectorService.vectorizeMessage(message, deal);
    res.json({ success: result.success, message: result.success ? 'Message embedded successfully' : 'Failed to embed message', data: result });
  } catch (error) { logger.error('Error in embedMessage:', error); next(error); }
});

vectorRouter.post('/embed/deal/:dealId', authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const result = await vectorService.vectorizeDeal(dealId);
    res.json({ success: result.success, message: result.success ? 'Deal embedded successfully' : 'Failed to embed deal', data: result });
  } catch (error) { logger.error('Error in embedDeal:', error); next(error); }
});

vectorRouter.get('/stats', authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const stats = await vectorService.getVectorStats();
    res.json({ success: true, message: 'Statistics retrieved', data: stats });
  } catch (error) { logger.error('Error in getStats:', error); next(error); }
});

// Migration jobs
vectorRouter.post('/migrate', authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { type = 'full', batchSize = 100 } = req.body;
    if (!['messages', 'deals', 'patterns', 'full'].includes(type)) {
      res.status(400).json({ success: false, message: 'Invalid migration type. Must be: messages, deals, patterns, or full' });
      return;
    }
    const migrationId = await migrationJob.startMigration(type as any, batchSize);
    res.json({ success: true, message: 'Migration started', data: { migrationId } });
  } catch (error) { logger.error('Error in startMigration:', error); next(error); }
});

vectorRouter.get('/migrate/status', authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const status = await migrationJob.getMigrationStatus();
    res.json({ success: true, message: 'Migration status retrieved', data: status });
  } catch (error) { logger.error('Error in getMigrationStatus:', error); next(error); }
});

vectorRouter.post('/migrate/cancel', authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await migrationJob.cancelMigration();
    res.json({ success: true, message: 'Migration cancelled' });
  } catch (error) { logger.error('Error in cancelMigration:', error); next(error); }
});

export default vectorRouter;
