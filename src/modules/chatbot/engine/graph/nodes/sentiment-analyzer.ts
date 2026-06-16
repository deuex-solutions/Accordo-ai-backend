import { NegotiationState } from "../state.js";
import { detectVendorTone, detectVendorStyle } from "../../tone-detector.js";
import { analyzeBehavior as legacyAnalyzeBehavior } from "../../behavioral-analyzer.js";
import { extractVendorConcerns as legacyExtractVendorConcerns } from "../../concern-extractor.js";
import { parseOfferRegex } from "../../parse-offer.js";

/**
 * analyzeSentimentNode (Track 2: Yug)
 * 
 * @source src/modules/chatbot/engine/tone-detector.ts
 * @source src/modules/chatbot/engine/behavioral-analyzer.ts
 * @source src/modules/chatbot/engine/concern-extractor.ts
 * 
 * Synergy Mandate:
 * - Runs tone detection, behavioral analysis, and concern extraction in parallel.
 * - Extracts 11 style signals from detectVendorStyle.
 * - Map concerns to CATEGORY & PRIORITY as defined in the state contract.
 * - Computes global urgency level.
 */
export const analyzeSentimentNode = async (state: NegotiationState) => {
  const messages = state.messages || [];
  if (messages.length === 0) {
    return {
      analysis: {
        urgency: "LOW" as const,
      },
    };
  }

  // 1. Map messages to legacy formats
  const latestMessage = messages[messages.length - 1];
  const latestContent = typeof latestMessage.content === "string" 
    ? latestMessage.content 
    : JSON.stringify(latestMessage.content);

  const toneMessages = messages.map(m => {
    const role = m._getType() === "human" ? "VENDOR" as const : "ACCORDO" as const;
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    return { role, content };
  });

  const analyzableMessages = messages.map(m => {
    const role = m._getType() === "human" ? "VENDOR" as const : "ACCORDO" as const;
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    const offer = parseOfferRegex(content);
    const createdAt = (m.additional_kwargs?.timestamp as string | undefined) 
      || (state.metadata?.transitionTime as string | undefined)
      || new Date().toISOString();
    return {
      role,
      content,
      extractedOffer: role === "VENDOR" ? { total_price: offer.total_price || null } : undefined,
      counterOffer: role === "ACCORDO" ? { total_price: offer.total_price || null } : undefined,
      createdAt,
    };
  });

  const currentRound = state.round || 1;

  // 2. Parallel execution of agents
  const [toneDetectionResult, vendorStyleResult, behavioralResult, concernsResult] = await Promise.all([
    // Tone Analysis Agent
    Promise.resolve(detectVendorTone(toneMessages)),
    // Style Detection (for 11 signals)
    Promise.resolve(detectVendorStyle(latestContent, toneMessages)),
    // Behavioral Analysis Agent
    Promise.resolve(legacyAnalyzeBehavior(analyzableMessages, currentRound)),
    // Concern Extraction Agent
    Promise.resolve(legacyExtractVendorConcerns(toneMessages)),
  ]);

  // 3. Map Tone Analysis
  let mappedSentiment: "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "MIXED" = "NEUTRAL";
  if (behavioralResult.latestSentiment === "positive") {
    mappedSentiment = "POSITIVE";
  } else if (behavioralResult.latestSentiment === "resistant") {
    mappedSentiment = "NEGATIVE";
  }

  const tone = {
    sentiment: mappedSentiment,
    formality: vendorStyleResult.formality,
    urgency: toneDetectionResult.intensity, // Intensity/urgency
    styleSignals: {
      formality: vendorStyleResult.formality,
      length: vendorStyleResult.length,
      languageConfidence: vendorStyleResult.languageConfidence,
      hostility: vendorStyleResult.hostility ? 1 : 0,
      hasQuestion: vendorStyleResult.hasQuestion ? 1 : 0,
      isNumberOnly: vendorStyleResult.isNumberOnly ? 1 : 0,
      hasGreeting: vendorStyleResult.hasGreeting ? 1 : 0,
      repeatedOfferCount: vendorStyleResult.repeatedOfferCount,
      lastVendorPrice: vendorStyleResult.lastVendorPrice || 0,
      acceptanceDetected: vendorStyleResult.acceptanceDetected ? 1 : 0,
    },
  };

  // 4. Map Behavioral Analysis
  let velocityEnum: "FAST" | "STEADY" | "SLOW" | "STALLED" = "STEADY";
  if (behavioralResult.isStalling) {
    velocityEnum = "STALLED";
  } else if (behavioralResult.concessionVelocity > 2000) {
    velocityEnum = "FAST";
  } else if (behavioralResult.concessionVelocity > 500) {
    velocityEnum = "STEADY";
  } else {
    velocityEnum = "SLOW";
  }

  let mappedMomentum: "ACCELERATING" | "DECELERATING" | "STABLE" = "STABLE";
  if (behavioralResult.concessionAccelerating) {
    mappedMomentum = "ACCELERATING";
  } else if (velocityEnum === "SLOW" || behavioralResult.isStalling) {
    mappedMomentum = "DECELERATING";
  }

  const rigidityScore = behavioralResult.isStalling ? 0.8 : (behavioralResult.concessionVelocity === 0 ? 1.0 : 0.2);

  const behavior = {
    concessionVelocity: velocityEnum,
    momentum: mappedMomentum,
    rigidityScore,
  };

  // 5. Map Concerns
  const concerns = concernsResult.map(c => {
    let category: "PRICING" | "DELIVERY" | "QUALITY" | "PAYMENT_TERMS" | "OTHER" = "OTHER";
    if (c.type === "cost") category = "PRICING";
    else if (c.type === "timeline") category = "DELIVERY";
    else if (c.type === "quality") category = "QUALITY";
    else if (c.type === "payment") category = "PAYMENT_TERMS";

    const priority = c.confidence > 0.8 ? ("HIGH" as const) : c.confidence > 0.4 ? ("MEDIUM" as const) : ("LOW" as const);

    return {
      category,
      description: c.text,
      priority,
    };
  });

  // 6. Global Urgency level calculation
  let globalUrgency: "HIGH" | "MEDIUM" | "LOW" = "LOW";
  if (tone.urgency > 0.7 || toneDetectionResult.primaryTone === "urgent") {
    globalUrgency = "HIGH";
  } else if (tone.urgency > 0.3) {
    globalUrgency = "MEDIUM";
  }

  return {
    analysis: {
      tone,
      behavior,
      concerns,
      urgency: globalUrgency,
    },
  };
};
