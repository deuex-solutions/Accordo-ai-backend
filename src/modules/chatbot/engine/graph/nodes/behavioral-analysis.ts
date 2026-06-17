import { NegotiationState } from "../state.js";
import behavioralAnalyzer, { AnalyzableMessage } from "../../behavioral-analyzer.js";
import { parseOfferRegex } from "../../parse-offer.js";

/**
 * BehavioralAnalysisAgent (Track 2: Yug)
 * 
 * @source src/modules/chatbot/engine/behavioral-analyzer.ts
 * 
 * Synergy Mandate:
 * - Ports concession velocity tracking
 * - Implements momentum tracking
 * - Implements rigidity detection patterns
 */
export const behavioralAnalysisNode = async (state: NegotiationState) => {
  if (!state.messages || state.messages.length === 0) {
    return {};
  }

  const reqCurrency = state.config?.currency;

  const analyzableMessages: AnalyzableMessage[] = state.messages.map((m: any, index: number) => {
    let role: 'VENDOR' | 'ACCORDO' | 'SYSTEM' | 'PM' = 'SYSTEM';
    if (m._getType() === "human") role = "VENDOR";
    else if (m._getType() === "ai") role = "ACCORDO";

    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    
    // Extract offers dynamically since LangChain standard messages don't store them natively
    const parsed = parseOfferRegex(content, reqCurrency);

    // Simulate dates incrementally so response time tracking doesn't break
    const simulatedDate = new Date();
    simulatedDate.setMinutes(simulatedDate.getMinutes() + index * 10); // 10 mins apart

    return {
      role,
      content,
      extractedOffer: role === 'VENDOR' ? { total_price: parsed.total_price } : null,
      counterOffer: role === 'ACCORDO' ? { total_price: parsed.total_price } : null,
      createdAt: m.additional_kwargs?.createdAt || simulatedDate
    };
  });

  const signals = behavioralAnalyzer.analyzeBehavior(analyzableMessages, state.round);

  // Map to IntelligenceAnalysis.behavior schema
  let concessionVelocity: "FAST" | "STEADY" | "SLOW" | "STALLED" = "STEADY";
  if (signals.isStalling) {
    concessionVelocity = "STALLED";
  } else if (signals.concessionVelocity > 500) { // Arbitrary threshold
    concessionVelocity = "FAST";
  } else if (signals.concessionVelocity > 0) {
    concessionVelocity = "STEADY";
  } else {
    concessionVelocity = "SLOW";
  }

  let momentum: "ACCELERATING" | "DECELERATING" | "STABLE" = "STABLE";
  if (signals.momentum > 0.3) {
    momentum = "ACCELERATING";
  } else if (signals.momentum < -0.2) {
    momentum = "DECELERATING";
  }

  // Calculate rigidity (0-1)
  let rigidityScore = 0.5;
  if (signals.isStalling) rigidityScore = 0.9;
  else if (signals.isDiverging) rigidityScore = 0.8;
  else rigidityScore = Math.max(0, Math.min(1, 0.5 - signals.momentum));

  return {
    analysis: {
      behavior: {
        concessionVelocity,
        momentum,
        rigidityScore
      }
    }
  };
};
