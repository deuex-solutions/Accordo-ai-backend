/**
 * Procurement Manager System Prompt Builder
 *
 * Builds the system prompt for GPT-3.5 Turbo with full context about:
 * - Procurement manager persona (professional & formal)
 * - Deal configuration (prices, terms, delivery)
 * - Vendor history summary (if available)
 * - Negotiation guidelines
 */

import logger from '../../../config/logger.js';
import models from '../../../models/index.js';
import type { NegotiationConfig } from '../engine/utility.js';

export interface DealContext {
  dealId: string;
  title: string;
  vendorId?: number;
  vendorName?: string;
  vendorEmail?: string;
  requisitionId?: number;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  negotiationConfig: NegotiationConfig;
  wizardConfig?: {
    priceQuantity?: {
      targetUnitPrice: number;      // Now represents Total Target Price
      maxAcceptablePrice: number;   // Now represents Total Maximum Price
      minOrderQuantity: number;     // Total Order Quantity
      preferredQuantity?: number;
    };
    paymentTerms?: {
      minDays: number;
      maxDays: number;
    };
    delivery?: {
      requiredDate: string;
      preferredDate?: string;
      partialDelivery?: {
        allowed: boolean;
      };
    };
    contractSla?: {
      warrantyPeriod: string;
      lateDeliveryPenaltyPerDay: number;
    };
  };
}

export interface VendorHistorySummary {
  totalDeals: number;
  acceptedDeals: number;
  averageDiscount: number;
  lastDealDate: string | null;
  notes: string[];
}

/**
 * Get vendor history summary from past deals
 * UPDATED Feb 2026: Now uses total_price instead of unit_price
 */
export async function getVendorHistory(vendorId: number): Promise<VendorHistorySummary | null> {
  try {
    const pastDeals = await models.ChatbotDeal.findAll({
      where: {
        vendorId,
        status: ['ACCEPTED', 'WALKED_AWAY', 'ESCALATED'],
      },
      order: [['createdAt', 'DESC']],
      limit: 10,
    });

    if (pastDeals.length === 0) {
      return null;
    }

    const acceptedDeals = pastDeals.filter(d => d.status === 'ACCEPTED');
    const discounts: number[] = [];

    for (const deal of acceptedDeals) {
      const config = deal.negotiationConfigJson as NegotiationConfig | null;
      const lastOffer = deal.latestVendorOffer as { total_price?: number } | null;

      if (config?.parameters?.total_price && lastOffer?.total_price) {
        const target = config.parameters.total_price.target;
        const final = lastOffer.total_price;
        if (target > 0) {
          const discount = ((target - final) / target) * 100;
          discounts.push(discount);
        }
      }
    }

    const avgDiscount = discounts.length > 0
      ? discounts.reduce((a, b) => a + b, 0) / discounts.length
      : 0;

    return {
      totalDeals: pastDeals.length,
      acceptedDeals: acceptedDeals.length,
      averageDiscount: Math.round(avgDiscount * 100) / 100,
      lastDealDate: pastDeals[0]?.createdAt?.toISOString().split('T')[0] || null,
      notes: [],
    };
  } catch (error) {
    logger.error('[ProcurementPrompt] Failed to get vendor history', { vendorId, error });
    return null;
  }
}

/**
 * Build the system prompt for the Procurement Manager
 * UPDATED Feb 2026: Now uses total_price instead of unit_price
 */
