import { NegotiationState, IntelligenceAnalysis } from "../state.js";
import { NodeName } from "../types.js";
import { detectVendorTone, detectVendorStyle, detectStrictFirmness } from "../../tone-detector.js";
import { analyzeBehavior } from "../../behavioral-analyzer.js";
import { extractVendorConcerns, ConcernMessage, VendorConcern } from "../../concern-extractor.js";
import logger from "../../../../../config/logger.js";

/**
 * IntelligenceNode (Track 2: Yug)
 * 
 * Orchestrates the legacy intelligence extractors (Tone, Behavior, Concerns)
 * and maps their outputs to the strict NegotiationState Analysis schema.
 */
export const analyzeSentimentNode = async (state: NegotiationState) => {
  logger.info(`[Node: ${NodeName.ANALYZE_SENTIMENT}] Executing Intelligence Analysis...`);

  // 1. Prepare messages for legacy extractors
  const rawMessages = state.messages || [];
  // Ensure we only pass valid string content to the legacy modules
  const messages = rawMessages.map(m => ({
    role: m._getType() === "human" ? "VENDOR" : m._getType() === "ai" ? "ACCORDO" : "SYSTEM",
    content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    createdAt: new Date().toISOString(), // LangChain messages don't have createdAt, mock for behavior analyzer
    // For behavior analyzer, we need extracted offers in the message history if available
    extractedOffer: m._getType() === "human" && m.id === state.metadata?.lastParsedMessageId ? state.parsedOffer : null
  })) as any[];

  const vendorMessages = messages.filter(m => m.role === "VENDOR");
  const latestVendorMessage = vendorMessages.length > 0 ? vendorMessages[vendorMessages.length - 1].content : "";

  // 2. TONE & STYLE EXTRACTION
  const vendorTone = detectVendorTone(messages);
  const vendorStyle = detectVendorStyle(latestVendorMessage, messages);
  const strictFirmness = detectStrictFirmness(latestVendorMessage);

  // Map to IntelligenceAnalysis.tone
  let sentiment: "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "MIXED" = "NEUTRAL";
  if (vendorTone.primaryTone === "friendly" || vendorTone.primaryTone === "casual") sentiment = "POSITIVE";
  if (vendorTone.primaryTone === "firm") sentiment = "NEGATIVE";
  if (vendorStyle.hostility) sentiment = "NEGATIVE";

  // 3. BEHAVIORAL ANALYSIS
  const behaviorSignals = analyzeBehavior(messages, state.round || 1);

  // Map to IntelligenceAnalysis.behavior
  let mappedVelocity: "FAST" | "STEADY" | "SLOW" | "STALLED" = "STEADY";
  if (behaviorSignals.isStalling) mappedVelocity = "STALLED";
  else if (behaviorSignals.concessionVelocity > 500) mappedVelocity = "FAST"; // Heuristic
  else if (behaviorSignals.concessionVelocity < 50) mappedVelocity = "SLOW";

  let mappedMomentum: "ACCELERATING" | "DECELERATING" | "STABLE" = "STABLE";
  if (behaviorSignals.momentum > 0.2) mappedMomentum = "ACCELERATING";
  else if (behaviorSignals.momentum < -0.2) mappedMomentum = "DECELERATING";

  let rigidity = 0.5;
  if (strictFirmness.isFirm) rigidity += 0.3;
  if (behaviorSignals.isStalling) rigidity += 0.2;
  if (behaviorSignals.isConverging) rigidity -= 0.3;
  rigidity = Math.max(0, Math.min(1, rigidity));

  // 4. CONCERN EXTRACTION
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

  // 5. GLOBAL URGENCY
  let globalUrgency: "HIGH" | "MEDIUM" | "LOW" = "LOW";
  if (vendorTone.primaryTone === "urgent" || mappedConcerns.some(c => c.priority === "HIGH" && c.category === "DELIVERY")) {
    globalUrgency = "HIGH";
  } else if (vendorTone.allTones.urgent && vendorTone.allTones.urgent > 0) {
    globalUrgency = "MEDIUM";
  }

  // Construct final analysis object
  const analysis: IntelligenceAnalysis = {
    tone: {
      sentiment,
      formality: vendorStyle.formality,
      urgency: globalUrgency === "HIGH" ? 1.0 : globalUrgency === "MEDIUM" ? 0.5 : 0.0,
      styleSignals: {
        hostility: vendorStyle.hostility ? 1 : 0,
        hasQuestion: vendorStyle.hasQuestion ? 1 : 0,
        isNumberOnly: vendorStyle.isNumberOnly ? 1 : 0,
        repeatedOfferCount: vendorStyle.repeatedOfferCount
      }
    },
    behavior: {
      concessionVelocity: mappedVelocity,
      momentum: mappedMomentum,
      rigidityScore: rigidity
    },
    concerns: mappedConcerns,
    urgency: globalUrgency
  };

  return { analysis };
};
