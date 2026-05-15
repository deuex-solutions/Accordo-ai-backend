/**
 * Vector Service - Main service for vectorization, search, and RAG operations
 */

import { Op, literal, fn, col, QueryTypes } from "sequelize";
import { vectorLiteral } from "../../types/sequelize-vector.js";
import {
  MessageEmbedding,
  DealEmbedding,
  NegotiationPattern,
  VectorMigrationStatus,
  ChatbotMessage,
  ChatbotDeal,
  sequelize,
} from "../../models/index.js";
import { embeddingClient } from "./embedding.client.js";
import env from "../../config/env.js";
import logger from "../../config/logger.js";
import type {
  VectorSearchFilters,
  VectorSearchOptions,
  MessageSearchResult,
  DealSearchResult,
  PatternSearchResult,
  VectorizationResult,
  BatchVectorizationResult,
  AIContextResult,
  RAGContext,
  VectorStats,
  MigrationProgress,
  PreparedContent,
  MessageContent,
  DealSummaryContent,
} from "./vector.types.js";

const VECTOR_DIMENSION = env.vector.embeddingDimension;
const DEFAULT_TOP_K = 5;
const DEFAULT_SIMILARITY_THRESHOLD = 0.7;

// ─────────────────────────────────────────────────────────────────────────
// pgvector SQL filter builders
//
// The three search functions all push WHERE clauses into raw SQL so the
// HNSW index can be used during ORDER BY embedding <=> query. Sequelize's
// findAll() WHERE syntax doesn't compose with raw ORDER-BY-on-vector, so we
// translate the filter object into parameterized SQL fragments here.
// ─────────────────────────────────────────────────────────────────────────

interface SqlFilterFragment {
  where: string;
  replacements: Record<string, unknown>;
}

function buildMessageSqlFilters(
  filters: VectorSearchFilters,
): SqlFilterFragment {
  const clauses: string[] = [];
  const replacements: Record<string, unknown> = {};

  if (filters.dealId) {
    clauses.push("deal_id = :dealId");
    replacements.dealId = filters.dealId;
  }
  if (filters.userId) {
    clauses.push("user_id = :userId");
    replacements.userId = filters.userId;
  }
  if (filters.vendorId) {
    clauses.push("vendor_id = :vendorId");
    replacements.vendorId = filters.vendorId;
  }
  if (filters.role) {
    clauses.push("role = :role");
    replacements.role = filters.role;
  }
  if (filters.outcome) {
    clauses.push("outcome = :outcome");
    replacements.outcome = filters.outcome;
  }
  if (filters.decisionAction) {
    clauses.push("decision_action = :decisionAction");
    replacements.decisionAction = filters.decisionAction;
  }
  if (filters.contentType) {
    clauses.push("content_type = :contentType");
    replacements.contentType = filters.contentType;
  }
  if (filters.minUtility !== undefined) {
    clauses.push("utility_score >= :minUtility");
    replacements.minUtility = filters.minUtility;
  }
  if (filters.maxUtility !== undefined) {
    clauses.push("utility_score <= :maxUtility");
    replacements.maxUtility = filters.maxUtility;
  }
  if (filters.dateFrom) {
    clauses.push("created_at >= :dateFrom");
    replacements.dateFrom = filters.dateFrom;
  }
  if (filters.dateTo) {
    clauses.push("created_at <= :dateTo");
    replacements.dateTo = filters.dateTo;
  }

  return { where: clauses.join(" AND "), replacements };
}

function buildDealSqlFilters(filters: VectorSearchFilters): SqlFilterFragment {
  const clauses: string[] = ["embedding_type = 'summary'"];
  const replacements: Record<string, unknown> = {};

  if (filters.userId) {
    clauses.push("user_id = :userId");
    replacements.userId = filters.userId;
  }
  if (filters.vendorId) {
    clauses.push("vendor_id = :vendorId");
    replacements.vendorId = filters.vendorId;
  }
  if (filters.outcome) {
    clauses.push("final_status = :outcome");
    replacements.outcome = filters.outcome;
  }
  if (filters.productCategory) {
    clauses.push("product_category = :productCategory");
    replacements.productCategory = filters.productCategory;
  }
  if (filters.minUtility !== undefined) {
    clauses.push("final_utility >= :minUtility");
    replacements.minUtility = filters.minUtility;
  }
  if (filters.maxUtility !== undefined) {
    clauses.push("final_utility <= :maxUtility");
    replacements.maxUtility = filters.maxUtility;
  }

  return { where: clauses.join(" AND "), replacements };
}