export function buildSystemPrompt(
  context: DealContext,
  vendorHistory: VendorHistorySummary | null
): string {
  const { negotiationConfig, wizardConfig, priority, vendorName } = context;

  // Extract key parameters - now using total_price
  const targetPrice = negotiationConfig.parameters?.total_price?.target || wizardConfig?.priceQuantity?.targetUnitPrice || 0;
  const maxPrice = negotiationConfig.parameters?.total_price?.max_acceptable || wizardConfig?.priceQuantity?.maxAcceptablePrice || 0;
  const minPaymentDays = wizardConfig?.paymentTerms?.minDays || 30;
  const maxPaymentDays = wizardConfig?.paymentTerms?.maxDays || 60;
  const totalQuantity = wizardConfig?.priceQuantity?.minOrderQuantity || 0;

  // Build vendor history section
  let vendorHistorySection = '';
  if (vendorHistory) {
    vendorHistorySection = `
## Vendor History with ${vendorName || 'this vendor'}
- Previous negotiations: ${vendorHistory.totalDeals}
- Successfully closed deals: ${vendorHistory.acceptedDeals}
- Average discount achieved: ${vendorHistory.averageDiscount}%
- Last deal: ${vendorHistory.lastDealDate || 'N/A'}
${vendorHistory.notes.length > 0 ? `- Notes: ${vendorHistory.notes.join('; ')}` : ''}
`;
  }

  // Build priority-based negotiation style
  let negotiationStyle = '';
  switch (priority) {
    case 'HIGH':
      negotiationStyle = `
## Negotiation Priority: HIGH
- This is a critical procurement. Be firm but fair.
- Push for the best possible terms while maintaining professionalism.
- Do not easily concede on price or payment terms.
- Emphasize quality, reliability, and timely delivery requirements.
`;
      break;
    case 'MEDIUM':
      negotiationStyle = `
## Negotiation Priority: MEDIUM
- This is a standard procurement. Balance firmness with flexibility.
- Aim for target price but show reasonable flexibility.
- Consider trade-offs between price and other terms.
`;
      break;
    case 'LOW':
      negotiationStyle = `
## Negotiation Priority: LOW
- This is a routine procurement. Be efficient and cooperative.
- Acceptable to close quickly if terms are reasonable.
- Focus on building long-term vendor relationship.
`;
      break;
  }

  const systemPrompt = `You are an experienced Procurement Manager for a professional B2B organization named ACCORDO. Your role is to negotiate with vendors on behalf of your company to secure the best possible terms for goods and services.

## Your Persona
- **Tone**: Warm, direct, and professional
- **Style**: Clear, concise, and business-like communication
- **Approach**: Data-driven, fair but firm in negotiations
- **Goal**: Achieve optimal terms while maintaining positive vendor relationships

## Current Deal: ${context.title}
- Vendor: ${vendorName || 'Not specified'}
- Deal ID: ${context.dealId}
${totalQuantity > 0 ? `- Total Order Quantity: ${totalQuantity} units` : ''}

## Negotiation Parameters
- **Total Target Price**: $${targetPrice.toFixed(2)} (for the entire order)
- **Maximum Acceptable Total Price**: $${maxPrice.toFixed(2)}
- **Preferred Payment Terms**: ${minPaymentDays}-${maxPaymentDays} days
${wizardConfig?.delivery?.requiredDate ? `- **Required Delivery Date**: ${wizardConfig.delivery.requiredDate}` : ''}
${wizardConfig?.contractSla?.warrantyPeriod ? `- **Warranty Period**: ${wizardConfig.contractSla.warrantyPeriod}` : ''}
${wizardConfig?.contractSla?.lateDeliveryPenaltyPerDay ? `- **Late Delivery Penalty**: $${wizardConfig.contractSla.lateDeliveryPenaltyPerDay}/day` : ''}

${negotiationStyle}
${vendorHistorySection}

## Guidelines
1. **Always respond professionally** - Never be rude, condescending, or unprofessional.
2. **Stay within parameters** - Do not accept total prices above the maximum acceptable price.
3. **Negotiate systematically** - Start from target total price and make concessions gradually.
4. **Justify your position** - When pushing back, provide business rationale.
5. **Seek win-win outcomes** - Look for creative solutions that benefit both parties.
6. **Document key points** - Summarize agreements and next steps clearly.
7. **Be responsive** - Address all points raised by the vendor.
8. **Maintain relationship** - Even when rejecting offers, be respectful and keep doors open.
9. **Negotiate on TOTAL PRICE** - All price discussions should be about the total price for the entire order, not per-unit prices.

## Clarification Template (when total price or payment terms are missing)
If the vendor has not provided their total price or payment terms, use this warm & direct response:
"Thanks for getting back to us. Before we move forward, could you share the total price you're proposing along with your preferred payment terms?"

## Response Format
- Keep responses concise (2-4 paragraphs maximum)
- Use clear, direct language
- When making counter-offers, state the TOTAL PRICE explicitly (not unit price)
- End with a clear call-to-action or question when appropriate

Remember: You represent ACCORDO. Your communication reflects on the organization's professionalism and reputation.`;

  return systemPrompt;
}

/**
 * Build complete message array for OpenAI including system prompt
 */
export async function buildOpenAIMessages(
  context: DealContext,
  conversationHistory: Array<{ role: string; content: string }>
): Promise<Array<{ role: 'system' | 'user' | 'assistant'; content: string }>> {
  // Get vendor history if vendor is specified
  let vendorHistory: VendorHistorySummary | null = null;
  if (context.vendorId) {
    vendorHistory = await getVendorHistory(context.vendorId);
  }

  // Build system prompt
  const systemPrompt = buildSystemPrompt(context, vendorHistory);

  // Convert conversation history to OpenAI format
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ];

  for (const msg of conversationHistory) {
    // VENDOR messages become 'user' (from GPT's perspective, vendor is the user)
    // ACCORDO messages become 'assistant' (procurement manager responses)
    if (msg.role === 'VENDOR') {
      messages.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'ACCORDO') {
      messages.push({ role: 'assistant', content: msg.content });
    }
  }

  return messages;
}

export default {
  buildSystemPrompt,
  buildOpenAIMessages,
  getVendorHistory,
};
