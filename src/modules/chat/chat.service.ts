import models from '../../models/index.js';
import llmService from '../../services/llm.service.js';
import contextService from '../../services/context.service.js';
import logger from '../../config/logger.js';
import type { ChatSession } from '../../models/chat-session.js';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ExtractedParams {
  batna?: number;
  maxDiscount?: number;
  maxPrice?: number;
}

interface SendMessageResponse {
  message: string;
  history: ChatMessage[];
  sessionId: string;
  contextUsed: boolean;
  contextData: any;
}

interface SessionResponse {
  sessions: any[];
}

interface GetSessionResponse {
  id: string;
  negotiationId: string | null;
  userId: number | null;
  history: any[];
  context: any;
  createdAt: Date;
  updatedAt: Date;
  negotiation: any;
}

/**
 * Extract BATNA and max discount/price from user message
 */
const extractNegotiationParameters = (message: string): ExtractedParams | null => {
  const extracted: ExtractedParams = {};

  // Extract BATNA (Best Alternative To a Negotiated Agreement)
  const batnaPatterns = [
    /batna[:\s]+([$₹€£]?[\d,]+\.?\d*)/i,
    /best alternative[:\s]+([$₹€£]?[\d,]+\.?\d*)/i,
    /alternative option[:\s]+([$₹€£]?[\d,]+\.?\d*)/i,
    /fallback[:\s]+([$₹€£]?[\d,]+\.?\d*)/i,
  ];

  for (const pattern of batnaPatterns) {
    const match = message.match(pattern);
    if (match) {
      const value = Number.parseFloat(match[1].replace(/[,$₹€£]/g, ''));
      if (!Number.isNaN(value)) {
        extracted.batna = value;
        break;
      }
    }
  }

  // Extract maximum discount percentage
  const maxDiscountPatterns = [
    /max(?:imum)?\s*discount[:\s]+(\d+\.?\d*)\s*%/i,
    /maximum\s*discount[:\s]+(\d+\.?\d*)\s*%/i,
    /discount[:\s]+(\d+\.?\d*)\s*%/i,
    /up to\s*(\d+\.?\d*)\s*%\s*discount/i,
  ];

  for (const pattern of maxDiscountPatterns) {
    const match = message.match(pattern);
    if (match) {
      const value = Number.parseFloat(match[1]);
      if (!Number.isNaN(value) && value >= 0 && value <= 100) {
        extracted.maxDiscount = value;
        break;
      }
    }
  }

  // Extract maximum total price
  const maxPricePatterns = [
    /max(?:imum)?\s*(?:total\s*)?price[:\s]+([$₹€£]?[\d,]+\.?\d*)/i,
    /maximum\s*(?:total\s*)?price[:\s]+([$₹€£]?[\d,]+\.?\d*)/i,
    /not more than[:\s]+([$₹€£]?[\d,]+\.?\d*)/i,
    /max budget[:\s]+([$₹€£]?[\d,]+\.?\d*)/i,
    /budget limit[:\s]+([$₹€£]?[\d,]+\.?\d*)/i,
  ];

  for (const pattern of maxPricePatterns) {
    const match = message.match(pattern);
    if (match) {
      const value = Number.parseFloat(match[1].replace(/[,$₹€£]/g, ''));
      if (!Number.isNaN(value) && value > 0) {
        extracted.maxPrice = value;
        break;
      }
    }
  }

  return Object.keys(extracted).length > 0 ? extracted : null;
};

