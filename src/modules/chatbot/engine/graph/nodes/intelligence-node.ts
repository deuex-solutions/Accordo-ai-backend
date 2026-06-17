import { NegotiationState, IntelligenceAnalysis } from "../state.js";
import { NodeName } from "../types.js";
import { detectVendorTone, detectVendorStyle, detectStrictFirmness } from "../../tone-detector.js";
import { analyzeBehavior } from "../../behavioral-analyzer.js";
import { extractVendorConcerns, ConcernMessage, VendorConcern } from "../../concern-extractor.js";
import logger from "../../../../../config/logger.js";

// Helper to convert LangChain messages to the format expected by the legacy analysis modules
function prepareMessages(state: NegotiationState) {
  const rawMessages = state.messages || [];
  return rawMessages.map(m => ({
    role: m._getType() === "human" ? "VENDOR" : m._getType() === "ai" ? "ACCORDO" : "SYSTEM",
    content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    createdAt: new Date().toISOString(),
    extractedOffer: m._getType() === "human" && m.id === state.metadata?.lastParsedMessageId ? state.parsedOffer : null
  })) as any[];
}

/**
 * Tone Analysis Node - runs tone and style detection (Phase 6.2)
 */
export const toneAnalysisNode = async (state: NegotiationState) => {
  logger.info(`[Node: tone_analysis] Analyzing vendor tone and style...`);
  const messages = prepareMessages(state);
  const vendorMessages = messages.filter(m => m.role === "VENDOR");
  const latestVendorMessage = vendorMessages.length > 0 ? vendorMessages[vendorMessages.length - 1].content : "";

  const vendorTone = detectVendorTone(messages);
  const vendorStyle = detectVendorStyle(latestVendorMessage, messages);

  let sentiment: "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "MIXED" = "NEUTRAL";
  if (vendorTone.primaryTone === "friendly" || vendorTone.primaryTone === "casual") sentiment = "POSITIVE";
  if (vendorTone.primaryTone === "firm") sentiment = "NEGATIVE";
  if (vendorStyle.hostility) sentiment = "NEGATIVE";

  return {
    analysis: {
      tone: {
        sentiment,
        formality: vendorStyle.formality,
        urgency: vendorTone.primaryTone === "urgent" ? 1.0 : (vendorTone.allTones.urgent ? 0.5 : 0.0),
        styleSignals: {
          hostility: vendorStyle.hostility ? 1 : 0,
          hasQuestion: vendorStyle.hasQuestion ? 1 : 0,
          isNumberOnly: vendorStyle.isNumberOnly ? 1 : 0,
          repeatedOfferCount: vendorStyle.repeatedOfferCount
        }
      }
    }
  };
};

/**
 * Behavioral Analysis Node - concession velocity, momentum, and rigidity (Phase 6.2)
 */
export const behavioralAnalysisNode = async (state: NegotiationState) => {
  logger.info(`[Node: behavioral_analysis] Analyzing vendor behavior...`);
  const messages = prepareMessages(state);
  const vendorMessages = messages.filter(m => m.role === "VENDOR");
  const latestVendorMessage = vendorMessages.length > 0 ? vendorMessages[vendorMessages.length - 1].content : "";

  const strictFirmness = detectStrictFirmness(latestVendorMessage);
  const behaviorSignals = analyzeBehavior(messages, state.round || 1);

  let mappedVelocity: "FAST" | "STEADY" | "SLOW" | "STALLED" = "STEADY";
  if (behaviorSignals.isStalling) mappedVelocity = "STALLED";
  else if (behaviorSignals.concessionVelocity > 500) mappedVelocity = "FAST";
  else if (behaviorSignals.concessionVelocity < 50) mappedVelocity = "SLOW";

  let mappedMomentum: "ACCELERATING" | "DECELERATING" | "STABLE" = "STABLE";
  if (behaviorSignals.momentum > 0.2) mappedMomentum = "ACCELERATING";
  else if (behaviorSignals.momentum < -0.2) mappedMomentum = "DECELERATING";

  let rigidity = 0.5;
  if (strictFirmness.isFirm) rigidity += 0.3;
  if (behaviorSignals.isStalling) rigidity += 0.2;
  if (behaviorSignals.isConverging) rigidity -= 0.3;
  rigidity = Math.max(0, Math.min(1, rigidity));

  return {
    analysis: {
      behavior: {
        concessionVelocity: mappedVelocity,
        momentum: mappedMomentum,
        rigidityScore: rigidity
      }
    }
  };
};

/**
 * Concern Extraction Node - semantic issue extraction (Phase 6.2)
 */
export const concernExtractionNode = async (state: NegotiationState) => {
  logger.info(`[Node: concern_extraction] Extracting vendor concerns...`);
  const messages = prepareMessages(state);

  const rawConcerns = extractVendorConcerns(messages as ConcernMessage[]);
  const mappedConcerns = rawConcerns.map((c: VendorConcern) => {
    let category: "PRICING" | "DELIVERY" | "QUALITY" | "PAYMENT_TERMS" | "OTHER" = "OTHER";
    if (c.type === "cost") category = "PRICING";
    else if (c.type === "timeline" || c.type === "logistics") category = "DELIVERY";
    else if (c.type === "quality") category = "QUALITY";
    else if (c.type === "payment") category = "PAYMENT_TERMS";

    let priority: "HIGH" | "MEDIUM" | "LOW" = "MEDIUM";
    if (c.confidence >= 0.55) priority = "HIGH";
    else if (c.confidence < 0.3) priority = "LOW";

    return {
      category,
      description: c.text,
      priority
    };
  });

  return {
    analysis: {
      concerns: mappedConcerns
    }
  };
};

/**
 * Merge Analysis Node - consolidates parallel analysis outputs (Phase 6.2)
 */
export const mergeAnalysisNode = async (state: NegotiationState) => {
  logger.info(`[Node: merge_analysis] Merging parallel analysis results...`);
  
  const currentAnalysis = state.analysis || {};
  
  // Calculate global urgency based on merged tone and concerns
  let globalUrgency: "HIGH" | "MEDIUM" | "LOW" = "LOW";
  
  const hasDeliveryHighConcern = currentAnalysis.concerns?.some(
    c => c.priority === "HIGH" && c.category === "DELIVERY"
  );

  const toneUrgency = currentAnalysis.tone?.urgency || 0;

  if (toneUrgency === 1.0 || hasDeliveryHighConcern) {
    globalUrgency = "HIGH";
  } else if (toneUrgency === 0.5) {
    globalUrgency = "MEDIUM";
  }

  // Update tone urgency to match global urgency score
  const updatedTone = currentAnalysis.tone ? {
    ...currentAnalysis.tone,
    urgency: globalUrgency === "HIGH" ? 1.0 : globalUrgency === "MEDIUM" ? 0.5 : 0.0
  } : undefined;

  return {
    analysis: {
      ...currentAnalysis,
      tone: updatedTone,
      urgency: globalUrgency
    }
  };
};
