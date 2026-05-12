/**
 * Vector Service - Main service for vectorization, search, and RAG operations
 */

import { Op, fn, col } from 'sequelize';
import {
  MessageEmbedding,
  DealEmbedding,
  NegotiationPattern,
  VectorMigrationStatus,
  ChatbotMessage,
  ChatbotDeal,
} from '../../models/index.js';
import { embeddingClient } from './embedding.client.js';
import env from '../../config/env.js';
import logger from '../../config/logger.js';
import type {
  VectorSearchOptions,
  MessageSearchResult,
  DealSearchResult,
  PatternSearchResult,
  VectorizationResult,
  AIContextResult,
  RAGContext,
  VectorStats,
  PreparedContent,
  MessageContent,
  DealSummaryContent,
} from './vector.types.js';

// removed dead: const VECTOR_DIMENSION = env.vector.embeddingDimension;
const DEFAULT_TOP_K = 5;
const DEFAULT_SIMILARITY_THRESHOLD = 0.7;

/**
 * Prepare message content for embedding
 */
export function prepareMessageContent(message: MessageContent): PreparedContent {
  const parts: string[] = [];

  // Add role and content
  parts.push(`[${message.role}]: ${message.content}`);

  // Add extracted offer if available
  if (message.extractedOffer) {
    const offer = message.extractedOffer;
    if (offer.unit_price !== undefined) {
      parts.push(`Price: $${offer.unit_price}`);
    }
    if (offer.payment_terms) {
      parts.push(`Terms: ${offer.payment_terms}`);
    }
  }

  // Add decision info if available
  if (message.engineDecision) {
    parts.push(`Decision: ${message.engineDecision.action}`);
    parts.push(`Utility: ${(message.engineDecision.utilityScore * 100).toFixed(1)}%`);
  }

  return {
    contentText: parts.join(' | '),
    contentType: message.engineDecision ? 'decision' : message.extractedOffer ? 'offer_extract' : 'message',
    metadata: {
      dealId: message.dealId,
      role: message.role,
      round: message.round,
    },
  };
}

/**
 * Prepare deal summary for embedding
 */
export function prepareDealSummary(deal: DealSummaryContent): PreparedContent {
  const parts: string[] = [];

  parts.push(`Negotiation: ${deal.title}`);
  if (deal.counterparty) {
    parts.push(`With: ${deal.counterparty}`);
  }
  parts.push(`Status: ${deal.status}`);
  parts.push(`Rounds: ${deal.totalRounds}`);

  if (deal.latestUtility !== undefined) {
    parts.push(`Final Utility: ${(deal.latestUtility * 100).toFixed(1)}%`);
  }

  if (deal.latestOffer) {
    if (deal.latestOffer.unit_price !== undefined) {
      parts.push(`Final Price: $${deal.latestOffer.unit_price}`);
    }
    if (deal.latestOffer.payment_terms) {
      parts.push(`Final Terms: ${deal.latestOffer.payment_terms}`);
    }
  }

  // Add summary of key messages
  const keyMessages = deal.messages
    .filter((m) => m.engineDecision || m.extractedOffer)
    .slice(-3)
    .map((m) => `${m.role}: ${m.content.substring(0, 100)}...`);

  if (keyMessages.length > 0) {
    parts.push(`Key exchanges: ${keyMessages.join(' | ')}`);
  }

  return {
    contentText: parts.join('. '),
    contentType: 'summary',
    metadata: {
      dealId: deal.dealId,
      status: deal.status,
      totalRounds: deal.totalRounds,
    },
  };
}

/**
 * Vectorize a single message
 */