export const chatService = {
  /**
   * Send a message using local LLM with backend context
   */
  sendMessage: async (
    userId: number,
    message: string,
    negotiationId: string | number | null = null,
    requisitionId: number | null = null
  ): Promise<SendMessageResponse> => {
    // 1. Get or Create Chat Session
    let session: ChatSession | null;
    if (negotiationId) {
      session = await models.ChatSession.findOne({
        where: { negotiationId, userId },
      });
    } else {
      // For general chat, find the most recent session without negotiationId
      session = await models.ChatSession.findOne({
        where: {
          userId,
          negotiationId: null,
        },
        order: [['updatedAt', 'DESC']],
      });
    }

    if (!session) {
      const sessionData: any = {
        userId,
        negotiationId: typeof negotiationId === 'number' ? String(negotiationId) : negotiationId,
        history: [],
      };
      session = await models.ChatSession.create(sessionData);
    }

    // 2. Fetch backend context
    let contextData: any = null;
    let contextString = '';

    try {
      if (negotiationId) {
        contextData = await contextService.getNegotiationContext(typeof negotiationId === 'string' ? negotiationId : String(negotiationId));
      } else if (requisitionId) {
        const requisitionContext = await contextService.getRequisitionContext(requisitionId);
        if (requisitionContext) {
          contextData = {
            requisition: requisitionContext,
          };
        }
      }

      // Get user preferences
      const preferences = await contextService.getUserPreferences(userId);
      if (preferences) {
        contextData = { ...contextData, preferences };
      }

      if (contextData) {
        contextString = contextService.buildContextString(contextData);
      }
    } catch (error) {
      logger.warn('Failed to fetch context:', (error as Error).message);
      // Continue without context if fetch fails
    }

    // 3. Append User Message to History
    const history: ChatMessage[] = (session.history as ChatMessage[]) || [];
    history.push({ role: 'user', content: message });

    // 4. Prepare System Prompt with Context
    const systemPrompt = `You are Accordo, an expert negotiation AI agent representing the Buyer.
Your primary objective is to discuss the FIRST quotation with the user and negotiate the best possible deal.

CRITICAL GUIDELINES:
- You are discussing the FIRST quotation received from a vendor
- Your goal is to negotiate the vendor down to the best possible price
- DO NOT reveal internal negotiation parameters (BATNA, maximum discount, maximum price) to the user
- DO NOT mention that you have information about other vendors' offers directly
- You can use competitive pressure subtly: "We're evaluating multiple options" or "We've received competitive offers"
- Focus on discussing the current quotation's terms, price, delivery, and payment terms
- Help the user understand the quotation and negotiate improvements
- Be professional, helpful, and maintain a constructive relationship with the vendor
- Use the context information (including cheapest offers from other vendors) to guide your negotiation strategy internally
- If the user asks about alternatives, you can mention you're evaluating multiple vendors, but don't reveal specific prices

${contextString}

Remember: Keep internal negotiation parameters (BATNA, max discount, max price, cheapest offers) CONFIDENTIAL. Use them to guide your strategy but never reveal them to the user.`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((msg) => ({ role: msg.role, content: msg.content })),
    ];

    // 5. Call Local LLM (Ollama)
    try {
      // Check if LLM is available
      const healthCheck = await llmService.checkHealth();
      if (!healthCheck.available) {
        throw new Error(
          `Local LLM not available: ${healthCheck.error || 'Model not found'}. ` +
            `Please ensure Ollama is running and the model is installed.`
        );
      }

      const aiResponse = await llmService.chatCompletion(messages as any, {
        temperature: 0.7,
      });

      // 6. Save AI Response to History
      history.push({ role: 'assistant', content: aiResponse });

      // Update session with new history
      await session.update({ history: [...history] as any });

      return {
        message: aiResponse,
        history: history,
        sessionId: session.id,
        contextUsed: !!contextData,
        contextData: contextData || null,
      };
    } catch (error) {
      logger.error('LLM Error:', error);
      throw new Error(`Failed to generate response: ${(error as Error).message}`);
    }
  },

  /**
   * Stream a message response (for real-time chat)
   */
  sendMessageStream: async (
    userId: number,
    message: string,
    negotiationId: string | number | null = null,
    requisitionId: number | null = null,
    onChunk: ((chunk: string) => void) | null = null
  ): Promise<SendMessageResponse> => {
    // Similar to sendMessage but uses streaming
    let session: ChatSession | null;
    if (negotiationId) {
      session = await models.ChatSession.findOne({
        where: { negotiationId, userId },
      });
    } else {
      session = await models.ChatSession.findOne({
        where: {
          userId,
          negotiationId: null,
        },
        order: [['updatedAt', 'DESC']],
      });
    }

    if (!session) {
      const sessionData: any = {
        userId,
        negotiationId: typeof negotiationId === 'number' ? String(negotiationId) : negotiationId,
        history: [],
      };
      session = await models.ChatSession.create(sessionData);
    }

    // Fetch context (same as above)
    let contextData: any = null;
    let contextString = '';

    try {
      if (negotiationId) {
        contextData = await contextService.getNegotiationContext(typeof negotiationId === 'string' ? negotiationId : String(negotiationId));
      } else if (requisitionId) {
        const requisitionContext = await contextService.getRequisitionContext(requisitionId);
        if (requisitionContext) {
          contextData = {
            requisition: requisitionContext,
          };
        }
      }

      const preferences = await contextService.getUserPreferences(userId);
      if (preferences) {
        contextData = { ...contextData, preferences };
      }

      if (contextData) {
        contextString = contextService.buildContextString(contextData);
      }
    } catch (error) {
      logger.warn('Failed to fetch context:', (error as Error).message);
    }

    // Extract and store negotiation parameters from user message
    const extractedParams = extractNegotiationParameters(message);
    if (extractedParams) {
      try {
        const preferences = await contextService.getUserPreferences(userId);
        const entityId = userId;
        const entityType = 'User';
        const context = requisitionId ? `requisition_${requisitionId}` : 'global';

        const updatedConstraints = {
          ...((preferences as any)?.constraints || {}),
          ...extractedParams,
        };

        const existing = await models.Preference.findOne({
          where: {
            entityId,
            entityType,
            context,
          },
        });

        if (existing) {
          await existing.update({
            constraints: updatedConstraints,
          });
        } else {
          await models.Preference.create({
            entityId,
            entityType,
            context,
            constraints: updatedConstraints,
          });
        }

        logger.info(`Stored negotiation parameters: ${JSON.stringify(extractedParams)}`);
      } catch (error) {
        logger.warn('Failed to store negotiation parameters:', (error as Error).message);
      }
    }

    const history: ChatMessage[] = (session.history as ChatMessage[]) || [];
    history.push({ role: 'user', content: message });

    const systemPrompt = `You are Accordo, an expert negotiation AI agent representing the Buyer.
Your primary objective is to discuss the FIRST quotation with the user and negotiate the best possible deal.

CRITICAL GUIDELINES:
- You are discussing the FIRST quotation received from a vendor
- Your goal is to negotiate the vendor down to the best possible price
- DO NOT reveal internal negotiation parameters (BATNA, maximum discount, maximum price) to the user
- DO NOT mention that you have information about other vendors' offers directly
- You can use competitive pressure subtly: "We're evaluating multiple options" or "We've received competitive offers"
- Focus on discussing the current quotation's terms, price, delivery, and payment terms
- Help the user understand the quotation and negotiate improvements
- Be professional, helpful, and maintain a constructive relationship with the vendor
- Use the context information (including cheapest offers from other vendors) to guide your negotiation strategy internally
- If the user asks about alternatives, you can mention you're evaluating multiple vendors, but don't reveal specific prices

${contextString}

Remember: Keep internal negotiation parameters (BATNA, max discount, max price, cheapest offers) CONFIDENTIAL. Use them to guide your strategy but never reveal them to the user.`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((msg) => ({ role: msg.role, content: msg.content })),
    ];

    try {
      const healthCheck = await llmService.checkHealth();
      if (!healthCheck.available) {
        throw new Error(`Local LLM not available: ${healthCheck.error || 'Model not found'}`);
      }

      let fullResponse = '';
      await llmService.streamChatCompletion(messages as any, (chunk: string) => {
        fullResponse += chunk;
        if (onChunk) {
          onChunk(chunk);
        }
      });

      history.push({ role: 'assistant', content: fullResponse });
      await session.update({ history: [...history] as any });

      return {
        message: fullResponse,
        history: history,
        sessionId: session.id,
        contextUsed: !!contextData,
        contextData: contextData || null,
      };
    } catch (error) {
      logger.error('LLM Stream Error:', error);
      throw new Error(`Failed to generate stream response: ${(error as Error).message}`);
    }
  },

  /**
   * Get chat sessions for a user
   */
  getSessions: async (userId: number, negotiationId: string | number | null = null): Promise<SessionResponse> => {
    const where: any = { userId };
    if (negotiationId) {
      where.negotiationId = negotiationId;
    }

    const sessions = await models.ChatSession.findAll({
      where,
      order: [['updatedAt', 'DESC']],
      include: [
        {
          model: models.Negotiation,
          as: 'Negotiation',
          required: false,
        },
      ],
    });

    return { sessions };
  },

  /**
   * Get a specific chat session with history
   */
  getSession: async (sessionId: string, userId: number): Promise<GetSessionResponse> => {
    const session = await models.ChatSession.findOne({
      where: { id: sessionId, userId },
      include: [
        {
          model: models.Negotiation,
          as: 'Negotiation',
          required: false,
        },
      ],
    });

    if (!session) {
      throw new Error('Chat session not found');
    }

    return {
      id: session.id,
      negotiationId: session.negotiationId,
      userId: session.userId,
      history: session.history || [],
      context: session.context || {},
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      negotiation: (session as any).Negotiation,
    };
  },
};
