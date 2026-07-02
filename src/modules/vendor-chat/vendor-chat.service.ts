import { v4 as uuidv4 } from "uuid";
import { CustomError } from "../../utils/custom-error.js";
import logger from "../../config/logger.js";
import models from "../../models/index.js";
import env from "../../config/env.js";
import sequelize from "../../config/database.js";
import { sendPMQuoteNotificationEmail } from "../../services/email.service.js";
import {
  buildConfigFromRequisition,
  saveVendorMessageOnlyService,
  generatePMResponseAsyncService,
  syncContractStatus,
} from "../chatbot/chatbot.service.js";
import type { Contract } from "../../models/contract.js";
import type { ChatbotDeal } from "../../models/chatbot-deal.js";
import type { ChatbotMessage } from "../../models/chatbot-message.js";
import {
  formatCurrency,
  type SupportedCurrency,
} from "../../services/currency.service.js";
import {
  buildPaymentTermsPromptMessage,
  buildVendorPaymentTermsBubble,
  formatPaymentTermsLabel,
} from "./structured-prompts.js";
import { buildVendorOpeningIntro } from "./vendor-opening-greeting.js";
import { renderPmWelcomeMessage } from "../../llm/render-pm-welcome-message.js";
import { PM_WELCOME_ACTION } from "../chatbot/pipeline/decision-actions.js";

/**
 * Vendor Chat Service
 * Business logic for public vendor chat endpoints (no auth required)
 * All operations authenticated via uniqueToken
 */

export interface ContractDetails {
  products: Array<{
    productId: number;
    productName: string;
    quantity: number;
    quotedPrice: number | string;
    deliveryDate?: string;
  }>;
  additionalTerms?: {
    paymentTerms?: string;
    netPaymentDay?: number | string;
    prePaymentPercentage?: number | string;
    postPaymentPercentage?: number | string;
    additionalNotes?: string;
  };
}

export interface SubmitQuoteResult {
  contract: Contract;
  deal: ChatbotDeal | null;
  canEdit: boolean;
  chatUrl: string;
}

export interface CanEditQuoteResult {
  canEdit: boolean;
  reason: string;
}

export interface VendorDealData {
  deal: ChatbotDeal;
  messages: ChatbotMessage[];
  contract: Contract;
  requisition: {
    id: number;
    title: string;
    rfqNumber: string | null;
    products: Array<{
      id: number;
      name: string;
      quantity: number;
      unit: string | null;
    }>;
  };
  vendorQuote: ContractDetails | null;
  isVendor: true;
}

// ============================================================================
// Vendor-side response sanitizers (Apr 2026)
// ============================================================================
// The chatbot.service.ts pipeline is shared between buyer-side INSIGHTS chat
// and vendor-chat. Some of its outputs leak buyer-internal signals (stall
// probes, threshold metadata) that we must NOT show to the vendor.
//
// These helpers strip those signals before returning the live PM response.
// Historical messages get a similar scrub in getDealForVendor().

interface RawMeso {
  options?: any[];
  stallPrompt?: string | null;
  [k: string]: any;
}

function sanitizeMesoForVendor(meso: RawMeso | null | undefined): any | null {
  if (!meso) return null;
  // Drop the stall probe — it's a buyer-internal "is Net X a hard requirement
  // for your organization?" question that reads as the AI breaking character.
  const { stallPrompt: _stall, ...rest } = meso;
  return rest;
}

function sanitizeExplainabilityForVendor(
  explainability: any | null | undefined,
): any | null {
  if (!explainability) return null;
  const out: any = { ...explainability };
  // Strip the top-level stall-detection block.
  delete out.stallDetection;
  // Strip stallPrompt nested under meso.
  if (out.meso && typeof out.meso === "object") {
    out.meso = { ...out.meso };
    delete out.meso.stallPrompt;
  }
  // Belt-and-suspenders: PM thresholds/targets, same as the historical-
  // message sanitizer in getDealForVendor.
  delete out.config;
  delete out.thresholds;
  if (out.utilities && typeof out.utilities === "object") {
    out.utilities = { ...out.utilities };
    Object.keys(out.utilities).forEach((key) => {
      if (out.utilities[key]) {
        out.utilities[key] = { ...out.utilities[key] };
        delete out.utilities[key].target;
        delete out.utilities[key].max_acceptable;
        delete out.utilities[key].anchor;
      }
    });
  }
  return out;
}

/**
 * Find contract by unique token with all necessary associations
 */
const findContractByToken = async (
  uniqueToken: string,
): Promise<Contract | null> => {
  return models.Contract.findOne({
    where: { uniqueToken },
    include: [
      {
        model: models.Requisition,
        as: "Requisition",
        include: [
          {
            model: models.RequisitionProduct,
            as: "RequisitionProduct",
            include: [
              {
                model: models.Product,
                as: "Product",
              },
            ],
          },
          {
            model: models.Project,
            as: "Project",
          },
        ],
      },
      {
        model: models.User,
        as: "Vendor",
        attributes: ["id", "name", "email"],
      },
      {
        model: models.Company,
        as: "Company",
        attributes: ["id", "companyName"],
      },
    ],
  });
};

/**
 * Submit vendor quote - updates contract and notifies PM
 */