export async function vectorizeMessage(
  message: ChatbotMessage,
  deal: ChatbotDeal
): Promise<VectorizationResult> {
  const startTime = Date.now();

  try {
    // Prepare content
    const messageContent: MessageContent = {
      content: message.content,
      role: message.role,
      dealId: message.dealId,
      round: deal.round,
      extractedOffer: message.extractedOffer as { unit_price?: number; payment_terms?: string } | undefined,
      engineDecision: message.engineDecision as { action: string; utilityScore: number } | undefined,
    };

    const prepared = prepareMessageContent(messageContent);

    // Generate embedding
    const embedding = await embeddingClient.embed(
      prepared.contentText,
      'Represent this negotiation message for retrieval'
    );

    // Store embedding
    const embeddingRecord = await MessageEmbedding.create({
      messageId: message.id,
      dealId: message.dealId,
      userId: deal.userId || undefined,
      vendorId: deal.vendorId || undefined,
      embedding,
      contentText: prepared.contentText,
      contentType: prepared.contentType as 'message' | 'offer_extract' | 'decision',
      role: message.role,
      round: deal.round,
      outcome: deal.status !== 'NEGOTIATING' ? deal.status : null,
      utilityScore: message.utilityScore,
      decisionAction: message.decisionAction,
      metadata: {
        originalContent: message.content,
        extractedOffer: message.extractedOffer,
        engineDecision: message.engineDecision,
      },
    });

    return {
      success: true,
      embeddingId: embeddingRecord.id,
      processingTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    logger.error('Error vectorizing message:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      processingTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Vectorize a deal (summary embedding)
 */
export async function vectorizeDeal(dealId: string): Promise<VectorizationResult> {
  const startTime = Date.now();

  try {
    // Fetch deal with messages
    const deal = await ChatbotDeal.findByPk(dealId, {
      include: [{ model: ChatbotMessage, as: 'Messages' }],
    });

    if (!deal) {
      return { success: false, error: 'Deal not found' };
    }

    // Prepare summary content
    const messages = (deal.Messages || []).map((m) => ({
      content: m.content,
      role: m.role,
      dealId: m.dealId,
      round: deal.round,
      extractedOffer: m.extractedOffer as { unit_price?: number; payment_terms?: string } | undefined,
      engineDecision: m.engineDecision as { action: string; utilityScore: number } | undefined,
    }));

    const summaryContent: DealSummaryContent = {
      dealId: deal.id,
      title: deal.title,
      counterparty: deal.counterparty || undefined,
      status: deal.status,
      totalRounds: deal.round,
      latestUtility: deal.latestUtility || undefined,
      latestOffer: deal.latestOfferJson as { unit_price?: number; payment_terms?: string } | undefined,
      messages,
    };

    const prepared = prepareDealSummary(summaryContent);

    // Generate embedding
    const embedding = await embeddingClient.embed(
      prepared.contentText,
      'Represent this negotiation summary for retrieval'
    );

    // Check if embedding already exists
    const existing = await DealEmbedding.findOne({
      where: { dealId, embeddingType: 'summary' },
    });

    let embeddingRecord;
    if (existing) {
      // Update existing
      await existing.update({
        embedding,
        contentText: prepared.contentText,
        finalStatus: deal.status,
        totalRounds: deal.round,
        finalUtility: deal.latestUtility,
      });
      embeddingRecord = existing;
    } else {
      // Create new
      embeddingRecord = await DealEmbedding.create({
        dealId: deal.id,
        userId: deal.userId || undefined,
        vendorId: deal.vendorId || undefined,
        embedding,
        contentText: prepared.contentText,
        embeddingType: 'summary',
        dealTitle: deal.title,
        counterparty: deal.counterparty,
        finalStatus: deal.status,
        totalRounds: deal.round,
        finalUtility: deal.latestUtility,
        metadata: {
          latestOffer: deal.latestOfferJson,
          latestVendorOffer: deal.latestVendorOffer,
        },
      });
    }

    return {
      success: true,
      embeddingId: embeddingRecord.id,
      processingTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    logger.error('Error vectorizing deal:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      processingTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Search for similar messages
 */
export async function searchSimilarMessages(
  query: string,
  options: VectorSearchOptions = {}
): Promise<MessageSearchResult[]> {
  const { topK = DEFAULT_TOP_K, similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD, filters = {} } = options;

  try {
    // Generate query embedding
    const queryEmbedding = await embeddingClient.embed(
      query,
      'Represent this query for retrieving relevant negotiation messages'
    );

    // Build where clause
    const whereClause: Record<string, unknown> = {};

    if (filters.dealId) whereClause.dealId = filters.dealId;
    if (filters.userId) whereClause.userId = filters.userId;
    if (filters.vendorId) whereClause.vendorId = filters.vendorId;
    if (filters.role) whereClause.role = filters.role;
    if (filters.outcome) whereClause.outcome = filters.outcome;
    if (filters.decisionAction) whereClause.decisionAction = filters.decisionAction;
    if (filters.contentType) whereClause.contentType = filters.contentType;

    if (filters.minUtility !== undefined || filters.maxUtility !== undefined) {
      whereClause.utilityScore = {};
      if (filters.minUtility !== undefined) {
        (whereClause.utilityScore as Record<string, number>)[Op.gte as unknown as string] = filters.minUtility;
      }
      if (filters.maxUtility !== undefined) {
        (whereClause.utilityScore as Record<string, number>)[Op.lte as unknown as string] = filters.maxUtility;
      }
    }

    if (filters.dateFrom || filters.dateTo) {
      whereClause.createdAt = {};
      if (filters.dateFrom) {
        (whereClause.createdAt as Record<string, Date>)[Op.gte as unknown as string] = filters.dateFrom;
      }
      if (filters.dateTo) {
        (whereClause.createdAt as Record<string, Date>)[Op.lte as unknown as string] = filters.dateTo;
      }
    }

    // Fetch all embeddings that match filters
    const embeddings = await MessageEmbedding.findAll({
      where: whereClause,
      limit: topK * 3, // Fetch more than needed to account for similarity filtering
    });

    // Compute similarities and sort
    const results: MessageSearchResult[] = embeddings
      .map((emb) => {
        const similarity = embeddingClient.cosineSimilarity(queryEmbedding, emb.embedding);
        return {
          id: emb.id,
          similarity,
          contentText: emb.contentText,
          metadata: {
            messageId: emb.messageId,
            dealId: emb.dealId,
            role: emb.role,
            round: emb.round,
            outcome: emb.outcome || undefined,
            utilityScore: emb.utilityScore || undefined,
            decisionAction: emb.decisionAction || undefined,
          },
        };
      })
      .filter((r) => r.similarity >= similarityThreshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);

    return results;
  } catch (error) {
    logger.error('Error searching similar messages:', error);
    throw error;
  }
}

/**
 * Search for similar deals
 */
export async function searchSimilarDeals(
  query: string,
  options: VectorSearchOptions = {}
): Promise<DealSearchResult[]> {
  const { topK = DEFAULT_TOP_K, similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD, filters = {} } = options;

  try {
    // Generate query embedding
    const queryEmbedding = await embeddingClient.embed(
      query,
      'Represent this query for retrieving relevant negotiations'
    );

    // Build where clause
    const whereClause: Record<string, unknown> = {
      embeddingType: 'summary',
    };

    if (filters.userId) whereClause.userId = filters.userId;
    if (filters.vendorId) whereClause.vendorId = filters.vendorId;
    if (filters.outcome) whereClause.finalStatus = filters.outcome;
    if (filters.productCategory) whereClause.productCategory = filters.productCategory;

    if (filters.minUtility !== undefined || filters.maxUtility !== undefined) {
      whereClause.finalUtility = {};
      if (filters.minUtility !== undefined) {
        (whereClause.finalUtility as Record<string, number>)[Op.gte as unknown as string] = filters.minUtility;
      }
      if (filters.maxUtility !== undefined) {
        (whereClause.finalUtility as Record<string, number>)[Op.lte as unknown as string] = filters.maxUtility;
      }
    }

    // Fetch embeddings
    const embeddings = await DealEmbedding.findAll({
      where: whereClause,
      limit: topK * 3,
    });

    // Compute similarities and sort
    const results: DealSearchResult[] = embeddings
      .map((emb) => {
        const similarity = embeddingClient.cosineSimilarity(queryEmbedding, emb.embedding);
        return {
          id: emb.id,
          similarity,
          contentText: emb.contentText,
          metadata: {
            dealId: emb.dealId,
            dealTitle: emb.dealTitle || undefined,
            counterparty: emb.counterparty || undefined,
            finalStatus: emb.finalStatus || undefined,
            totalRounds: emb.totalRounds || undefined,
            finalUtility: emb.finalUtility || undefined,
            finalPrice: emb.finalPrice || undefined,
          },
        };
      })
      .filter((r) => r.similarity >= similarityThreshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);

    return results;
  } catch (error) {
    logger.error('Error searching similar deals:', error);
    throw error;
  }
}

/**
 * Search for relevant patterns
 */
export async function searchPatterns(
  query: string,
  options: VectorSearchOptions & { patternType?: string; scenario?: string } = {}
): Promise<PatternSearchResult[]> {
  const { topK = DEFAULT_TOP_K, similarityThreshold = 0.6, patternType, scenario } = options;

  try {
    // Generate query embedding
    const queryEmbedding = await embeddingClient.embed(
      query,
      'Represent this query for retrieving relevant negotiation patterns'
    );

    // Build where clause
    const whereClause: Record<string, unknown> = {
      isActive: true,
    };

    if (patternType) whereClause.patternType = patternType;
    if (scenario) whereClause.scenario = scenario;

    // Fetch patterns
    const patterns = await NegotiationPattern.findAll({
      where: whereClause,
      limit: topK * 3,
    });

    // Compute similarities and sort
    const results: PatternSearchResult[] = patterns
      .map((pattern) => {
        const similarity = embeddingClient.cosineSimilarity(queryEmbedding, pattern.embedding);
        return {
          id: pattern.id,
          similarity,
          contentText: pattern.contentText,
          metadata: {
            patternType: pattern.patternType,
            patternName: pattern.patternName,
            scenario: pattern.scenario || undefined,
            avgUtility: pattern.avgUtility || undefined,
            successRate: pattern.successRate || undefined,
            sampleCount: pattern.sampleCount,
          },
        };
      })
      .filter((r) => r.similarity >= similarityThreshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);

    return results;
  } catch (error) {
    logger.error('Error searching patterns:', error);
    throw error;
  }
}

/**
 * Build AI context for a negotiation (RAG)
 */
export async function buildAIContext(
  currentDealId: string,
  vendorMessage: string
): Promise<AIContextResult> {
  const startTime = Date.now();

  try {
    // Fetch current deal for context
    const currentDeal = await ChatbotDeal.findByPk(currentDealId);
    if (!currentDeal) {
      throw new Error('Deal not found');
    }

    // Build search query combining deal context and vendor message
    const searchQuery = `${currentDeal.title} | ${currentDeal.counterparty || ''} | ${vendorMessage}`;

    // Run searches in parallel
    const [similarDeals, patterns, relevantMessages] = await Promise.all([
      // Find similar successful negotiations
      searchSimilarDeals(searchQuery, {
        topK: 3,
        similarityThreshold: 0.6,
        filters: {
          outcome: 'ACCEPTED',
          minUtility: 0.7,
        },
      }),
      // Find relevant patterns
      searchPatterns(searchQuery, {
        topK: 2,
        patternType: 'successful_negotiation',
      }),
      // Find relevant messages from past negotiations
      searchSimilarMessages(vendorMessage, {
        topK: 5,
        similarityThreshold: 0.65,
        filters: {
          role: 'ACCORDO',
          decisionAction: 'COUNTER',
        },
      }),
    ]);

    // Build context text for LLM
    const contextParts: string[] = [];

    if (similarDeals.length > 0) {
      contextParts.push('Similar successful negotiations:');
      similarDeals.forEach((deal, i) => {
        contextParts.push(`${i + 1}. ${deal.contentText} (similarity: ${(deal.similarity * 100).toFixed(1)}%)`);
      });
    }

    if (patterns.length > 0) {
      contextParts.push('\nRelevant patterns:');
      patterns.forEach((pattern) => {
        contextParts.push(`- ${pattern.metadata.patternName}: ${pattern.contentText}`);
      });
    }

    if (relevantMessages.length > 0) {
      contextParts.push('\nRelevant past responses:');
      relevantMessages.slice(0, 3).forEach((msg) => {
        contextParts.push(`- ${msg.contentText}`);
      });
    }

    return {
      similarDeals,
      fewShotExamples: patterns,
      relevantMessages,
      contextText: contextParts.join('\n'),
      retrievalTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    logger.error('Error building AI context:', error);
    throw error;
  }
}

/**
 * Build RAG context for system prompt augmentation
 */
export async function buildRAGContext(
  dealId: string,
  currentMessage: string
): Promise<RAGContext> {
  try {
    const aiContext = await buildAIContext(dealId, currentMessage);

    // Format for system prompt
    const systemPromptAddition = aiContext.contextText
      ? `\n\n[Retrieved Context from Similar Negotiations]\n${aiContext.contextText}`
      : '';

    // Format few-shot examples
    const fewShotExamples = aiContext.relevantMessages.slice(0, 2).map((msg) => msg.contentText);

    // Format similar negotiations
    const similarNegotiations = aiContext.similarDeals.map((deal) => deal.contentText);

    // Get relevance scores
    const relevanceScores = [
      ...aiContext.similarDeals.map((d) => d.similarity),
      ...aiContext.fewShotExamples.map((p) => p.similarity),
    ];

    return {
      systemPromptAddition,
      fewShotExamples,
      similarNegotiations,
      relevanceScores,
    };
  } catch (error) {
    logger.error('Error building RAG context:', error);
    return {
      systemPromptAddition: '',
      fewShotExamples: [],
      similarNegotiations: [],
      relevanceScores: [],
    };
  }
}

/**
 * Get vector statistics
 */
export async function getVectorStats(): Promise<VectorStats> {
  try {
    const [
      messageTotal,
      messageByRole,
      messageByOutcome,
      dealTotal,
      dealByStatus,
      dealByType,
      patternTotal,
      patternActive,
      patternByType,
      embeddingHealth,
      lastMigration,
    ] = await Promise.all([
      MessageEmbedding.count(),
      MessageEmbedding.findAll({
        attributes: ['role', [fn('COUNT', col('id')), 'count']],
        group: ['role'],
        raw: true,
      }),
      MessageEmbedding.findAll({
        attributes: ['outcome', [fn('COUNT', col('id')), 'count']],
        where: { outcome: { [Op.ne]: null } },
        group: ['outcome'],
        raw: true,
      }),
      DealEmbedding.count(),
      DealEmbedding.findAll({
        attributes: ['finalStatus', [fn('COUNT', col('id')), 'count']],
        where: { finalStatus: { [Op.ne]: null } },
        group: ['finalStatus'],
        raw: true,
      }),
      DealEmbedding.findAll({
        attributes: ['embeddingType', [fn('COUNT', col('id')), 'count']],
        group: ['embeddingType'],
        raw: true,
      }),
      NegotiationPattern.count(),
      NegotiationPattern.count({ where: { isActive: true } }),
      NegotiationPattern.findAll({
        attributes: ['patternType', [fn('COUNT', col('id')), 'count']],
        group: ['patternType'],
        raw: true,
      }),
      embeddingClient.getHealthStatus(),
      VectorMigrationStatus.findOne({
        order: [['createdAt', 'DESC']],
      }),
    ]);

    const toRecord = (arr: unknown[], keyField: string): Record<string, number> => {
      const result: Record<string, number> = {};
      for (const item of arr as Array<Record<string, unknown>>) {
        const key = String(item[keyField] || 'unknown');
        result[key] = Number(item['count']) || 0;
      }
      return result;
    };

    return {
      messageEmbeddings: {
        total: messageTotal,
        byRole: toRecord(messageByRole, 'role'),
        byOutcome: toRecord(messageByOutcome, 'outcome'),
      },
      dealEmbeddings: {
        total: dealTotal,
        byStatus: toRecord(dealByStatus, 'finalStatus'),
        byType: toRecord(dealByType, 'embeddingType'),
      },
      negotiationPatterns: {
        total: patternTotal,
        active: patternActive,
        byType: toRecord(patternByType, 'patternType'),
      },
      embeddingServiceStatus: embeddingHealth,
      lastMigration: lastMigration
        ? {
            id: lastMigration.id,
            migrationType: lastMigration.migrationType,
            status: lastMigration.status,
            totalRecords: lastMigration.totalRecords,
            processedRecords: lastMigration.processedRecords,
            failedRecords: lastMigration.failedRecords,
            currentBatch: lastMigration.currentBatch,
            totalBatches: lastMigration.totalBatches,
            percentComplete:
              lastMigration.totalRecords > 0
                ? Math.round((lastMigration.processedRecords / lastMigration.totalRecords) * 100)
                : 0,
            estimatedTimeRemaining: lastMigration.estimatedTimeRemaining || undefined,
            processingRate: lastMigration.processingRate || undefined,
            startedAt: lastMigration.startedAt || undefined,
            completedAt: lastMigration.completedAt || undefined,
            errorMessage: lastMigration.errorMessage || undefined,
          }
        : undefined,
    };
  } catch (error) {
    logger.error('Error getting vector stats:', error);
    throw error;
  }
}

export default {
  prepareMessageContent,
  prepareDealSummary,
  vectorizeMessage,
  vectorizeDeal,
  searchSimilarMessages,
  searchSimilarDeals,
  searchPatterns,
  buildAIContext,
  buildRAGContext,
  getVectorStats,
};
