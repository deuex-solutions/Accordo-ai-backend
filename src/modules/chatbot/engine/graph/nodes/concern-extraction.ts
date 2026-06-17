import { NegotiationState } from "../state.js";
import { extractVendorConcerns, ConcernMessage } from "../../concern-extractor.js";

/**
 * ConcernExtractionAgent (Track 2: Yug) - Phase 3.1
 * 
 * @source src/modules/chatbot/engine/concern-extractor.ts
 * 
 * Synergy Mandate:
 * - Ports semantic issue identification from legacy
 * - Implements supply chain concern detection
 * - Implements timeline/budget concern extraction
 */
export const concernExtractionNode = async (state: NegotiationState) => {
  if (!state.messages || state.messages.length === 0) {
    return {};
  }

  // Map LangGraph standard messages to legacy ConcernMessage interface
  const concernMessages: ConcernMessage[] = state.messages.map((m: any) => {
    let role: 'VENDOR' | 'ACCORDO' | 'SYSTEM' = 'SYSTEM';
    if (m._getType() === "human") role = "VENDOR";
    else if (m._getType() === "ai") role = "ACCORDO";

    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    return { role, content };
  });

  // Call the legacy extractor logic to maintain 100% parity
  const extracted = extractVendorConcerns(concernMessages);

  if (extracted.length === 0) {
    return { analysis: { concerns: [] } };
  }

  // Map legacy types to IntelligenceAnalysis.concerns schema
  const concerns = extracted.map(concern => {
    let category: "PRICING" | "DELIVERY" | "QUALITY" | "PAYMENT_TERMS" | "OTHER" = "OTHER";
    
    if (concern.type === 'cost' || concern.type === 'volume') {
      category = "PRICING";
    } else if (concern.type === 'timeline' || concern.type === 'logistics') {
      category = "DELIVERY";
    } else if (concern.type === 'quality') {
      category = "QUALITY";
    } else if (concern.type === 'payment') {
      category = "PAYMENT_TERMS";
    }

    // Determine priority
    let priority: "HIGH" | "MEDIUM" | "LOW" = "LOW";
    if (concern.confidence > 0.8 && (concern.type === 'timeline' || concern.type === 'cost')) {
      priority = "HIGH";
    } else if (concern.confidence >= 0.5) {
      priority = "MEDIUM";
    }

    return {
      category,
      description: concern.text, // e.g. "rising material costs"
      priority
    };
  });

  // Determine global urgency for this round
  let urgency: "HIGH" | "MEDIUM" | "LOW" = "LOW";
  if (concerns.some(c => c.priority === "HIGH")) {
    urgency = "HIGH";
  } else if (concerns.some(c => c.priority === "MEDIUM")) {
    urgency = "MEDIUM";
  }

  return {
    analysis: {
      concerns,
      urgency
    }
  };
};