export const submitVendorQuote = async (
  uniqueToken: string,
  contractDetails: ContractDetails,
): Promise<SubmitQuoteResult> => {
  const transaction = await sequelize.transaction();

  try {
    // Find contract by token
    const contract = await findContractByToken(uniqueToken);
    if (!contract) {
      throw new CustomError("Contract not found", 404);
    }

    // Validate contract status allows quote submission
    // Allow 'Active' status if vendor hasn't submitted a quote yet (deal was created before vendor filled form)
    const allowedStatuses = ["Created", "Opened", "Active"];
    if (!allowedStatuses.includes(contract.status)) {
      throw new CustomError(
        "Quote has already been submitted for this contract",
        400,
      );
    }
    if (contract.status === "Active" && contract.contractDetails) {
      throw new CustomError(
        "Quote has already been submitted for this contract",
        400,
      );
    }

    // Update contract with quote
    await contract.update(
      {
        contractDetails: JSON.stringify(contractDetails),
        status: "InitialQuotation",
      },
      { transaction },
    );

    // Update requisition status if present
    if (contract.Requisition) {
      await contract.Requisition.update(
        { status: "InitialQuotation" },
        { transaction },
      );
    }

    // Find or create the chatbot deal
    let deal: ChatbotDeal | null = null;
    if (contract.chatbotDealId) {
      deal = await models.ChatbotDeal.findByPk(contract.chatbotDealId, {
        transaction,
      });
    }

    // Create chatbot deal if it doesn't exist
    if (!deal) {
      const vendorName = (contract as any).Vendor?.name || "Vendor";
      const requisitionTitle =
        (contract.Requisition as any)?.title || "Requisition";

      // Build negotiation config from requisition (target prices, thresholds, etc.)
      let negotiationConfig = null;
      if (contract.requisitionId) {
        try {
          negotiationConfig = await buildConfigFromRequisition(
            contract.requisitionId,
          );
          logger.info(
            `Built negotiation config from requisition ${contract.requisitionId} for vendor quote deal`,
          );
        } catch (configError) {
          logger.warn(
            `Failed to build config from requisition: ${(configError as Error).message}`,
          );
        }
      }

      deal = await models.ChatbotDeal.create(
        {
          id: uuidv4(),
          title: `${vendorName} - ${requisitionTitle}`,
          status: "NEGOTIATING",
          mode: "CONVERSATION",
          round: 0,
          requisitionId: contract.requisitionId,
          vendorId: contract.vendorId,
          contractId: contract.id,
          negotiationConfigJson: negotiationConfig,
          latestOfferJson: null,
          latestDecisionAction: null,
          latestUtility: null,
        },
        { transaction },
      );

      // Link the deal to the contract
      await contract.update({ chatbotDealId: deal.id }, { transaction });
    }

    await transaction.commit();

    // Reload contract to get updated data
    await contract.reload();

    // Send PM notification email (async, don't block response)
    sendPMQuoteNotificationEmail(contract, contractDetails).catch((err) => {
      logger.error("Failed to send PM quote notification email", {
        error: err.message,
      });
    });

    const chatUrl = `/vendor-chat/${uniqueToken}`;

    return {
      contract,
      deal,
      canEdit: true, // Can edit until first chat message
      chatUrl,
    };
  } catch (error) {
    await transaction.rollback();
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      `Failed to submit quote: ${(error as Error).message}`,
      500,
    );
  }
};

/**
 * Check if quote can be edited (no messages yet)
 */
export const canEditQuote = async (
  uniqueToken: string,
): Promise<CanEditQuoteResult> => {
  const contract = await findContractByToken(uniqueToken);
  if (!contract) {
    throw new CustomError("Contract not found", 404);
  }

  // Check if chatbot deal exists and has messages
  if (contract.chatbotDealId) {
    const messageCount = await models.ChatbotMessage.count({
      where: { dealId: contract.chatbotDealId },
    });

    if (messageCount > 0) {
      return {
        canEdit: false,
        reason: "Negotiation has started - quote cannot be modified",
      };
    }
  }

  // Check contract status
  // Allow editing only for: Created, Opened, InitialQuotation
  // Block editing for: Active (negotiating), Escalated, Accepted, Rejected, Completed, Verified, Expired
  const editableStatuses = ["Created", "Opened", "InitialQuotation"];
  if (!editableStatuses.includes(contract.status)) {
    return {
      canEdit: false,
      reason: "Contract status does not allow quote editing",
    };
  }

  return {
    canEdit: true,
    reason: "Quote can be edited",
  };
};

/**
 * Edit quote (only if no messages yet)
 */
export const editVendorQuote = async (
  uniqueToken: string,
  contractDetails: ContractDetails,
): Promise<Contract> => {
  const canEditResult = await canEditQuote(uniqueToken);
  if (!canEditResult.canEdit) {
    throw new CustomError(canEditResult.reason, 400);
  }

  const contract = await findContractByToken(uniqueToken);
  if (!contract) {
    throw new CustomError("Contract not found", 404);
  }

  await contract.update({
    contractDetails: JSON.stringify(contractDetails),
  });

  await contract.reload();
  return contract;
};

/**
 * Get deal data for vendor - STRIPS PM TARGETS
 */
