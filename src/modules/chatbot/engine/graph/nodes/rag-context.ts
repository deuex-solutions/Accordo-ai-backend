import { NegotiationState } from "../state.js";
import { getRequisitionContext, getUserPreferences } from "../../../../../services/context.service.js";
import { buildRAGContext } from "../../../../vector/vector.service.js";
import logger from "../../../../../config/logger.js";

/**
 * RAGContextNode (Track 2: Yug)
 * 
 * Fuses context from three sources:
 * 1. Requisition context (details, products, target prices).
 * 2. User/vendor preferences (BATNA, weights).
 * 3. Semantic vector search (similar successful deals, phrasing history, patterns).
 * 
 * Also implements dynamic context window management.
 */
export const ragContextNode = async (state: NegotiationState): Promise<Partial<NegotiationState>> => {
  logger.info(`[Node: rag_context] Assembling RAG context...`);

  const dealId = state.dealId;
  const rfqId = state.rfqId;
  const vendorId = state.vendorId;

  let requisitionContext = null;
  let vendorPreferences = null;
  let vectorRAGContext = null;

  // 1. Fetch requisition context
  if (rfqId) {
    try {
      requisitionContext = await getRequisitionContext(rfqId);
    } catch (err) {
      logger.error(`[Node: rag_context] Failed to fetch requisition context for RFQ ${rfqId}`, err);
    }
  }

  // 2. Fetch vendor preferences
  if (vendorId) {
    try {
      vendorPreferences = await getUserPreferences(vendorId);
    } catch (err) {
      logger.error(`[Node: rag_context] Failed to fetch vendor preferences for user ${vendorId}`, err);
    }
  }

  // 3. Fetch semantic vector search results
  // Get the content of the latest vendor message to run semantic search
  const rawMessages = state.messages || [];
  const vendorMessages = rawMessages.filter(m => m._getType() === "human");
  const latestMessageContent = vendorMessages.length > 0
    ? (typeof vendorMessages[vendorMessages.length - 1].content === "string"
        ? vendorMessages[vendorMessages.length - 1].content as string
        : JSON.stringify(vendorMessages[vendorMessages.length - 1].content))
    : "";

  if (dealId && latestMessageContent) {
    try {
      vectorRAGContext = await buildRAGContext(dealId, latestMessageContent);
    } catch (err) {
      logger.error(`[Node: rag_context] Failed to build vector RAG context`, err);
    }
  }

  // 4. Dynamic Context Window Management
  // If the prompt addition is too long, we will limit the context items based on relevance scores or count
  let prunedSystemPromptAddition = "";
  if (vectorRAGContext?.systemPromptAddition) {
    const lines = vectorRAGContext.systemPromptAddition.split("\n");
    // Simple dynamic context budget: limit to 25 lines (~150-200 tokens) if it's very large
    if (lines.length > 25) {
      prunedSystemPromptAddition = lines.slice(0, 25).join("\n") + "\n... (truncated for context window budget)";
    } else {
      prunedSystemPromptAddition = vectorRAGContext.systemPromptAddition;
    }
  }

  // 5. Context Fusion into state.metadata
  const fusedContext = {
    requisition: requisitionContext,
    preferences: vendorPreferences,
    vectorRAG: vectorRAGContext ? {
      fewShotExamples: vectorRAGContext.fewShotExamples || [],
      similarNegotiations: vectorRAGContext.similarNegotiations || [],
      relevanceScores: vectorRAGContext.relevanceScores || [],
      systemPromptAddition: prunedSystemPromptAddition,
    } : null,
  };

  return {
    metadata: {
      ...state.metadata,
      ragContext: fusedContext,
    },
  };
};
