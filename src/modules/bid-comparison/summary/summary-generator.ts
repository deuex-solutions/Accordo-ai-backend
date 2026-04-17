import { ChatSummaryMetrics } from '../../../models/vendor-bid.js';
import llmService from '../../../services/llm.service.js';
import logger from '../../../config/logger.js';

interface DealData {
  id: string;
  title: string;
  counterparty: string | null;
  status: string;
  round: number;
  latestUtility: number | null;
  latestVendorOffer: any;
}

interface MessageData {
  id: string;
  role: string;
  content: string;
  extractedOffer: any;
  counterOffer: any;
  utilityScore: number | null;
  decisionAction: string | null;
  createdAt: Date;
}

/**
 * Generate structured metrics summary from negotiation data
 */
export async function generateMetricsSummary(
  deal: DealData,
  messages: MessageData[]
): Promise<ChatSummaryMetrics> {
  const vendorMessages = messages.filter((m) => m.role === 'VENDOR');
  const accordoMessages = messages.filter((m) => m.role === 'ACCORDO');

  // Extract price progression
  const prices: number[] = [];
  let initialPrice: number | null = null;
  let finalPrice: number | null = null;
  let initialPaymentTerms: string | null = null;
  let finalPaymentTerms: string | null = null;

  for (const msg of vendorMessages) {
    const offer = msg.extractedOffer;
    if (offer && offer.unit_price) {
      const price = Number(offer.unit_price);
      if (!isNaN(price)) {
        if (initialPrice === null) {
          initialPrice = price;
          initialPaymentTerms = offer.payment_terms || null;
        }
        finalPrice = price;
        finalPaymentTerms = offer.payment_terms || null;
        prices.push(price);
      }
    }
  }

  // Calculate price reduction
  let priceReductionPercent: number | null = null;
  if (initialPrice && finalPrice && initialPrice > 0) {
    priceReductionPercent = ((initialPrice - finalPrice) / initialPrice) * 100;
  }

  // Extract key decisions
  const keyDecisions: Array<{ round: number; action: string; utilityScore: number }> = [];
  for (const msg of accordoMessages) {
    if (msg.decisionAction && msg.utilityScore !== null) {
      keyDecisions.push({
        round: keyDecisions.length + 1,
        action: msg.decisionAction,
        utilityScore: Number(msg.utilityScore),
      });
    }
  }

  // Calculate average utility
  let averageUtilityScore: number | null = null;
  if (keyDecisions.length > 0) {
    const sum = keyDecisions.reduce((acc, d) => acc + d.utilityScore, 0);
    averageUtilityScore = sum / keyDecisions.length;
  }

  // Calculate negotiation duration
  let negotiationDurationHours: number | null = null;
  if (messages.length >= 2) {
    const firstMessage = messages[0];
    const lastMessage = messages[messages.length - 1];
    const durationMs = new Date(lastMessage.createdAt).getTime() - new Date(firstMessage.createdAt).getTime();
    negotiationDurationHours = durationMs / (1000 * 60 * 60);
  }

  return {
    totalRounds: deal.round,
    initialPrice,
    finalPrice,
    priceReductionPercent: priceReductionPercent !== null ? Number(priceReductionPercent.toFixed(2)) : null,
    initialPaymentTerms,
    finalPaymentTerms,
    keyDecisions: keyDecisions.slice(-5), // Keep last 5 decisions
    negotiationDurationHours: negotiationDurationHours !== null ? Number(negotiationDurationHours.toFixed(2)) : null,
    averageUtilityScore: averageUtilityScore !== null ? Number(averageUtilityScore.toFixed(4)) : null,
  };
}

/**
 * Generate narrative summary using LLM
 */
export async function generateNarrativeSummary(
  deal: DealData,
  messages: MessageData[]
): Promise<string> {
  // Build conversation context
  const conversationSummary = messages
    .slice(-10) // Last 10 messages for context
    .map((m) => {
      const role = m.role === 'VENDOR' ? 'Vendor' : m.role === 'ACCORDO' ? 'Buyer' : 'System';
      let summary = `${role}: ${m.content.slice(0, 200)}`;
      if (m.extractedOffer) {
        summary += ` [Offer: $${m.extractedOffer.unit_price || 'N/A'}, ${m.extractedOffer.payment_terms || 'N/A'}]`;
      }
      if (m.decisionAction) {
        summary += ` [Decision: ${m.decisionAction}]`;
      }
      return summary;
    })
    .join('\n');

  const systemPrompt = `You are an expert at summarizing business negotiations.
Generate a brief, professional summary (2-3 sentences) of the following procurement negotiation.
Focus on: the key points of negotiation, final outcome, and any notable concessions made.
Keep it factual and neutral in tone.`;

  const userPrompt = `Negotiation Summary:
- Deal: ${deal.title}
- Vendor: ${deal.counterparty || 'Unknown'}
- Final Status: ${deal.status}
- Total Rounds: ${deal.round}
- Final Utility Score: ${deal.latestUtility !== null ? (Number(deal.latestUtility) * 100).toFixed(1) + '%' : 'N/A'}

Conversation Highlights:
${conversationSummary}

Please provide a brief summary of this negotiation.`;

  try {
    const response = await llmService.chatCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], {
      temperature: 0.3,
      maxTokens: 200,
    });

    return response.trim();
  } catch (error) {
    logger.warn(`LLM summary generation failed: ${(error as Error).message}`);
    // Fallback to basic summary
    return generateFallbackSummary(deal, messages);
  }
}

/**
 * Generate a basic fallback summary without LLM
 */
function generateFallbackSummary(deal: DealData, messages: MessageData[]): string {
  const vendorMessages = messages.filter((m) => m.role === 'VENDOR');
  const lastVendorOffer = vendorMessages[vendorMessages.length - 1]?.extractedOffer;

  let summary = `Negotiation with ${deal.counterparty || 'vendor'} `;

  if (deal.status === 'ACCEPTED') {
    summary += `concluded successfully after ${deal.round} rounds. `;
    if (lastVendorOffer?.unit_price) {
      summary += `Final agreed price: $${lastVendorOffer.unit_price}`;
      if (lastVendorOffer.payment_terms) {
        summary += ` with ${lastVendorOffer.payment_terms} payment terms`;
      }
      summary += '.';
    }
  } else if (deal.status === 'WALKED_AWAY') {
    summary += `ended without agreement after ${deal.round} rounds. `;
    summary += 'The parties were unable to reach mutually acceptable terms.';
  } else if (deal.status === 'ESCALATED') {
    summary += `was escalated for human review after ${deal.round} rounds. `;
    summary += 'Further evaluation is required before a decision can be made.';
  } else {
    summary += `is ongoing with ${deal.round} rounds completed.`;
  }

  return summary;
}