export const getDealForVendor = async (
  uniqueToken: string,
): Promise<VendorDealData> => {
  const contract = await findContractByToken(uniqueToken);
  if (!contract) {
    throw new CustomError("Contract not found", 404);
  }

  if (!contract.chatbotDealId) {
    throw new CustomError("No negotiation deal found for this contract", 404);
  }

  const deal = await models.ChatbotDeal.findByPk(contract.chatbotDealId);
  if (!deal) {
    throw new CustomError("Deal not found", 404);
  }

  const messages = await models.ChatbotMessage.findAll({
    where: { dealId: deal.id },
    order: [["createdAt", "ASC"]],
  });

  // Build requisition data WITHOUT PM targets (hidden from vendors)
  const requisitionProducts = contract.Requisition?.RequisitionProduct || [];
  const requisition = {
    id: contract.Requisition?.id || 0,
    title: (contract.Requisition as any)?.title || "Untitled",
    rfqNumber: (contract.Requisition as any)?.rfqNumber || null,
    products: requisitionProducts.map((rp: any) => ({
      id: rp.Product?.id || rp.productId,
      name: rp.Product?.productName || "Unknown",
      quantity: rp.qty || 0,
      unit: rp.Product?.UOM || null,
      // NO minUnitPrice, NO batna, NO maxUnitPrice - hidden from vendors
    })),
  };

  // Parse vendor quote from contract
  let vendorQuote: ContractDetails | null = null;
  if (contract.contractDetails) {
    try {
      vendorQuote =
        typeof contract.contractDetails === "string"
          ? JSON.parse(contract.contractDetails)
          : contract.contractDetails;
    } catch {
      vendorQuote = null;
    }
  }

  // Sanitize messages - remove PM-specific data from explainability
  const sanitizedMessages = messages.map((msg) => {
    const msgJson = msg.toJSON() as any;
    if (msgJson.explainabilityJson) {
      msgJson.explainabilityJson = sanitizeExplainabilityForVendor(
        msgJson.explainabilityJson,
      );
    }
    return msgJson as ChatbotMessage;
  });

  return {
    deal,
    messages: sanitizedMessages,
    contract,
    requisition,
    vendorQuote,
    isVendor: true,
  };
};

async function resolveOrCreateDealForContract(
  contract: Contract,
): Promise<ChatbotDeal> {
  if (contract.chatbotDealId) {
    const existing = await models.ChatbotDeal.findByPk(contract.chatbotDealId);
    if (existing) {
      return existing;
    }
  }

  const vendorName = (contract as any).Vendor?.name || "Vendor";
  const requisitionTitle =
    (contract.Requisition as any)?.title || "Requisition";

  let negotiationConfig = null;
  if (contract.requisitionId) {
    try {
      negotiationConfig = await buildConfigFromRequisition(
        contract.requisitionId,
      );
    } catch (configError) {
      logger.warn(
        `Failed to build config from requisition: ${(configError as Error).message}`,
      );
    }
  }

  const deal = await models.ChatbotDeal.create({
    id: uuidv4(),
    title: `${vendorName} - ${requisitionTitle}`,
    status: "NEGOTIATING",
    mode: "CONVERSATION",
    round: 0,
    requisitionId: contract.requisitionId,
    vendorId: contract.vendorId,
    contractId: contract.id,
    negotiationConfigJson: negotiationConfig,
    latestOfferJson: null,
    latestDecisionAction: null,
    latestUtility: null,
  });

  await contract.update({ chatbotDealId: deal.id });
  return deal;
}

async function findPmWelcomeMessage(
  dealId: string,
): Promise<ChatbotMessage | null> {
  return models.ChatbotMessage.findOne({
    where: { dealId, role: "ACCORDO", decisionAction: PM_WELCOME_ACTION },
    order: [["createdAt", "ASC"]],
  });
}

async function findVendorOpeningMessage(
  dealId: string,
): Promise<ChatbotMessage | null> {
  return models.ChatbotMessage.findOne({
    where: { dealId, role: "VENDOR" },
    order: [["createdAt", "ASC"]],
  });
}

function parseContractVendorQuote(contract: Contract): ContractDetails {
  if (!contract.contractDetails) {
    throw new CustomError("No quote found - please submit a quote first", 400);
  }
  try {
    return typeof contract.contractDetails === "string"
      ? JSON.parse(contract.contractDetails)
      : contract.contractDetails;
  } catch {
    throw new CustomError("No quote found - please submit a quote first", 400);
  }
}

export const ensurePmWelcomeMessage = async (
  uniqueToken: string,
): Promise<{
  deal: ChatbotDeal;
  pmWelcomeMessage: ChatbotMessage;
  created: boolean;
}> => {
  const contract = await findContractByToken(uniqueToken);
  if (!contract) {
    throw new CustomError("Contract not found", 404);
  }

  const deal = await resolveOrCreateDealForContract(contract);
  const existing = await findPmWelcomeMessage(deal.id);
  if (existing) {
    return { deal, pmWelcomeMessage: existing, created: false };
  }

  const requisition = (contract as any).Requisition;
  const welcomeContent = await renderPmWelcomeMessage({
    dealId: deal.id,
    dealTitle: deal.title ?? undefined,
    requisitionTitle: requisition?.subject ?? requisition?.rfqId ?? undefined,
    buyerCompanyName: (contract as any).Company?.companyName ?? undefined,
    vendorName: (contract as any).Vendor?.name ?? undefined,
    productCategory: requisition?.category ?? undefined,
  });

  const welcomeId = uuidv4();
  const pmWelcomeMessage = await models.ChatbotMessage.create({
    id: welcomeId,
    dealId: deal.id,
    role: "ACCORDO",
    content: welcomeContent,
    extractedOffer: null,
    counterOffer: null,
    engineDecision: { action: PM_WELCOME_ACTION },
    decisionAction: PM_WELCOME_ACTION,
    utilityScore: null,
    explainabilityJson: null,
    round: 0,
  });

  await deal.update({ lastMessageAt: new Date() });
  return { deal, pmWelcomeMessage, created: true };
};

