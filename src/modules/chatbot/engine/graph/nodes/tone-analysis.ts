import { NegotiationState } from "../state.js";
import toneDetector, { ToneMessage, VendorTone } from "../../tone-detector.js";
import { BaseMessage } from "@langchain/core/messages";

/**
 * ToneAnalysisAgent (Track 2: Yug)
 * 
 * @source src/modules/chatbot/engine/tone-detector.ts
 * 
 * Synergy Mandate (Logic Parity):
 * - Extracts 11 style signals
 * - Implements formality detection
 * - Implements urgency detection
 * - Ports sentiment classification based on tone detection
 */
export const toneAnalysisNode = async (state: NegotiationState) => {
  const messages = state.messages;
  if (!messages || messages.length === 0) {
    return {};
  }

  // Convert LangChain messages to ToneMessage format for the legacy parser
  const toneMessages: ToneMessage[] = messages.map((m: BaseMessage) => {
    let role: "VENDOR" | "ACCORDO" | "SYSTEM" = "SYSTEM";
    if (m._getType() === "human") role = "VENDOR";
    else if (m._getType() === "ai") role = "ACCORDO";

    return {
      role,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content)
    };
  });

  const vendorMessages = toneMessages.filter(m => m.role === "VENDOR");
  if (vendorMessages.length === 0) {
    return {};
  }

  const latestVendorMessage = vendorMessages[vendorMessages.length - 1].content;

  // 1. Get vendor style (the 11 signals)
  const style = toneDetector.detectVendorStyle(latestVendorMessage, toneMessages);

  // 2. Get overall tone based on all history
  const toneResult = toneDetector.detectVendorTone(toneMessages);

  // 3. Extract Urgency (0-1)
  let urgency = 0;
  if (toneResult.allTones.urgent) {
    // Normalizing urgent score to 0-1 range. In legacy code, an urgent pattern adds ~2 points.
    // 5 points is considered highly urgent.
    urgency = Math.min(1.0, toneResult.allTones.urgent / 5);
  }

  // 4. Determine Sentiment
  let sentiment: "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "MIXED" = "NEUTRAL";
  if (style.hostility) {
    sentiment = "NEGATIVE";
  } else if (toneResult.primaryTone === "friendly") {
    sentiment = "POSITIVE";
  } else if (toneResult.primaryTone === "firm") {
    sentiment = "NEGATIVE";
  } else if (toneResult.primaryTone === "formal" || toneResult.primaryTone === "casual") {
    sentiment = "NEUTRAL";
  }
  
  if (toneResult.allTones.friendly && toneResult.allTones.firm) {
    if (toneResult.allTones.friendly > 1 && toneResult.allTones.firm > 1) {
       sentiment = "MIXED";
    }
  }

  // 5. Structure the 11 style signals
  const styleSignals: Record<string, number> = {
    formality: style.formality,
    length: style.length,
    languageConfidence: style.languageConfidence,
    hostility: style.hostility ? 1 : 0,
    hasQuestion: style.hasQuestion ? 1 : 0,
    isNumberOnly: style.isNumberOnly ? 1 : 0,
    hasGreeting: style.hasGreeting ? 1 : 0,
    repeatedOfferCount: style.repeatedOfferCount,
    lastVendorPrice: style.lastVendorPrice || 0,
    acceptanceDetected: style.acceptanceDetected ? 1 : 0,
  };

  return {
    analysis: {
      tone: {
        sentiment,
        formality: style.formality,
        urgency,
        styleSignals
      }
    }
  };
};