function buildPatternSqlFilters(
  patternType?: string,
  scenario?: string,
): SqlFilterFragment {
  const clauses: string[] = ["is_active = true"];
  const replacements: Record<string, unknown> = {};

  if (patternType) {
    clauses.push("pattern_type = :patternType");
    replacements.patternType = patternType;
  }
  if (scenario) {
    clauses.push("scenario = :scenario");
    replacements.scenario = scenario;
  }

  return { where: clauses.join(" AND "), replacements };
}

/**
 * Prepare message content for embedding
 */
export function prepareMessageContent(
  message: MessageContent,
): PreparedContent {
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
    parts.push(
      `Utility: ${(message.engineDecision.utilityScore * 100).toFixed(1)}%`,
    );
  }

  return {
    contentText: parts.join(" | "),
    contentType: message.engineDecision
      ? "decision"
      : message.extractedOffer
        ? "offer_extract"
        : "message",
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
    parts.push(`Key exchanges: ${keyMessages.join(" | ")}`);
  }

  return {
    contentText: parts.join(". "),
    contentType: "summary",
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
  deal: ChatbotDeal,
): Promise<VectorizationResult> {
  const startTime = Date.now();

  try {
    // Prepare content
    const messageContent: MessageContent = {
      content: message.content,
      role: message.role,
      dealId: message.dealId,
      round: deal.round,
      extractedOffer: message.extractedOffer as
        | { unit_price?: number; payment_terms?: string }
        | undefined,
      engineDecision: message.engineDecision as
        | { action: string; utilityScore: number }
        | undefined,
    };

    const prepared = prepareMessageContent(messageContent);

    // Generate embedding
    const embedding = await embeddingClient.embed(
      prepared.contentText,
      "Represent this negotiation message for retrieval",
    );

    // Store embedding
    const embeddingRecord = await MessageEmbedding.create({
      messageId: message.id,
      dealId: message.dealId,
      userId: deal.userId || undefined,
      vendorId: deal.vendorId || undefined,
      embedding,
      contentText: prepared.contentText,
      contentType: prepared.contentType as
        | "message"
        | "offer_extract"
        | "decision",
      role: message.role,
      round: deal.round,
      outcome: deal.status !== "NEGOTIATING" ? deal.status : null,
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
    logger.error("Error vectorizing message:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      processingTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Vectorize a deal (summary embedding)
 */
export async function vectorizeDeal(
  dealId: string,
): Promise<VectorizationResult> {
  const startTime = Date.now();

  try {
    // Fetch deal with messages
    const deal = await ChatbotDeal.findByPk(dealId, {
      include: [{ model: ChatbotMessage, as: "Messages" }],
    });

    if (!deal) {
      return { success: false, error: "Deal not found" };
    }

    // Prepare summary content
    const messages = (deal.Messages || []).map((m) => ({
      content: m.content,
      role: m.role,
      dealId: m.dealId,
      round: deal.round,
      extractedOffer: m.extractedOffer as
        | { unit_price?: number; payment_terms?: string }
        | undefined,
      engineDecision: m.engineDecision as
        | { action: string; utilityScore: number }
        | undefined,
    }));

    const summaryContent: DealSummaryContent = {
      dealId: deal.id,
      title: deal.title,
      counterparty: deal.counterparty || undefined,
      status: deal.status,
      totalRounds: deal.round,
      latestUtility: deal.latestUtility || undefined,
      latestOffer: deal.latestOfferJson as
        | { unit_price?: number; payment_terms?: string }
        | undefined,
      messages,
    };

    const prepared = prepareDealSummary(summaryContent);

    // Generate embedding
    const embedding = await embeddingClient.embed(
      prepared.contentText,
      "Represent this negotiation summary for retrieval",
    );

    // Check if embedding already exists
    const existing = await DealEmbedding.findOne({
      where: { dealId, embeddingType: "summary" },
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
        embeddingType: "summary",
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
    logger.error("Error vectorizing deal:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      processingTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Search for similar messages
 */
export async function searchSimilarMessages(
  query: string,
  options: VectorSearchOptions = {},
): Promise<MessageSearchResult[]> {
  const {
    topK = DEFAULT_TOP_K,
    similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD,
    filters = {},
  } = options;

  try {
    // Generate query embedding
    const queryEmbedding = await embeddingClient.embed(
      query,
      "Represent this query for retrieving relevant negotiation messages",
    );

    // Build where clause
    const whereClause: Record<string, unknown> = {};

    if (filters.dealId) whereClause.dealId = filters.dealId;
    if (filters.userId) whereClause.userId = filters.userId;
    if (filters.vendorId) whereClause.vendorId = filters.vendorId;
    if (filters.role) whereClause.role = filters.role;
    if (filters.outcome) whereClause.outcome = filters.outcome;
    if (filters.decisionAction)
      whereClause.decisionAction = filters.decisionAction;
    if (filters.contentType) whereClause.contentType = filters.contentType;

    if (filters.minUtility !== undefined || filters.maxUtility !== undefined) {
      whereClause.utilityScore = {};
      if (filters.minUtility !== undefined) {
        (whereClause.utilityScore as Record<string, number>)[
          Op.gte as unknown as string
        ] = filters.minUtility;
      }
      if (filters.maxUtility !== undefined) {
        (whereClause.utilityScore as Record<string, number>)[
          Op.lte as unknown as string
        ] = filters.maxUtility;
      }
    }

    if (filters.dateFrom || filters.dateTo) {
      whereClause.createdAt = {};
      if (filters.dateFrom) {
        (whereClause.createdAt as Record<string, Date>)[
          Op.gte as unknown as string
        ] = filters.dateFrom;
      }
      if (filters.dateTo) {
        (whereClause.createdAt as Record<string, Date>)[
          Op.lte as unknown as string
        ] = filters.dateTo;
      }
    }

    // pgvector ANN search: ORDER BY embedding <=> query distance (cosine)
    // Returns rows sorted ascending by distance → lowest distance = highest similarity.
    // similarity = 1 - cosine_distance, since all embeddings are L2-normalized.
    const sqlFilters = buildMessageSqlFilters(filters);
    const queryVec = vectorLiteral(queryEmbedding);

    const rows = await sequelize.query<{
      id: string;
      message_id: string;
      deal_id: string;
      role: string;
      round: number;
      outcome: string | null;
      utility_score: number | null;
      decision_action: string | null;
      content_text: string;
      distance: string;
    }>(
      `SELECT
         id, message_id, deal_id, role, round, outcome,
         utility_score, decision_action, content_text,
         embedding <=> :queryVec ::vector AS distance
       FROM message_embeddings
       ${sqlFilters.where ? `WHERE ${sqlFilters.where}` : ""}
       ORDER BY embedding <=> :queryVec ::vector
       LIMIT :limit`,
      {
        replacements: {
          queryVec,
          limit: topK,
          ...sqlFilters.replacements,
        },
        type: QueryTypes.SELECT,
      },
    );

    const results: MessageSearchResult[] = rows
      .map((r) => ({
        id: r.id,
        similarity: 1 - Number(r.distance),
        contentText: r.content_text,
        metadata: {
          messageId: r.message_id,
          dealId: r.deal_id,
          role: r.role,
          round: r.round,
          outcome: r.outcome || undefined,
          utilityScore: r.utility_score || undefined,
          decisionAction: r.decision_action || undefined,
        },
      }))
      .filter((r) => r.similarity >= similarityThreshold);

    return results;
  } catch (error) {
    logger.error("Error searching similar messages:", error);
    throw error;
  }
}

/**
 * Search for similar deals
 */
export async function searchSimilarDeals(
  query: string,
  options: VectorSearchOptions = {},
): Promise<DealSearchResult[]> {
  const {
    topK = DEFAULT_TOP_K,
    similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD,
    filters = {},
  } = options;

  try {
    // Generate query embedding
    const queryEmbedding = await embeddingClient.embed(
      query,
      "Represent this query for retrieving relevant negotiations",
    );

    // pgvector ANN search via HNSW index, see searchSimilarMessages for rationale.
    const sqlFilters = buildDealSqlFilters(filters);
    const queryVec = vectorLiteral(queryEmbedding);

    const rows = await sequelize.query<{
      id: string;
      deal_id: string;
      deal_title: string | null;
      counterparty: string | null;
      final_status: string | null;
      total_rounds: number | null;
      final_utility: number | null;
      final_price: number | null;
      content_text: string;
      distance: string;
    }>(
      `SELECT
         id, deal_id, deal_title, counterparty, final_status,
         total_rounds, final_utility, final_price, content_text,
         embedding <=> :queryVec ::vector AS distance
       FROM deal_embeddings
       WHERE ${sqlFilters.where}
       ORDER BY embedding <=> :queryVec ::vector
       LIMIT :limit`,
      {
        replacements: {
          queryVec,
          limit: topK,
          ...sqlFilters.replacements,
        },
        type: QueryTypes.SELECT,
      },
    );

    const results: DealSearchResult[] = rows
      .map((r) => ({
        id: r.id,
        similarity: 1 - Number(r.distance),
        contentText: r.content_text,
        metadata: {
          dealId: r.deal_id,
          dealTitle: r.deal_title || undefined,
          counterparty: r.counterparty || undefined,
          finalStatus: r.final_status || undefined,
          totalRounds: r.total_rounds || undefined,
          finalUtility: r.final_utility || undefined,
          finalPrice: r.final_price || undefined,
        },
      }))
      .filter((r) => r.similarity >= similarityThreshold);

    return results;
  } catch (error) {
    logger.error("Error searching similar deals:", error);
    throw error;
  }
}

/**
 * Search for relevant patterns
 */
export async function searchPatterns(
  query: string,
  options: VectorSearchOptions & {
    patternType?: string;
    scenario?: string;
  } = {},
): Promise<PatternSearchResult[]> {
  const {
    topK = DEFAULT_TOP_K,
    similarityThreshold = 0.6,
    patternType,
    scenario,
  } = options;

  try {
    // Generate query embedding
    const queryEmbedding = await embeddingClient.embed(
      query,
      "Represent this query for retrieving relevant negotiation patterns",
    );

    // pgvector ANN search via HNSW index.
    const sqlFilters = buildPatternSqlFilters(patternType, scenario);
    const queryVec = vectorLiteral(queryEmbedding);

    const rows = await sequelize.query<{
      id: string;
      pattern_type: string;
      pattern_name: string;
      scenario: string | null;
      avg_utility: number | null;
      success_rate: number | null;
      sample_count: number;
      content_text: string;
      distance: string;
    }>(
      `SELECT
         id, pattern_type, pattern_name, scenario,
         avg_utility, success_rate, sample_count, content_text,
         embedding <=> :queryVec ::vector AS distance
       FROM negotiation_patterns
       WHERE ${sqlFilters.where}
       ORDER BY embedding <=> :queryVec ::vector
       LIMIT :limit`,
      {
        replacements: {
          queryVec,
          limit: topK,
          ...sqlFilters.replacements,
        },
        type: QueryTypes.SELECT,
      },
    );

    const results: PatternSearchResult[] = rows
      .map((r) => ({
        id: r.id,
        similarity: 1 - Number(r.distance),
        contentText: r.content_text,
        metadata: {
          patternType: r.pattern_type,
          patternName: r.pattern_name,
          scenario: r.scenario || undefined,
          avgUtility: r.avg_utility || undefined,
          successRate: r.success_rate || undefined,
          sampleCount: r.sample_count,
        },
      }))
      .filter((r) => r.similarity >= similarityThreshold);

    return results;
  } catch (error) {
    logger.error("Error searching patterns:", error);
    throw error;
  }
}

/**
 * Build AI context for a negotiation (RAG)
 */
export async function buildAIContext(
  currentDealId: string,
  vendorMessage: string,
): Promise<AIContextResult> {
  const startTime = Date.now();

  try {
    // Fetch current deal for context
    const currentDeal = await ChatbotDeal.findByPk(currentDealId);
    if (!currentDeal) {
      throw new Error("Deal not found");
    }

    // Build search query combining deal context and vendor message
    const searchQuery = `${currentDeal.title} | ${currentDeal.counterparty || ""} | ${vendorMessage}`;

    // Run searches in parallel
    const [similarDeals, patterns, relevantMessages] = await Promise.all([
      // Find similar successful negotiations
      searchSimilarDeals(searchQuery, {
        topK: 3,
        similarityThreshold: 0.6,
        filters: {
          outcome: "ACCEPTED",
          minUtility: 0.7,
        },
      }),
      // Find relevant patterns
      searchPatterns(searchQuery, {
        topK: 2,
        patternType: "successful_negotiation",
      }),
      // Find relevant messages from past negotiations
      searchSimilarMessages(vendorMessage, {
        topK: 5,
        similarityThreshold: 0.65,
        filters: {
          role: "ACCORDO",
          decisionAction: "COUNTER",
        },
      }),
    ]);

    // Build context text for LLM
    const contextParts: string[] = [];

    if (similarDeals.length > 0) {
      contextParts.push("Similar successful negotiations:");
      similarDeals.forEach((deal, i) => {
        contextParts.push(
          `${i + 1}. ${deal.contentText} (similarity: ${(deal.similarity * 100).toFixed(1)}%)`,
        );
      });
    }

    if (patterns.length > 0) {
      contextParts.push("\nRelevant patterns:");
      patterns.forEach((pattern) => {
        contextParts.push(
          `- ${pattern.metadata.patternName}: ${pattern.contentText}`,
        );
      });
    }

    if (relevantMessages.length > 0) {
      contextParts.push("\nRelevant past responses:");
      relevantMessages.slice(0, 3).forEach((msg) => {
        contextParts.push(`- ${msg.contentText}`);
      });
    }

    return {
      similarDeals,
      fewShotExamples: patterns,
      relevantMessages,
      contextText: contextParts.join("\n"),
      retrievalTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    logger.error("Error building AI context:", error);
    throw error;
  }
}

/**
 * Build RAG context for system prompt augmentation
 */
export async function buildRAGContext(
  dealId: string,
  currentMessage: string,
): Promise<RAGContext> {
  try {
    const aiContext = await buildAIContext(dealId, currentMessage);

    // Format for system prompt
    const systemPromptAddition = aiContext.contextText
      ? `\n\n[Retrieved Context from Similar Negotiations]\n${aiContext.contextText}`
      : "";

    // Format few-shot examples
    const fewShotExamples = aiContext.relevantMessages
      .slice(0, 2)
      .map((msg) => msg.contentText);

    // Format similar negotiations
    const similarNegotiations = aiContext.similarDeals.map(
      (deal) => deal.contentText,
    );

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
    logger.error("Error building RAG context:", error);
    return {
      systemPromptAddition: "",
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
        attributes: ["role", [fn("COUNT", col("id")), "count"]],
        group: ["role"],
        raw: true,
      }),
      MessageEmbedding.findAll({
        attributes: ["outcome", [fn("COUNT", col("id")), "count"]],
        where: { outcome: { [Op.ne]: null } },
        group: ["outcome"],
        raw: true,
      }),
      DealEmbedding.count(),
      DealEmbedding.findAll({
        attributes: ["finalStatus", [fn("COUNT", col("id")), "count"]],
        where: { finalStatus: { [Op.ne]: null } },
        group: ["finalStatus"],
        raw: true,
      }),
      DealEmbedding.findAll({
        attributes: ["embeddingType", [fn("COUNT", col("id")), "count"]],
        group: ["embeddingType"],
        raw: true,
      }),
      NegotiationPattern.count(),
      NegotiationPattern.count({ where: { isActive: true } }),
      NegotiationPattern.findAll({
        attributes: ["patternType", [fn("COUNT", col("id")), "count"]],
        group: ["patternType"],
        raw: true,
      }),
      embeddingClient.getHealthStatus(),
      VectorMigrationStatus.findOne({
        order: [["createdAt", "DESC"]],
      }),
    ]);

    const toRecord = (
      arr: unknown[],
      keyField: string,
    ): Record<string, number> => {
      const result: Record<string, number> = {};
      for (const item of arr as Array<Record<string, unknown>>) {
        const key = String(item[keyField] || "unknown");
        result[key] = Number(item["count"]) || 0;
      }
      return result;
    };

    return {
      messageEmbeddings: {
        total: messageTotal,
        byRole: toRecord(messageByRole, "role"),
        byOutcome: toRecord(messageByOutcome, "outcome"),
      },
      dealEmbeddings: {
        total: dealTotal,
        byStatus: toRecord(dealByStatus, "finalStatus"),
        byType: toRecord(dealByType, "embeddingType"),
      },
      negotiationPatterns: {
        total: patternTotal,
        active: patternActive,
        byType: toRecord(patternByType, "patternType"),
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
                ? Math.round(
                    (lastMigration.processedRecords /
                      lastMigration.totalRecords) *
                      100,
                  )
                : 0,
            estimatedTimeRemaining:
              lastMigration.estimatedTimeRemaining || undefined,
            processingRate: lastMigration.processingRate || undefined,
            startedAt: lastMigration.startedAt || undefined,
            completedAt: lastMigration.completedAt || undefined,
            errorMessage: lastMigration.errorMessage || undefined,
          }
        : undefined,
    };
  } catch (error) {
    logger.error("Error getting vector stats:", error);
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