export const ensureVendorOpeningMessage = async (
  uniqueToken: string,
): Promise<{
  deal: ChatbotDeal;
  vendorOpeningMessage: ChatbotMessage;
  created: boolean;
}> => {
  const contract = await findContractByToken(uniqueToken);
  if (!contract) {
    throw new CustomError("Contract not found", 404);
  }

  const deal = await resolveOrCreateDealForContract(contract);
  const welcome = await findPmWelcomeMessage(deal.id);
  if (!welcome) {
    throw new CustomError(
      "PM welcome message must be sent before vendor opening",
      400,
    );
  }

  const existing = await findVendorOpeningMessage(deal.id);
  if (existing) {
    return { deal, vendorOpeningMessage: existing, created: false };
  }

  const vendorQuote = parseContractVendorQuote(contract);
  const requisitionCurrency =
    ((contract.Requisition as any)?.typeOfCurrency as SupportedCurrency) ||
    "USD";

  let grandTotal = 0;
  let totalUnits = 0;
  const productLines: string[] = [];

  vendorQuote.products.forEach((p) => {
    const unitPrice =
      typeof p.quotedPrice === "number"
        ? p.quotedPrice
        : parseFloat(p.quotedPrice as string) || 0;
    const quantity = p.quantity || 0;
    const lineTotal = unitPrice * quantity;
    grandTotal += lineTotal;
    totalUnits += quantity;
    const productName = p.productName || "Unnamed Product";
    productLines.push(
      `${productName}: ${quantity} units, total price = ${formatCurrency(lineTotal, requisitionCurrency)}`,
    );
  });

  const terms = vendorQuote.additionalTerms;
  let termsText = "";
  if (terms?.paymentTerms) {
    termsText += `\nPayment terms: ${terms.paymentTerms === "net_payment" ? `Net ${terms.netPaymentDay || 30} days` : "Advance/Post payment"}`;
  }

  const productBreakdownText =
    productLines.length > 0 ? `\n\n${productLines.join("\n")}` : "";
  const openingIntro = buildVendorOpeningIntro();
  const openingContent = `${openingIntro}\n\nUnits: ${totalUnits}\nTotal price: ${formatCurrency(grandTotal, requisitionCurrency)}${termsText}${productBreakdownText}\n\nI look forward to discussing the details.`;

  const paymentTermsStr =
    terms?.paymentTerms === "net_payment"
      ? `Net ${terms?.netPaymentDay || 30}`
      : null;
  const paymentDays =
    terms?.paymentTerms === "net_payment"
      ? Number(terms?.netPaymentDay || 30)
      : null;

  const openingMessageId = uuidv4();
  const { createAccumulatedOffer: createAccumulatedOfferForOpening } =
    await import("../chatbot/engine/offer-accumulator.js");
  const openingAccumulatedOffer = createAccumulatedOfferForOpening(
    {
      total_price: grandTotal,
      payment_terms: paymentTermsStr,
      payment_terms_days: paymentDays,
    } as any,
    openingMessageId,
  );

  const vendorOpeningMessage = await models.ChatbotMessage.create({
    id: openingMessageId,
    dealId: deal.id,
    role: "VENDOR",
    content: openingContent,
    extractedOffer: openingAccumulatedOffer as any,
    counterOffer: null,
    engineDecision: null,
    decisionAction: null,
    utilityScore: null,
    explainabilityJson: null,
    round: 1,
  });

  await deal.update({
    round: 1,
    latestVendorOffer: openingAccumulatedOffer as any,
    lastMessageAt: new Date(),
  });

  return { deal, vendorOpeningMessage, created: true };
};

/**
 * Vendor enters chat — ensures PM welcome (step 1 of thread bootstrap).
 */
export const vendorEnterChat = async (
  uniqueToken: string,
): Promise<{
  deal: ChatbotDeal;
  openingMessage: ChatbotMessage | null;
  pmWelcomeMessage: ChatbotMessage | null;
}> => {
  const result = await ensurePmWelcomeMessage(uniqueToken);
  return {
    deal: result.deal,
    openingMessage: null,
    pmWelcomeMessage: result.pmWelcomeMessage,
  };
};

/**
 * Vendor sends a message - Phase 1: Instant save
 */
