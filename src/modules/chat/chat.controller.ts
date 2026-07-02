import { Request, Response, NextFunction } from 'express';
import { chatService } from './chat.service.js';
import models from '../../models/index.js';
import { getParam } from '../../types/index.js';

export const sendMessage = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { message, negotiationId, requisitionId } = req.body;
    const userId = req.context?.userId || req.user?.id;

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated. Please log in to use chat.' });
      return;
    }

    const response = await chatService.sendMessage(userId, message, negotiationId, requisitionId);
    res.status(200).json({ data: response });
  } catch (error) {
    next(error);
  }
};

export const sendMessageStream = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { message, negotiationId, requisitionId } = req.body;
    const userId = req.context?.userId || req.user?.id;

    if (!userId) {
      res.write(`data: ${JSON.stringify({ error: 'User not authenticated. Please log in to use chat.' })}\n\n`);
      res.end();
      return;
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let fullResponse = '';

    await chatService.sendMessageStream(
      userId,
      message,
      negotiationId,
      requisitionId,
      (chunk) => {
        fullResponse += chunk;
        res.write(`data: ${JSON.stringify({ chunk, done: false })}\n\n`);
      }
    );

    res.write(`data: ${JSON.stringify({ chunk: '', done: true, fullResponse })}\n\n`);
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: (error as Error).message })}\n\n`);
    res.end();
  }
};

export const checkLLMHealth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const llmService = (await import('../../services/llm.service.js')).default;
    const health = await llmService.checkHealth();
    res.status(200).json({ data: health });
  } catch (error) {
    next(error);
  }
};

export const getSessions = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { negotiationId } = req.query;
    const userId = req.context?.userId || req.user?.id;

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const sessions = await chatService.getSessions(
      userId,
      negotiationId ? Number(negotiationId) : null
    );
    res.status(200).json({ data: sessions });
  } catch (error) {
    next(error);
  }
};

export const getSession = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const sessionId = getParam(req.params.sessionId);
    const userId = req.context?.userId || req.user?.id;

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const session = await chatService.getSession(sessionId, userId);
    res.status(200).json({ data: session });
  } catch (error) {
    next(error);
  }
};

/**
 * Test endpoint to verify database connectivity and context fetching
 */
export const testDatabaseConnection = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { negotiationId, requisitionId } = req.query;
    const userId = req.context?.userId || req.user?.id;

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const contextService = (await import('../../services/context.service.js')).default;

    const testResults: any = {
      userId,
      databaseConnected: true,
      userExists: false,
      contextData: null,
      availableData: {},
    };

    // Test 1: Check if user exists
    const user = await models.User.findByPk(userId);
    if (user) {
      testResults.userExists = true;
      testResults.availableData.user = {
        id: user.id,
        name: user.name,
        email: user.email,
        companyId: user.companyId,
      };
    }

    // Test 2: Check user's company
    if (user?.companyId) {
      const company = await models.Company.findByPk(user.companyId);
      if (company) {
        testResults.availableData.company = {
          id: company.id,
          name: company.companyName,
        };
      }
    }

    // Test 3: Fetch context if negotiationId or requisitionId provided
    if (negotiationId) {
      const context = await contextService.getNegotiationContext(negotiationId as any);
      testResults.contextData = {
        type: 'negotiation',
        negotiationId,
        data: context,
      };
    } else if (requisitionId) {
      const context = await contextService.getRequisitionContext(Number(requisitionId));
      testResults.contextData = {
        type: 'requisition',
        requisitionId,
        data: context,
      };
    }

    // Test 4: Get user preferences
    const preferences = await contextService.getUserPreferences(userId);
    if (preferences) {
      testResults.availableData.preferences = preferences;
    }

    // Test 5: List available requisitions for the user
    const requisitions = await models.Requisition.findAll({
      where: { createdBy: userId },
      limit: 5,
      attributes: ['id', 'rfqId', 'subject', 'status', 'totalPrice'],
      order: [['createdAt', 'DESC']],
    });
    if (requisitions.length > 0) {
      testResults.availableData.requisitions = requisitions.map((r) => ({
        id: r.id,
        rfqId: r.rfqId,
        subject: r.subject,
        status: r.status,
        totalPrice: r.minTotalPrice,
      }));
    }

    res.status(200).json({
      message: 'Database connection test successful',
      data: testResults,
    });
  } catch (error) {
    next(error);
  }
};
