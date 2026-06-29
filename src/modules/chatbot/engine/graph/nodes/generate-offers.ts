import { NegotiationState, Offer } from "../state.js";
import { NodeName } from "../types.js";
import { generateMesoOptions } from "../../meso.js";
import { getVendorProfileSummary } from "../../vendor-profile-service.js";
import { trackOffer, detectStallPattern, ParameterHistory, shouldAskFinalOffer } from "../../stall-detector.js";
import { parseOfferRegex } from "../../parse-offer.js";
import logger from "../../../../../config/logger.js";
import { ExtendedOffer } from "../../types.js";

/**
 * Maps our internal ExtendedOffer to the State's Offer format
 */
const mapToStateOffer = (extOffer: ExtendedOffer): Offer => ({
  totalPrice: extOffer.total_price || null,
  paymentTerms: extOffer.payment_terms || null,
  paymentTermsDays: extOffer.payment_terms_days || null,
  deliveryDays: extOffer.delivery_days || null,
  warrantyMonths: extOffer.warranty_months || null,
  partialDelivery: extOffer.partial_delivery_allowed || null
});

/**
 * GenerateOffersNode (Track 3: Adarsh)
 * 
 * Orchestrates Vendor Profiling, Stall Recovery, and MESO generation
 * to build the counter-offer strategy.
 */
export const generateOffersNode = async (state: NegotiationState) => {
  logger.info(`[Node: ${NodeName.GENERATE_OFFERS}] Generating counter-offers and strategy...`);

  const updates: Partial<NegotiationState> = {};

  // 1. Fetch Vendor Profile if vendorId is present
  if (state.vendorId) {
    try {
      const profile = await getVendorProfileSummary(state.vendorId);
      if (profile) {
        updates.vendorProfile = profile;
      }
    } catch (err) {
      logger.warn(`[Node: ${NodeName.GENERATE_OFFERS}] Failed to fetch vendor profile`, err);
    }
  }

  // 2. Track Offers & Detect Stalls
  let histories: ParameterHistory[] = [];
  let roundIdx = 1;
  const reqCurrency = state.config?.currency;
  for (const m of state.messages || []) {
    if (m._getType() === "human") {
       const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
       const parsed = parseOfferRegex(text, reqCurrency);
       if (parsed.total_price != null || parsed.payment_terms_days != null || parsed.delivery_days != null) {
         const extOffer: ExtendedOffer = {
           total_price: parsed.total_price ?? null,
           payment_terms: parsed.payment_terms ?? null,
           payment_terms_days: parsed.payment_terms_days ?? null,
           delivery_days: parsed.delivery_days ?? null,
           warranty_months: null
         };
         histories = trackOffer(histories, extOffer, roundIdx);
         roundIdx++;
       }
    }
  }

  const stallAnalysis = detectStallPattern(histories, 3);
  const prompt = shouldAskFinalOffer(histories, state.round || 1, 3);

  let momentumTrend: "UP" | "DOWN" | "STABLE" = "STABLE";
  if (state.analysis?.behavior?.momentum === "ACCELERATING") momentumTrend = "UP";
  if (state.analysis?.behavior?.momentum === "DECELERATING") momentumTrend = "DOWN";

  updates.stallStatus = {
    isStalled: stallAnalysis.isStalled,
    roundsWithoutProgress: stallAnalysis.isStalled && stallAnalysis.pattern ? stallAnalysis.pattern.consecutiveRounds : 0,
    momentumTrend
  };

  // 3. Generate MESO / Counter Offers if Decision is COUNTER
  // If no decision yet, assume we need to counter (fallback)
  const isCounter = !state.decision || state.decision.action === "COUNTER";

  if (isCounter && state.parsedOffer && state.config) {
    const extVendorOffer: ExtendedOffer = {
      total_price: state.parsedOffer.totalPrice ?? null,
      payment_terms: state.parsedOffer.paymentTerms ?? null,
      payment_terms_days: state.parsedOffer.paymentTermsDays ?? null,
      delivery_days: state.parsedOffer.deliveryDays ?? null,
      warranty_months: state.parsedOffer.warrantyMonths ?? null
    };

    // Extract last accordo counter price from history or decision if available
    let lastAccordoCounterPrice: number | null = null;
    const decAny = state.decision as any;
    if (decAny?.counterOffer) {
      lastAccordoCounterPrice = decAny.counterOffer.total_price ?? decAny.counterOffer.totalPrice ?? null;
    }
    if (!lastAccordoCounterPrice && state.counterOffer) {
      lastAccordoCounterPrice = (state.counterOffer as any).totalPrice ?? (state.counterOffer as any).total_price ?? null;
    }

    try {
      // Call MESO generator with dynamic currency and last counter price
      const mesoResult = generateMesoOptions(
        state.config,
        extVendorOffer,
        state.round || 1,
        0.65,
        (state.config?.currency as any) || "INR",
        lastAccordoCounterPrice
      );

      if (mesoResult.success && mesoResult.options.length > 0) {
        // Map back to State format
        updates.mesoOptions = mesoResult.options.map(opt => mapToStateOffer(opt.offer));
        // Use the first MESO option as the primary counterOffer
        updates.counterOffer = mapToStateOffer(mesoResult.options[0].offer);
      } else {
        console.log("MESO FAILED:", mesoResult);
      }
    } catch (err) {
      logger.error(`[Node: ${NodeName.GENERATE_OFFERS}] MESO generation failed`, err);
    }
  }

  return updates;
};