export const vendorSendMessageInstant = async (
  uniqueToken: string,
  content: string,
): Promise<{ vendorMessage: ChatbotMessage; deal: ChatbotDeal }> => {
  const contract = await findContractByToken(uniqueToken);
  if (!contract) {
    throw new CustomError("Contract not found", 404);
  }

  if (!contract.chatbotDealId) {
    throw new CustomError("No negotiation deal found for this contract", 404);
  }

  const deal = await models.ChatbotDeal.findByPk(contract.chatbotDealId);
  if (!deal) {
    throw new CustomError("Deal not found", 404);
  }

  if (deal.status !== "NEGOTIATING") {
    throw new CustomError(
      `Cannot send message - negotiation is ${deal.status}`,
      400,
    );
  }

  // Parse offer from vendor message using the same parser as the chatbot engine
  // Import parseOfferWithDelivery to ensure consistent offer extraction
  // Pass requisition currency for proper conversion (February 2026)
  const { parseOfferWithDelivery } =
    await import("../chatbot/engine/parse-offer.js");
  const {
    mergeOffers,
    shouldResetAccumulation,
    createAccumulatedOffer,
    getProvidedComponents,
    getMissingComponents,
  } = await import("../chatbot/engine/offer-accumulator.js");

  const requisition = (contract as any).Requisition;
  const requisitionCurrency = requisition?.typeOfCurrency as
    | "USD"
    | "INR"
    | "EUR"
    | "GBP"
    | "AUD"
    | undefined;
  const parsedOffer = parseOfferWithDelivery(content, requisitionCurrency);

  // Accumulate offers across messages (price in msg1, terms in msg2, etc.)
  const vendorMessageId = uuidv4();
  const previousAccumulated = deal.latestVendorOffer as any;
  let accumulatedOffer: any;

  if (shouldResetAccumulation(parsedOffer)) {
    // Vendor provided complete offer (price + terms) - start fresh
    accumulatedOffer = createAccumulatedOffer(parsedOffer, vendorMessageId);
    logger.info(
      `[VendorChat] Complete offer detected, resetting accumulation for deal ${deal.id}`,
    );
  } else if (
    parsedOffer.total_price !== null ||
    parsedOffer.payment_terms !== null
  ) {
    // Partial offer - merge with previously accumulated state
    accumulatedOffer = mergeOffers(
      previousAccumulated,
      parsedOffer,
      vendorMessageId,
    );
    logger.info(`[VendorChat] Partial offer merged for deal ${deal.id}`, {
      provided: getProvidedComponents(parsedOffer),
      missing: getMissingComponents(accumulatedOffer),
      isComplete: accumulatedOffer?.accumulation?.isComplete,
    });
  } else {
    // No offer data in this message - keep previous accumulated state
    accumulatedOffer = previousAccumulated || null;
  }

  // Create vendor message with accumulated offer
  const vendorMessage = await models.ChatbotMessage.create({
    id: vendorMessageId,
    dealId: deal.id,
    role: "VENDOR",
    content,
    extractedOffer: accumulatedOffer || null,
    counterOffer: null,
    engineDecision: null,
    decisionAction: null,
    utilityScore: null,
    explainabilityJson: null,
    round: deal.round + 1,
  });

  // Update deal with latest accumulated vendor offer
  if (accumulatedOffer) {
    await deal.update({
      latestVendorOffer: accumulatedOffer as any,
      lastMessageAt: new Date(),
    });
  }

  return { vendorMessage, deal };
};

/**
 * Generate PM response - Phase 2: Async response generation
 * Uses the actual chatbot decision engine for real PM responses
 */
export const generatePMResponse = async (
  uniqueToken: string,
  vendorMessageId: string,
): Promise<{
  pmMessage: ChatbotMessage;
  decision: {
    action: "ACCEPT" | "COUNTER" | "ESCALATE" | "WALK_AWAY";
    utilityScore: number;
    counterOffer: any | null;
    reasons: string[];
  };
  deal: ChatbotDeal;
  meso: any | null;
  explainability: any | null;
}> => {
  const contract = await findContractByToken(uniqueToken);
  if (!contract) {
    throw new CustomError("Contract not found", 404);
  }

  if (!contract.chatbotDealId) {
    throw new CustomError("No negotiation deal found", 404);
  }

  const deal = await models.ChatbotDeal.findByPk(contract.chatbotDealId);
  if (!deal) {
    throw new CustomError("Deal not found", 404);
  }

  // Get vendor message
  const vendorMessage = await models.ChatbotMessage.findByPk(vendorMessageId);
  if (!vendorMessage) {
    throw new CustomError("Vendor message not found", 404);
  }

  try {
    // Use the LLM-enhanced async PM response service for human-like responses
    // This is the same service used by the PM's negotiation room
    const result = await generatePMResponseAsyncService({
      dealId: deal.id,
      vendorMessageId: vendorMessage.id,
      userId: 0, // Vendor messages don't have an authenticated user
    });

    // Reload deal to get updated state
    await deal.reload();

    // Build decision object from the result
    const pmDecision = {
      action: result.decision.action as
        | "ACCEPT"
        | "COUNTER"
        | "ESCALATE"
        | "WALK_AWAY",
      utilityScore: result.decision.utilityScore || 0,
      counterOffer: result.decision.counterOffer || null,
      reasons: result.decision.reasons || [],
    };

    // Sync contract status when deal reaches terminal state (belt-and-suspenders)
    if (["ACCEPTED", "WALKED_AWAY", "ESCALATED"].includes(deal.status)) {
      syncContractStatus(deal.id, deal.status, deal.contractId).catch((err) =>
        logger.error(
          `Failed to sync contract status from vendor-chat: ${(err as Error).message}`,
        ),
      );
    }

    logger.info(
      `Generated PM response for vendor chat: ${pmDecision.action} (utility: ${pmDecision.utilityScore})`,
      {
        hasMeso: !!result.meso,
        mesoOptions: result.meso?.options?.length || 0,
      },
    );

    // Vendor-side scrub (Apr 2026): strip buyer-internal signals before
    // sending the response to the vendor portal. The chatbot.service.ts
    // pipeline serves both buyer and vendor surfaces, so this happens at
    // the vendor-chat boundary.
    const sanitizedMeso = sanitizeMesoForVendor(result.meso);
    const sanitizedExplainability = sanitizeExplainabilityForVendor(
      result.explainability,
    );

    return {
      pmMessage: result.message,
      decision: pmDecision,
      deal,
      meso: sanitizedMeso, // Include MESO options for frontend
      explainability: sanitizedExplainability,
    };
  } catch (error) {
    logger.error("Failed to generate PM response via P0 pipeline", {
      error: (error as Error).message,
      stack: (error as Error).stack?.split("\n").slice(0, 5).join("\n"),
      dealId: deal.id,
      vendorMessageId,
    });
    throw error;
  }
};

