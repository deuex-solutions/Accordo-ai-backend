import { NegotiationState, Offer } from "../state.js";
import { parseOfferRegex } from "../../parse-offer.js";
import { SupportedCurrency } from "../../../../../services/currency.service.js";

/**
 * OfferParsingAgent (Track 1: Vatsal)
 * 
 * @source src/modules/chatbot/engine/parse-offer.ts
 * 
 * Synergy Mandate (Logic Parity):
 * - Preserves K/M shorthand (29k, 1.5M)
 * - Preserves Regional number formats (US, EU, Indian Lakh/Crore)
 * - Preserves Currency detection and conversion
 * - Preserves Flexible payment terms (n45, net-45)
 * - Preserves Delivery date extraction (ASAP, explicit, relative)
 * 
 * This node acts as the "Eyes" of the negotiation, structuralizing the
 * raw vendor message into the parsedOffer state channel.
 */
export const offerParsingNode = async (state: NegotiationState) => {
  // 1. Extract the latest message from the vendor
  const messages = state.messages;
  if (!messages || messages.length === 0) {
    return {};
  }

  // Get the last message (assuming it's from the vendor for this turn)
  // In a real flow, we'd ensure we are only parsing 'human' (vendor) messages
  const lastMessage = messages[messages.length - 1];
  
  if (lastMessage._getType() !== "human") {
    // If the last message wasn't from the vendor, there's no new offer to parse
    return {};
  }

  const rawText = typeof lastMessage.content === "string" 
    ? lastMessage.content 
    : JSON.stringify(lastMessage.content);

  // 2. Determine requisition currency from config (if available)
  const reqCurrency = state.config?.currency as SupportedCurrency | undefined;

  // 3. Call the legacy parser to guarantee 100% logic parity
  const legacyParsedOffer = parseOfferRegex(rawText, reqCurrency);

  // 4. Transform to the new graph Offer interface
  const newOffer: Offer = {
    totalPrice: legacyParsedOffer.total_price || null,
    paymentTerms: legacyParsedOffer.payment_terms || null,
    paymentTermsDays: legacyParsedOffer.payment_terms_days || null,
    deliveryDate: legacyParsedOffer.delivery_date || null,
    deliveryDays: legacyParsedOffer.delivery_days || null,
    customParameters: legacyParsedOffer.meta ? { meta: legacyParsedOffer.meta } : undefined,
  };

  // Only update state if we actually found something meaningful
  if (newOffer.totalPrice !== null || newOffer.paymentTerms !== null || newOffer.deliveryDate !== null) {
    return {
      parsedOffer: newOffer,
      metadata: {
        ...state.metadata,
        lastParsedMessageId: lastMessage.id,
      }
    };
  }

  return {}; // No offer detected in this message
};