// ============================================================================
// MESO + Others Flow Services (February 2026)
// ============================================================================

/**
 * Handle vendor MESO option selection - auto-accepts deal
 */
export const selectMesoOptionService = async (
  uniqueToken: string,
  selectedOptionId: string,
): Promise<{
  deal: ChatbotDeal;
  message: ChatbotMessage;
  selectedOffer: any;
}> => {
  const contract = await findContractByToken(uniqueToken);
  if (!contract) {
    throw new CustomError("Contract not found", 404);
  }

  if (!contract.chatbotDealId) {
    throw new CustomError("No negotiation deal found", 404);
  }

  const deal = await models.ChatbotDeal.findByPk(contract.chatbotDealId);
  if (!deal) {
    throw new CustomError("Deal not found", 404);
  }

  if (deal.status !== "NEGOTIATING") {
    throw new CustomError(
      `Cannot select offer - negotiation is ${deal.status}`,
      400,
    );
  }

  // Find the latest MESO round for this deal
  const mesoRound = await models.MesoRound.findOne({
    where: { dealId: deal.id },
    order: [["round", "DESC"]],
  });

  if (!mesoRound) {
    throw new CustomError("No MESO options available", 400);
  }

  const options = mesoRound.options as any[];
  const selectedOption = options.find(
    (opt: any) => opt.id === selectedOptionId,
  );

  if (!selectedOption) {
    throw new CustomError("Selected option not found", 400);
  }

  // Update MESO round with selection
  await mesoRound.update({
    selectedOptionId,
    vendorSelection: {
      selectedOptionId,
      selectedOffer: selectedOption.offer,
      selectedAt: new Date().toISOString(),
    },
  });

  // Create system message about selection
  const confirmationMessage = await models.ChatbotMessage.create({
    id: uuidv4(),
    dealId: deal.id,
    role: "SYSTEM",
    content: `Great, we'll go with "${selectedOption.label}". The deal is confirmed and we'll get the paperwork started on our end. Thanks for working through this with us.`,
    extractedOffer: null,
    counterOffer: selectedOption.offer,
    engineDecision: null,
    decisionAction: "ACCEPT",
    utilityScore: selectedOption.utility || null,
    explainabilityJson: null,
    round: deal.round,
  });

  // Update deal to ACCEPTED
  await deal.update({
    status: "ACCEPTED",
    latestOfferJson: selectedOption.offer,
    latestDecisionAction: "ACCEPT",
    latestUtility: selectedOption.utility || null,
  });

  await deal.reload();

  // Sync contract status
  syncContractStatus(deal.id, "ACCEPTED", deal.contractId).catch((err) =>
    logger.error(
      `Failed to sync contract status after MESO selection: ${(err as Error).message}`,
    ),
  );

  logger.info(
    `[MESO Selection] Vendor selected option ${selectedOptionId} for deal ${deal.id}`,
    {
      selectedLabel: selectedOption.label,
      selectedPrice: selectedOption.offer.total_price,
    },
  );

  return {
    deal,
    message: confirmationMessage,
    selectedOffer: selectedOption.offer,
  };
};

/**
 * Handle vendor "Others" form submission - submit custom price/terms
 */
export const submitOthersService = async (
  uniqueToken: string,
  totalPrice: number,
  paymentTermsDays: number,
): Promise<{
  vendorMessage: ChatbotMessage;
  pmMessage: ChatbotMessage;
  decision: any;
  deal: ChatbotDeal;
  meso: any | null;
}> => {
  const contract = await findContractByToken(uniqueToken);
  if (!contract) {
    throw new CustomError("Contract not found", 404);
  }

  if (!contract.chatbotDealId) {
    throw new CustomError("No negotiation deal found", 404);
  }

  const deal = await models.ChatbotDeal.findByPk(contract.chatbotDealId);
  if (!deal) {
    throw new CustomError("Deal not found", 404);
  }

  if (deal.status !== "NEGOTIATING") {
    throw new CustomError(
      `Cannot submit offer - negotiation is ${deal.status}`,
      400,
    );
  }

  // Create vendor message with the Others offer
  const othersCurrency =
    ((contract.Requisition as any)?.typeOfCurrency as SupportedCurrency) ||
    "USD";
  const paymentTermsStr = `Net ${paymentTermsDays}`;
  const offerContent = `I would like to propose a different offer: ${formatCurrency(totalPrice, othersCurrency)} total with ${paymentTermsStr} payment terms.`;

  const extractedOffer = {
    total_price: totalPrice,
    payment_terms: paymentTermsStr,
    payment_terms_days: paymentTermsDays,
  };

  const vendorMessage = await models.ChatbotMessage.create({
    id: uuidv4(),
    dealId: deal.id,
    role: "VENDOR",
    content: offerContent,
    extractedOffer,
    counterOffer: null,
    engineDecision: null,
    decisionAction: null,
    utilityScore: null,
    explainabilityJson: null,
    round: deal.round + 1,
  });

  // Update mesoCycleState to enter post-Others phase
  // This is critical - it tells shouldUseMeso() to NOT show MESO for the next 4 rounds
  const currentState = (deal.convoStateJson as any) || {};
  const currentMesoCycleState = currentState.mesoCycleState || {
    mesoCycleNumber: 1,
    lastMesoShownAtRound: deal.round,
    roundsInCurrentCycle: 0,
    othersSelectedCount: 0,
    inPostOthersPhase: false,
  };

  // Update the state for post-Others phase
  const updatedMesoCycleState = {
    ...currentMesoCycleState,
    inPostOthersPhase: true, // Enter post-Others phase
    roundsInCurrentCycle: 0, // Reset round counter for this cycle
    othersSelectedCount: (currentMesoCycleState.othersSelectedCount || 0) + 1,
  };

  // Store the Others offer in othersFormState
  const updatedOthersFormState = {
    lastOthersOffer: {
      totalPrice,
      paymentTermsDays,
      submittedAt: new Date().toISOString(),
    },
  };

  // Update deal with vendor offer AND updated negotiation state
  await deal.update({
    latestVendorOffer: extractedOffer as any,
    lastMessageAt: new Date(),
    convoStateJson: {
      ...currentState,
      mesoCycleState: updatedMesoCycleState,
      othersFormState: updatedOthersFormState,
      lastUpdatedAt: new Date().toISOString(),
    },
  });

  logger.info(
    `[Others Submission] Updated mesoCycleState for deal ${deal.id}`,
    {
      inPostOthersPhase: true,
      roundsInCurrentCycle: 0,
      othersSelectedCount: updatedMesoCycleState.othersSelectedCount,
    },
  );

  // Generate PM response - now shouldUseMeso() will see inPostOthersPhase=true
  const pmResult = await generatePMResponseAsyncService({
    dealId: deal.id,
    vendorMessageId: vendorMessage.id,
    userId: 0,
  });

  await deal.reload();

  logger.info(
    `[Others Submission] Vendor submitted Others offer for deal ${deal.id}`,
    {
      totalPrice,
      paymentTermsDays,
      decision: pmResult.decision.action,
    },
  );

  return {
    vendorMessage,
    pmMessage: pmResult.message,
    decision: pmResult.decision,
    deal,
    meso: pmResult.meso || null,
  };
};

/**
 * Handle vendor final offer confirmation response
 */
export const confirmFinalOfferService = async (
  uniqueToken: string,
  isConfirmedFinal: boolean,
): Promise<{
  pmMessage: ChatbotMessage;
  decision: any;
  deal: ChatbotDeal;
  meso: any | null;
}> => {
  const contract = await findContractByToken(uniqueToken);
  if (!contract) {
    throw new CustomError("Contract not found", 404);
  }

  if (!contract.chatbotDealId) {
    throw new CustomError("No negotiation deal found", 404);
  }

  const deal = await models.ChatbotDeal.findByPk(contract.chatbotDealId);
  if (!deal) {
    throw new CustomError("Deal not found", 404);
  }

  if (deal.status !== "NEGOTIATING") {
    throw new CustomError(
      `Cannot respond - negotiation is ${deal.status}`,
      400,
    );
  }

  // Create vendor response message
  const responseContent = isConfirmedFinal
    ? "Yes, this is my final offer. I cannot go lower than this price."
    : "No, I'm willing to continue negotiating and discuss other options.";

  const vendorMessage = await models.ChatbotMessage.create({
    id: uuidv4(),
    dealId: deal.id,
    role: "VENDOR",
    content: responseContent,
    extractedOffer: null,
    counterOffer: null,
    engineDecision: null,
    decisionAction: null,
    utilityScore: null,
    explainabilityJson: null,
    round: deal.round + 1,
  });

  // Update negotiation state for final offer confirmation
  const negotiationState = (deal.convoStateJson as any) || {};
  if (!negotiationState.finalOfferState) {
    negotiationState.finalOfferState = {};
  }
  negotiationState.finalOfferState.vendorConfirmedFinal = isConfirmedFinal;

  await deal.update({
    convoStateJson: negotiationState,
    lastMessageAt: new Date(),
  });

  // Generate PM response
  const pmResult = await generatePMResponseAsyncService({
    dealId: deal.id,
    vendorMessageId: vendorMessage.id,
    userId: 0,
  });

  await deal.reload();

  logger.info(
    `[Final Offer Confirmation] Vendor responded isConfirmedFinal=${isConfirmedFinal} for deal ${deal.id}`,
    {
      decision: pmResult.decision.action,
      hasMeso: !!pmResult.meso,
    },
  );

  return {
    pmMessage: pmResult.message,
    decision: pmResult.decision,
    deal,
    meso: pmResult.meso || null,
  };
};

// ============================================================================
// Feature 2 — Payment terms submission
// ============================================================================

/**
 * Handle the vendor's answer to the "ask for payment terms" dropdown prompt.
 * Persists a VENDOR message with the chosen payment_terms_days, updates the
 * accumulated offer on the deal, and runs the real engine with a now-complete
 * offer (price + terms).
 */
export const submitPaymentTermsService = async (
  uniqueToken: string,
  days: number,
): Promise<{
  vendorMessage: ChatbotMessage;
  pmMessage: ChatbotMessage;
  decision: {
    action: "ACCEPT" | "COUNTER" | "ESCALATE" | "WALK_AWAY";
    utilityScore: number;
    counterOffer: any | null;
    reasons: string[];
  };
  deal: ChatbotDeal;
  meso: any | null;
}> => {
  // Validate
  if (!Number.isFinite(days)) {
    throw new CustomError("Payment terms days must be a number", 400);
  }
  if (!Number.isInteger(days)) {
    throw new CustomError("Payment terms days must be a whole number", 400);
  }
  if (days !== 0 && (days < 1 || days > 365)) {
    throw new CustomError(
      "Payment terms days must be 0 (immediate) or between 1 and 365",
      400,
    );
  }

  const contract = await findContractByToken(uniqueToken);
  if (!contract) {
    throw new CustomError("Contract not found", 404);
  }
  if (!contract.chatbotDealId) {
    throw new CustomError("No negotiation deal found for this contract", 404);
  }

  const deal = await models.ChatbotDeal.findByPk(contract.chatbotDealId);
  if (!deal) {
    throw new CustomError("Deal not found", 404);
  }
  if (deal.status !== "NEGOTIATING") {
    throw new CustomError(
      `Cannot submit payment terms — negotiation is ${deal.status}`,
      400,
    );
  }

  // Verify the latest ACCORDO message is actually waiting on payment terms
  const latestAccordo = await models.ChatbotMessage.findOne({
    where: { dealId: deal.id, role: "ACCORDO" },
    order: [["createdAt", "DESC"]],
  });
  const latestPendingPrompt = (latestAccordo?.engineDecision as any)
    ?.pendingPrompt;
  if (!latestAccordo || latestPendingPrompt?.type !== "payment_terms") {
    throw new CustomError(
      "No payment terms prompt is pending for this deal",
      400,
    );
  }

  // Merge with the previously accumulated vendor offer (which has a price
  // but no terms — that's why we asked). Use mergeOffers so the result has a
  // valid `accumulation` block regardless of whether the previous baseline
  // was already an AccumulatedOffer or a plain Offer.
  const { mergeOffers, isAccumulatedOffer } =
    await import("../chatbot/engine/offer-accumulator.js");
  const vendorMessageId = uuidv4();
  const previousOffer = (deal.latestVendorOffer as any) || null;
  const previousAccumulated =
    previousOffer && isAccumulatedOffer(previousOffer) ? previousOffer : null;
  const mergedOffer = mergeOffers(
    previousAccumulated,
    {
      total_price: previousOffer?.total_price ?? null,
      payment_terms: formatPaymentTermsLabel(days),
      payment_terms_days: days,
      delivery_date: previousOffer?.delivery_date ?? null,
      delivery_days: previousOffer?.delivery_days ?? null,
    } as any,
    vendorMessageId,
  );

  // Persist the vendor's reply
  const vendorBubble = buildVendorPaymentTermsBubble(days);
  const newRound = deal.round + 1;
  const vendorMessage = await models.ChatbotMessage.create({
    id: vendorMessageId,
    dealId: deal.id,
    role: "VENDOR",
    content: vendorBubble,
    extractedOffer: mergedOffer as any,
    engineDecision: null,
    decisionAction: null,
    utilityScore: null,
    counterOffer: null,
    explainabilityJson: null,
    round: newRound,
  });

  await deal.update({
    latestVendorOffer: mergedOffer as any,
    round: newRound,
    lastMessageAt: new Date(),
  });

  logger.info(
    `[PaymentTerms] Vendor submitted ${formatPaymentTermsLabel(days)} for deal ${deal.id}`,
  );

  // Run the real engine — the offer is now complete (price + terms).
  const engineResult = await generatePMResponseAsyncService({
    dealId: deal.id,
    vendorMessageId: vendorMessage.id,
    userId: 0,
  });

  await deal.reload();

  const pmDecision = {
    action: engineResult.decision.action as
      | "ACCEPT"
      | "COUNTER"
      | "ESCALATE"
      | "WALK_AWAY",
    utilityScore: engineResult.decision.utilityScore || 0,
    counterOffer: engineResult.decision.counterOffer || null,
    reasons: engineResult.decision.reasons || [],
  };

  return {
    vendorMessage,
    pmMessage: engineResult.message,
    decision: pmDecision,
    deal,
    meso: engineResult.meso || null,
  };
};

export default {
  submitVendorQuote,
  canEditQuote,
  editVendorQuote,
  getDealForVendor,
  ensurePmWelcomeMessage,
  ensureVendorOpeningMessage,
  vendorEnterChat,
  vendorSendMessageInstant,
  generatePMResponse,
  selectMesoOptionService,
  submitOthersService,
  confirmFinalOfferService,
  submitPaymentTermsService,
};
