import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { Op } from "sequelize";
import { CustomError } from "../../utils/custom-error.js";
import logger from "../../config/logger.js";
import models from "../../models/index.js";
import sequelize from "../../config/database.js";
import {
  parseOfferRegex,
  parseOfferWithDelivery,
} from "./engine/parse-offer.js";
import {
  generateHumanLikeResponse,
  generateQuickFallback,
} from "./engine/response-generator.js";
import {
  decideNextMove,
  extractVendorMaxTermsDays,
  capTermsToVendorMax,
} from "./engine/decide.js";
import {
  computeExplainability,
  totalUtility,
  type NegotiationConfig,
} from "./engine/utility.js";
import {
  formatCurrency,
  type SupportedCurrency,
} from "../../services/currency.service.js";
import {
  getCurrencySymbol,
  buildNegotiationIntent,
  type NegotiationIntent,
} from "../../negotiation/intent/build-negotiation-intent.js";
import {
  validateLlmOutput,
  ValidationError,
  sanitizeText,
} from "../../llm/validate-llm-output.js";
import { getFallbackResponse } from "../../llm/fallback-templates.js";
import type {
  Offer,
  Decision,
  Explainability,
  WeightedUtilityResult,
  ParsedVendorOffer,
  AccumulatedOffer,
  NegotiationState,
  BehavioralSignals,
  AdaptiveStrategyResult,
  AdaptiveFeaturesConfig,
  MesoCycleState,
  FinalOfferState,
  NegotiationPhase,
  ExtendedOffer,
} from "./engine/types.js";
import {
  createEmptyNegotiationState,
  createEmptyMesoCycleState,
  createEmptyFinalOfferState,
} from "./engine/types.js";
import {
  analyzeBehavior,
  computeAdaptiveStrategy,
} from "./engine/behavioral-analyzer.js";
import {
  getHistoricalInsights,
  adjustAnchorFromHistory,
} from "./engine/historical-analyzer.js";
import {
  mergeOffers,
  shouldResetAccumulation,
  createAccumulatedOffer,
  isOfferComplete,
  getMissingComponents,
  getProvidedComponents,
} from "./engine/offer-accumulator.js";
import {
  updateNegotiationState,
  getLastPmCounter,
  detectMesoSelectionFromMessage,
  recordMesoSelection,
  isInPreferenceExploration,
  getPreferenceExplorationRoundsRemaining,
  recordUtilityScore,
} from "./engine/preference-detector.js";
import type { DeliveryConfig } from "./engine/delivery-utility.js";
import {
  calculateWeightedUtility,
  convertLegacyConfig,
  getUtilitySummary,
  extractValueFromOffer,
} from "./engine/weighted-utility.js";
import { DEFAULT_THRESHOLDS } from "./engine/types.js";
import type { ChatbotDeal } from "../../models/chatbot-deal.js";
import type { ChatbotMessage } from "../../models/chatbot-message.js";
import { chatCompletion } from "../../services/llm.service.js";
import {
  captureVendorBid,
  checkAndTriggerComparison,
} from "../bid-comparison/bid-comparison.service.js";
import {
  sendDealCreatedEmail,
  sendContinuedNegotiationEmail,
  sendPmDealStatusNotificationEmail,
  sendDealSummaryPDFEmail,
} from "../../services/email.service.js";
import {
  generateDealSummaryPDF,
  generatePDFFilename,
  type DealSummaryPDFInput,
} from "./pdf/deal-summary-pdf-generator.js";
import {
  updateProfileAfterDeal,
  type DealOutcome,
} from "./engine/vendor-profile-service.js";
import {
  generateMesoOptions,
  generateDynamicMesoOptions,
  generateFinalMesoOptions,
  shouldUseMeso,
  shouldTriggerFinalMeso,
  generateMesoFromVendorPrice,
  updateMesoCycleStateOnShow,
  updateMesoCycleStateOnOthersSelection,
  incrementPostOthersRound,
  updateFinalOfferStateOnConfirm,
  updateFinalOfferStateOnMesoShown,
  checkEscalationTriggers,
  MESO_PHASE_CONFIG,
  type MesoResult,
  type MesoOption,
  type PreviousMesoRound,
  type ShouldUseMesoParams,
  type ShouldUseMesoResult,
} from "./engine/meso.js";
import { resolveNegotiationConfig } from "./engine/weighted-utility.js";
import {
  shouldAskFinalOffer,
  trackOffer,
  type ParameterHistory,
} from "./engine/stall-detector.js";
import { checkScopeGuard } from "./engine/scope-guard.js";
import {
  buildPartialResult,
  classifyError,
  getErrorFallbackResponse,
} from "./engine/error-recovery.js";
import { sanitizeNegotiationHistory } from "./engine/history-sanitizer.js";

// ============================================================================
// Contract-Deal Status Sync
// ============================================================================

import type { ContractStatus } from "../../models/contract.js";

type DealStatusForSync =
  | "NEGOTIATING"
  | "ACCEPTED"
  | "WALKED_AWAY"
  | "ESCALATED";

const dealToContractStatusMap: Record<DealStatusForSync, ContractStatus> = {
  NEGOTIATING: "Active",
  ACCEPTED: "Accepted",
  WALKED_AWAY: "Rejected",
  ESCALATED: "Escalated",
};

/**
 * Sync contract status based on deal status change
 * Called when deal reaches a terminal state or starts negotiating
 *
 * Status Mapping:
 * - NEGOTIATING → Active
 * - ACCEPTED → Accepted
 * - WALKED_AWAY → Rejected
 * - ESCALATED → Escalated
 */
export async function syncContractStatus(
  dealId: string,
  dealStatus: DealStatusForSync,
  contractId: number | null,
): Promise<void> {
  if (!contractId) return;

  const newContractStatus = dealToContractStatusMap[dealStatus];
  if (!newContractStatus) return;

  await models.Contract.update(
    { status: newContractStatus },
    { where: { id: contractId } },
  );

  logger.info(
    `[ContractSync] Contract ${contractId} status updated to ${newContractStatus} (deal: ${dealId}, dealStatus: ${dealStatus})`,
  );
}

// ============================================================================
// Vendor Profile Learning
// ============================================================================

/**
 * Update vendor negotiation profile after deal completion
 * Extracts deal outcome data and updates persistent profile
 */
async function updateVendorProfileOnDealCompletion(
  dealId: string,
  finalStatus: "ACCEPTED" | "WALKED_AWAY" | "ESCALATED",
  vendorId: number | null,
): Promise<void> {
  if (!vendorId) {
    logger.debug(
      `[VendorProfile] No vendor ID for deal ${dealId}, skipping profile update`,
    );
    return;
  }

  try {
    // Get deal with messages
    const deal = await models.ChatbotDeal.findByPk(dealId, {
      include: [
        {
          model: models.ChatbotMessage,
          as: "messages",
          order: [["createdAt", "ASC"]],
        },
      ],
    });

    if (!deal) {
      logger.error(`[VendorProfile] Deal ${dealId} not found`);
      return;
    }

    // Extract concession history from messages
    const concessionHistory: DealOutcome["concessionHistory"] = [];
    let previousPrice: number | null = null;

    const messages = (deal as any).messages || [];
    for (const msg of messages) {
      if (msg.role === "VENDOR" && msg.extractedOffer) {
        const offer = msg.extractedOffer as any;
        const currentPrice = offer.total_price || offer.price;
        if (currentPrice && previousPrice) {
          const priceChange =
            ((previousPrice - currentPrice) / previousPrice) * 100;
          concessionHistory.push({
            round: msg.round || concessionHistory.length + 1,
            priceChange,
            timestamp: new Date(msg.createdAt),
          });
        }
        previousPrice = currentPrice;
      }
    }

    // Extract final terms from latest offer
    const latestOffer = deal.latestVendorOffer as any;
    const finalTerms: DealOutcome["finalTerms"] = {};

    if (latestOffer) {
      // Parse payment terms days
      if (latestOffer.payment_terms) {
        const match = latestOffer.payment_terms.match(/Net\s*(\d+)/i);
        if (match) finalTerms.paymentTermsDays = parseInt(match[1], 10);
      }
      if (latestOffer.payment_terms_days) {
        finalTerms.paymentTermsDays = latestOffer.payment_terms_days;
      }
      if (latestOffer.advance_payment_percent !== undefined) {
        finalTerms.advancePaymentPercent = latestOffer.advance_payment_percent;
      }
      if (latestOffer.delivery_days !== undefined) {
        finalTerms.deliveryDays = latestOffer.delivery_days;
      }
      if (latestOffer.warranty_months !== undefined) {
        finalTerms.warrantyMonths = latestOffer.warranty_months;
      }
    }

    // Calculate final price reduction
    let finalPriceReduction: number | null = null;
    const config = deal.negotiationConfigJson as any;
    if (config?.targetUnitPrice && latestOffer?.total_price) {
      const targetPrice = config.targetUnitPrice;
      const finalPrice = latestOffer.total_price;
      finalPriceReduction = ((targetPrice - finalPrice) / targetPrice) * 100;
    }

    // Build deal outcome
    const outcome: DealOutcome = {
      dealId,
      vendorId,
      finalStatus,
      totalRounds: deal.round || 1,
      finalPriceReduction,
      finalUtility: deal.latestUtility || null,
      concessionHistory,
      finalTerms,
      // MESO selections would be extracted from MesoRound table if available
      mesoSelections: undefined,
    };

    // Update profile
    await updateProfileAfterDeal(outcome);
    logger.info(
      `[VendorProfile] Updated profile for vendor ${vendorId} after deal ${dealId} (${finalStatus})`,
    );
  } catch (error) {
    logger.error(
      `[VendorProfile] Failed to update profile for vendor ${vendorId}: ${(error as Error).message}`,
    );
  }
}

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface CreateDealInput {
  title: string;
  counterparty?: string;
  mode?: "INSIGHTS" | "CONVERSATION";
  templateId?: string;
  requisitionId?: number;
  contractId?: number;
  userId: number;
  vendorId?: number;
}

/**
 * Input for creating a deal with full wizard configuration
 */
export interface CreateDealWithConfigInput {
  // Basic info
  title: string;
  counterparty?: string;
  mode: "INSIGHTS" | "CONVERSATION";
  requisitionId: number;
  vendorId: number;
  priority: "HIGH" | "MEDIUM" | "LOW";
  userId: number;

  // Optional: When provided, use this existing contract (from "Start Negotiation" button)
  // When not provided, always create a new contract (1:1 with deal)
  contractId?: number;

  // Optional: When re-negotiating an escalated contract, reference the old contract
  // A new contract will be created with a fresh uniqueToken, linked to this previous one
  previousContractId?: number;

  // Price & Quantity
  priceQuantity: {
    targetUnitPrice: number;
    maxAcceptablePrice: number;
    minOrderQuantity: number;
    preferredQuantity?: number;
  };

  // Payment Terms
  paymentTerms: {
    minDays: number;
    maxDays: number;
    acceptedMethods?: ("BANK_TRANSFER" | "CREDIT" | "LC")[];
  };

  // Delivery
  delivery: {
    requiredDate: string;
    preferredDate?: string;
    locationId?: number;
    locationAddress?: string;
    partialDelivery: {
      allowed: boolean;
      type?: "QUANTITY" | "PERCENTAGE";
      minValue?: number;
    };
  };

  // Contract & SLA
  contractSla: {
    warrantyPeriod:
      | "0_MONTHS"
      | "6_MONTHS"
      | "1_YEAR"
      | "2_YEARS"
      | "3_YEARS"
      | "5_YEARS"
      | "CUSTOM";
    customWarrantyMonths?: number;
    defectLiabilityMonths?: number;
    lateDeliveryPenaltyPerDay: number;
    maxPenaltyCap?: {
      type: "PERCENTAGE" | "FIXED";
      value?: number;
    };
    qualityStandards?: string[];
  };

  // Negotiation Control
  negotiationControl?: {
    deadline?: string;
    maxRounds?: number;
    walkawayThreshold?: number;
  };

  // Custom Parameters
  customParameters?: Array<{
    id?: string;
    name: string;
    type: "BOOLEAN" | "NUMBER" | "TEXT" | "DATE";
    targetValue: boolean | number | string;
    flexibility: "FIXED" | "FLEXIBLE" | "NICE_TO_HAVE";
    includeInNegotiation: boolean;
  }>;
}

export interface ProcessMessageInput {
  dealId: string;
  content: string;
  role: "VENDOR" | "ACCORDO" | "SYSTEM";
  userId: number;
}

export interface DealWithMessages {
  deal: ChatbotDeal;
  messages: ChatbotMessage[];
}

export interface ListDealsFilters {
  status?: "NEGOTIATING" | "ACCEPTED" | "WALKED_AWAY" | "ESCALATED";
  mode?: "INSIGHTS" | "CONVERSATION";
  archived?: boolean;
  deleted?: boolean;
  userId?: number;
  vendorId?: number;
  companyId?: number | null;
}

export interface PaginatedDealsResponse {
  data: ChatbotDeal[];
  total: number;
  page: number;
  totalPages: number;
}

/**
 * Map requisition data to negotiation config
 * Uses BATNA and target price from requisition products
 */
export const buildConfigFromRequisition = async (
  requisitionId: number,
): Promise<NegotiationConfig> => {
  const requisition = await models.Requisition.findByPk(requisitionId, {
    include: [
      {
        model: models.RequisitionProduct,
        as: "RequisitionProduct",
      },
    ],
  });

  if (!requisition) {
    throw new CustomError("Requisition not found", 404);
  }

  // Calculate TOTAL target price across all products (not average unit price)
  // This matches how vendor chat sends offers as grand totals
  let totalTarget = 0;

  if (
    requisition.RequisitionProduct &&
    requisition.RequisitionProduct.length > 0
  ) {
    for (const reqProduct of requisition.RequisitionProduct) {
      const quantity = (reqProduct as any).qty || 1;
      const targetPrice = (reqProduct as any).targetPrice || 0;
      // targetPrice is per-unit, multiply by quantity to get total for this product
      totalTarget += targetPrice * quantity;
    }
  }

  // Fallback if no products or all zero prices
  if (totalTarget === 0) {
    totalTarget = 1000; // Default fallback
  }

  const anchor = totalTarget * 0.85; // PM's ideal: 15% below target
  const maxAcceptable = totalTarget * 1.25; // PM's max: 25% above target
  const concessionStep = (maxAcceptable - totalTarget) / 6; // ~4% steps toward max

  const currencyCode = (requisition.typeOfCurrency as string) || "USD";
  logger.info(
    `Built config from requisition ${requisitionId}: target=${currencyCode} ${totalTarget}, max=${currencyCode} ${maxAcceptable}`,
  );

  return {
    parameters: {
      total_price: {
        weight: 0.6,
        direction: "minimize",
        anchor,
        target: totalTarget,
        max_acceptable: maxAcceptable,
        concession_step: concessionStep,
      },
      payment_terms: {
        weight: 0.4,
        options: ["Net 30", "Net 60", "Net 90"] as const,
        utility: {
          "Net 30": 0.2,
          "Net 60": 0.6,
          "Net 90": 1.0,
        },
      },
    },
    accept_threshold: 0.7,
    escalate_threshold: 0.5,
    walkaway_threshold: 0.3,
    max_rounds: 6,
    currency: currencyCode,
  };
};

/**
 * Map contract data to negotiation config
 */
export const buildConfigFromContract = async (
  contractId: number,
): Promise<NegotiationConfig> => {
  const contract = await models.Contract.findByPk(contractId, {
    include: [
      {
        model: models.Requisition,
        as: "Requisition",
        include: [
          {
            model: models.RequisitionProduct,
            as: "RequisitionProduct",
          },
        ],
      },
    ],
  });

  if (!contract) {
    throw new CustomError("Contract not found", 404);
  }

  if (!contract.Requisition) {
    throw new CustomError("Contract has no associated requisition", 400);
  }

  return buildConfigFromRequisition(contract.Requisition.id);
};

/**
 * Create a new negotiation deal
 */
export const createDealService = async (
  input: CreateDealInput,
): Promise<ChatbotDeal> => {
  try {
    const dealId = uuidv4();

    // Validate foreign keys
    if (input.requisitionId) {
      const requisition = await models.Requisition.findByPk(
        input.requisitionId,
      );
      if (!requisition) {
        throw new CustomError("Requisition not found", 404);
      }
    }

    if (input.contractId) {
      const contract = await models.Contract.findByPk(input.contractId);
      if (!contract) {
        throw new CustomError("Contract not found", 404);
      }
    }

    if (input.vendorId) {
      const vendor = await models.User.findByPk(input.vendorId);
      if (!vendor) {
        throw new CustomError("Vendor not found", 404);
      }
    }

    const deal = await models.ChatbotDeal.create({
      id: dealId,
      title: input.title,
      counterparty: input.counterparty || null,
      status: "NEGOTIATING",
      round: 0,
      mode: input.mode || "CONVERSATION",
      latestOfferJson: null,
      latestVendorOffer: null,
      latestDecisionAction: null,
      latestUtility: null,
      convoStateJson:
        input.mode === "CONVERSATION"
          ? { phase: "GREETING", history: [] }
          : null,
      templateId: input.templateId || null,
      requisitionId: input.requisitionId || null,
      contractId: input.contractId || null,
      userId: input.userId,
      vendorId: input.vendorId || null,
      archivedAt: null,
      deletedAt: null,
    });

    logger.info(`Created deal ${dealId}: ${input.title}`);
    return deal;
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      `Failed to create deal: ${(error as Error).message}`,
      500,
    );
  }
};

/**
 * Create a negotiation deal with full wizard configuration
 * Stores all parameters in negotiationConfigJson
 */
export const createDealWithConfigService = async (
  input: CreateDealWithConfigInput,
): Promise<ChatbotDeal> => {
  try {
    const dealId = uuidv4();

    // Validate requisition exists
    const requisition = await models.Requisition.findByPk(input.requisitionId);
    if (!requisition) {
      throw new CustomError("Requisition not found", 404);
    }

    // Resolve the currency from the requisition (source of truth)
    const requisitionCurrencyCode =
      (requisition.typeOfCurrency as string) || "USD";

    // Validate vendor exists
    const vendor = await models.User.findByPk(input.vendorId);
    if (!vendor) {
      throw new CustomError("Vendor not found", 404);
    }

    // Build negotiation config from wizard input
    const {
      priceQuantity,
      paymentTerms,
      delivery,
      contractSla,
      negotiationControl,
      customParameters,
    } = input;

    // Both targetUnitPrice and maxAcceptablePrice from the wizard are total contract values
    // (not per-unit prices). Do NOT multiply by quantity.
    const orderQty = priceQuantity.minOrderQuantity || 1;
    const targetTotalPrice = priceQuantity.targetUnitPrice;
    const maxTotalPrice = priceQuantity.maxAcceptablePrice;

    // Calculate concession step based on total price range
    const priceRange = maxTotalPrice - targetTotalPrice;
    const concessionStep = priceRange / (negotiationControl?.maxRounds || 10);

    // Build payment terms utility based on accepted methods
    const paymentTermsOptions = ["Net 30", "Net 60", "Net 90"] as const;
    const paymentTermsUtility = {
      "Net 30": 0.2,
      "Net 60": 0.6,
      "Net 90": 1.0,
    } as const;

    // Adjust thresholds, weights, and max rounds based on priority (negotiation strategy)
    // HIGH = Maximize Savings (aggressive, PM-focused)
    // MEDIUM = Fair Deal (balanced)
    // LOW = Quick Close (flexible, faster resolution)
    let acceptThreshold = 0.7;
    let walkawayThreshold = 0.3;
    let priceWeight = 0.6;
    let termsWeight = 0.25;
    let deliveryWeight = 0.15;
    let maxRounds = negotiationControl?.maxRounds || 6;

    if (input.priority === "HIGH") {
      // Maximize Savings: Stricter thresholds, focus on price, more rounds
      acceptThreshold = 0.75;
      walkawayThreshold = 0.35;
      priceWeight = 0.7;
      termsWeight = 0.2;
      deliveryWeight = 0.1;
      maxRounds = negotiationControl?.maxRounds || 10;
    } else if (input.priority === "LOW") {
      // Quick Close: Relaxed thresholds, balanced weights, fewer rounds
      acceptThreshold = 0.65;
      walkawayThreshold = 0.25;
      priceWeight = 0.5;
      termsWeight = 0.3;
      deliveryWeight = 0.2;
      maxRounds = negotiationControl?.maxRounds || 4;
    }

    // Apply custom walkaway threshold if provided
    // NOTE: walkawayThreshold from frontend is the minimum acceptable utility percentage (e.g., 20 means walk away if utility < 20%)
    // This should be a LOW value - we walk away when utility drops BELOW this threshold
    if (
      negotiationControl?.walkawayThreshold !== undefined &&
      negotiationControl?.walkawayThreshold !== null
    ) {
      walkawayThreshold = negotiationControl.walkawayThreshold / 100; // Convert percentage to decimal (20% -> 0.20)
    }

    const negotiationConfig: NegotiationConfig = {
      parameters: {
        total_price: {
          weight: priceWeight,
          direction: "minimize",
          anchor: targetTotalPrice * 0.85,
          target: targetTotalPrice,
          max_acceptable: maxTotalPrice,
          concession_step: concessionStep,
        },
        payment_terms: {
          weight: termsWeight + deliveryWeight, // Combined terms weight (delivery included)
          options: paymentTermsOptions,
          utility: paymentTermsUtility,
        },
      },
      accept_threshold: acceptThreshold,
      walkaway_threshold: walkawayThreshold,
      max_rounds: maxRounds,
      // Store priority for counter-offer logic
      priority: input.priority,
      // Currency from requisition — used for all price display (symbol, formatting)
      currency: requisitionCurrencyCode,
    };

    // Adaptive Features: Historical Anchor Adjustment & Dynamic Rounds
    // All adaptive features enabled by default for new deals (backward-compatible via flag)
    const adaptiveFeaturesConfig: AdaptiveFeaturesConfig = {
      enabled: true,
      historicalAnchor: false,
      originalAnchor:
        (
          negotiationConfig.parameters?.total_price ??
          (negotiationConfig.parameters as any)?.unit_price
        )?.anchor ?? 0,
      dynamicRounds: {
        softMaxRounds: maxRounds,
        hardMaxRounds: Math.ceil(maxRounds * 1.5),
        autoExtendEnabled: true,
      },
    };

    // Apply historical anchor adjustment
    try {
      const insights = await getHistoricalInsights(input.vendorId);
      if (insights.sampleSize > 0) {
        const priceParams =
          negotiationConfig.parameters?.total_price ??
          (negotiationConfig.parameters as any)?.unit_price;
        const originalAnchor = priceParams?.anchor ?? 0;
        const adjustedAnchor = adjustAnchorFromHistory(
          originalAnchor,
          priceParams?.target ?? 0,
          insights,
        );

        if (adjustedAnchor !== originalAnchor && priceParams) {
          priceParams.anchor = adjustedAnchor;
          adaptiveFeaturesConfig.historicalAnchor = true;
          adaptiveFeaturesConfig.originalAnchor = originalAnchor;
          logger.info(
            `[CreateDeal] Historical anchor adjusted for vendor ${input.vendorId}: $${originalAnchor} -> $${adjustedAnchor} (profile: ${insights.vendorBehaviorProfile}, ${insights.sampleSize} deals)`,
          );
        }
      }
    } catch (histError) {
      // Non-critical: continue with original anchor
      logger.warn(
        `[CreateDeal] Historical anchor adjustment failed:`,
        histError,
      );
    }

    // Store dynamic rounds config on the negotiation config
    (negotiationConfig as any).dynamicRounds =
      adaptiveFeaturesConfig.dynamicRounds;
    (negotiationConfig as any).adaptiveFeatures = adaptiveFeaturesConfig;

    // Store the full wizard configuration in a separate JSON field
    const wizardConfig = {
      priority: input.priority,
      priceQuantity,
      paymentTerms,
      delivery,
      contractSla,
      negotiationControl: {
        deadline: negotiationControl?.deadline || null,
        maxRounds: negotiationControl?.maxRounds || 10,
        walkawayThreshold: negotiationControl?.walkawayThreshold || 20,
      },
      customParameters: customParameters || [],
    };

    // Contract creation logic:
    // 1. If contractId is provided (from "Start Negotiation" on existing contract), use it
    // 2. Otherwise, ALWAYS create a new contract (1:1 relationship with deal)
    let contractId: number | null = null;
    let contractUniqueToken: string | null = null;
    let isExistingContract = false;

    if (input.contractId) {
      // Use the provided existing contract (from "Start Negotiation" button)
      const existingContract = await models.Contract.findByPk(input.contractId);
      if (!existingContract) {
        throw new CustomError("Provided contract not found", 404);
      }
      if (
        existingContract.requisitionId !== input.requisitionId ||
        existingContract.vendorId !== input.vendorId
      ) {
        throw new CustomError(
          "Contract does not match requisition/vendor",
          400,
        );
      }

      // Re-negotiation validation based on contract status
      // - Rejected: Cannot start new negotiation (final state)
      // - Active: Negotiation already in progress
      // - Escalated: Can start new negotiation (will become Active)
      // - Created: Normal flow
      if (existingContract.status === "Rejected") {
        throw new CustomError(
          "Cannot start new negotiation on a rejected contract",
          400,
        );
      }
      if (existingContract.status === "Active") {
        throw new CustomError(
          "A negotiation is already in progress for this contract",
          400,
        );
      }

      contractId = existingContract.id;
      contractUniqueToken = existingContract.uniqueToken;
      isExistingContract = true;
      logger.info(
        `Using provided existing contract ${contractId} (status: ${existingContract.status}) for vendor ${input.vendorId} on requisition ${input.requisitionId}`,
      );
    } else if (input.previousContractId) {
      // RE-NEGOTIATION: Create NEW contract referencing the old escalated one
      const previousContract = await models.Contract.findByPk(
        input.previousContractId,
      );
      if (!previousContract) {
        throw new CustomError("Previous contract not found", 404);
      }
      if (
        previousContract.requisitionId !== input.requisitionId ||
        previousContract.vendorId !== input.vendorId
      ) {
        throw new CustomError(
          "Previous contract does not match requisition/vendor",
          400,
        );
      }
      if (previousContract.status !== "Escalated") {
        throw new CustomError(
          "Previous contract must be in Escalated status for re-negotiation",
          400,
        );
      }

      const uniqueToken = crypto.randomBytes(16).toString("hex");
      const newContract = await models.Contract.create({
        requisitionId: input.requisitionId,
        vendorId: input.vendorId,
        status: "Created",
        uniqueToken,
        previousContractId: input.previousContractId,
        contractDetails: previousContract.contractDetails,
        chatbotDealId: dealId,
        createdBy: input.userId,
      });
      contractId = newContract.id;
      contractUniqueToken = uniqueToken;
      isExistingContract = false;
      logger.info(
        `Created re-negotiation contract ${contractId} (prev: ${input.previousContractId}) for vendor ${input.vendorId} on requisition ${input.requisitionId}`,
      );
    } else {
      // Check if there's an existing unlinked "Created" contract for this vendor+requisition
      // This prevents duplicates when the "New" button is used on a vendor that already has a pending contract
      const existingPendingContract = await models.Contract.findOne({
        where: {
          requisitionId: input.requisitionId,
          vendorId: input.vendorId,
          status: "Created",
          chatbotDealId: null,
        },
      });

      if (existingPendingContract) {
        // Reuse the existing pending contract
        contractId = existingPendingContract.id;
        contractUniqueToken = existingPendingContract.uniqueToken;
        isExistingContract = true;
        logger.info(
          `Reusing existing pending contract ${contractId} for vendor ${input.vendorId} on requisition ${input.requisitionId}`,
        );
      } else {
        // Create a NEW contract for this deal (1:1 relationship)
        const uniqueToken = crypto.randomBytes(16).toString("hex");
        const newContract = await models.Contract.create({
          requisitionId: input.requisitionId,
          vendorId: input.vendorId,
          status: "Created",
          uniqueToken,
          chatbotDealId: dealId, // Link to the deal we're about to create (1:1)
          createdBy: input.userId,
        });
        contractId = newContract.id;
        contractUniqueToken = uniqueToken;
        isExistingContract = false;
        logger.info(
          `Created new contract ${contractId} for vendor ${input.vendorId} on requisition ${input.requisitionId}`,
        );
      }
    }

    // Check if this vendor has existing deals on this requisition (for email type determination)
    const existingDealsCount = await models.ChatbotDeal.count({
      where: {
        requisitionId: input.requisitionId,
        vendorId: input.vendorId,
        deletedAt: null,
      },
    });
    const isFirstDealForVendor = existingDealsCount === 0;

    const deal = await models.ChatbotDeal.create({
      id: dealId,
      title: input.title,
      counterparty: input.counterparty || null,
      status: "NEGOTIATING",
      round: 0,
      mode: input.mode,
      latestOfferJson: null,
      latestVendorOffer: null,
      latestDecisionAction: null,
      latestUtility: null,
      convoStateJson:
        input.mode === "CONVERSATION"
          ? { phase: "GREETING", history: [] }
          : null,
      negotiationConfigJson: { ...negotiationConfig, wizardConfig } as any,
      templateId: null,
      requisitionId: input.requisitionId,
      contractId: contractId,
      userId: input.userId,
      vendorId: input.vendorId,
      archivedAt: null,
      deletedAt: null,
    });

    logger.info(
      `Created deal with config ${dealId}: ${input.title} (priority: ${input.priority})`,
    );

    // Link existing contract to this deal (set chatbotDealId)
    if (isExistingContract && contractId) {
      await models.Contract.update(
        { chatbotDealId: dealId },
        { where: { id: contractId } },
      );
      logger.info(
        `[ContractLink] Set chatbotDealId=${dealId} on existing contract ${contractId}`,
      );
    }

    // Update contract status to Active (negotiation started)
    // Skip for existing contracts: keep in 'Created' so vendor can still fill out the quote form
    // Skip for re-negotiation: keep new contract in 'Created' so vendor sees the quote form
    // Only sync status for brand-new contracts created in this function (Path C, no existing pending found)
    if (contractId && !input.previousContractId && !isExistingContract) {
      await syncContractStatus(dealId, "NEGOTIATING", contractId);
    }

    // Send email notification to vendor
    let emailStatus: { success: boolean; messageId?: string; error?: string } =
      { success: false, error: "Email not sent" };

    try {
      // Fetch requisition with products and project
      const requisitionWithDetails = await models.Requisition.findByPk(
        input.requisitionId,
        {
          include: [
            {
              model: models.Project,
              as: "Project",
              attributes: ["id", "projectName"],
            },
            {
              model: models.RequisitionProduct,
              as: "RequisitionProduct",
              include: [
                {
                  model: models.Product,
                  as: "Product",
                  attributes: ["id", "productName", "UOM"],
                },
              ],
            },
          ],
        },
      );

      if (requisitionWithDetails && vendor.email) {
        // Extract products from requisition
        const products = (
          (requisitionWithDetails as any).RequisitionProduct || []
        ).map((rp: any) => ({
          name: rp.Product?.productName || "Unknown Product",
          quantity: rp.quantity || 1,
          targetPrice: rp.targetPrice || priceQuantity.targetUnitPrice,
          unit: rp.Product?.UOM || undefined,
        }));

        // Determine which email to send based on whether this is the first deal for vendor on this requisition
        // First deal: send portal link (/vendor-contract/{token})
        // Subsequent deals: send chatbot link (/vendor-chat/{token}) with "Continue Negotiation" tone

        if (input.previousContractId) {
          // Re-negotiation: send /vendor-contract/ link so vendor can submit a fresh quote
          const continuedEmailData = {
            dealId: dealId,
            dealTitle: input.title,
            requisitionId: input.requisitionId,
            rfqNumber:
              (requisitionWithDetails as any).rfqNumber ||
              `RFQ-${input.requisitionId}`,
            requisitionTitle:
              (requisitionWithDetails as any).title || input.title,
            projectName:
              (requisitionWithDetails as any).Project?.projectName ||
              "Unknown Project",
            vendorId: input.vendorId,
            vendorName: vendor.name || vendor.email,
            vendorEmail: vendor.email,
            contractUniqueToken: contractUniqueToken!,
            negotiationDeadline: negotiationControl?.deadline
              ? new Date(negotiationControl.deadline)
              : (requisitionWithDetails as any).negotiationClosureDate ||
                undefined,
            previousDealsCount: existingDealsCount,
            products:
              products.length > 0
                ? products
                : [
                    {
                      name: "Products as per RFQ",
                      quantity: 1,
                      targetPrice: priceQuantity.targetUnitPrice,
                    },
                  ],
            paymentTerms: paymentTerms
              ? {
                  minDays: paymentTerms.minDays || 30,
                  maxDays: paymentTerms.maxDays || 90,
                }
              : undefined,
            deliveryDate: delivery?.requiredDate || undefined,
            useVendorContractLink: true,
          };

          emailStatus = await sendContinuedNegotiationEmail(continuedEmailData);

          if (emailStatus.success) {
            logger.info(
              `Re-negotiation email sent to vendor ${vendor.email} for deal ${dealId} (previous contract: ${input.previousContractId})`,
            );
          } else {
            logger.warn(
              `Failed to send re-negotiation email: ${emailStatus.error}`,
              { dealId, vendorEmail: vendor.email },
            );
          }
        } else if (isFirstDealForVendor && isExistingContract) {
          // First deal for this vendor using an existing contract - vendor still needs to fill the quote form
          // Send vendor contract link so they can submit their quotation first
          const contractEmailData = {
            dealId: dealId,
            dealTitle: input.title,
            requisitionId: input.requisitionId,
            rfqNumber:
              (requisitionWithDetails as any).rfqNumber ||
              `RFQ-${input.requisitionId}`,
            requisitionTitle:
              (requisitionWithDetails as any).title || input.title,
            projectName:
              (requisitionWithDetails as any).Project?.projectName ||
              "Unknown Project",
            vendorId: input.vendorId,
            vendorName: vendor.name || vendor.email,
            vendorEmail: vendor.email,
            contractUniqueToken: contractUniqueToken!,
            negotiationDeadline: negotiationControl?.deadline
              ? new Date(negotiationControl.deadline)
              : (requisitionWithDetails as any).negotiationClosureDate ||
                undefined,
            previousDealsCount: 0,
            products:
              products.length > 0
                ? products
                : [
                    {
                      name: "Products as per RFQ",
                      quantity: 1,
                      targetPrice: priceQuantity.targetUnitPrice,
                    },
                  ],
            paymentTerms: paymentTerms
              ? {
                  minDays: paymentTerms.minDays || 30,
                  maxDays: paymentTerms.maxDays || 90,
                }
              : undefined,
            deliveryDate: delivery?.requiredDate || undefined,
            useVendorContractLink: true,
          };

          emailStatus = await sendContinuedNegotiationEmail(contractEmailData);

          if (emailStatus.success) {
            logger.info(
              `Deal created email (first deal, existing contract) sent to vendor ${vendor.email} for deal ${dealId}`,
            );
          } else {
            logger.warn(
              `Failed to send deal created email: ${emailStatus.error}`,
              { dealId, vendorEmail: vendor.email },
            );
          }
        } else if (isFirstDealForVendor) {
          // First deal for this vendor with a brand-new contract - send standard deal created email
          const emailData = {
            dealId: dealId,
            dealTitle: input.title,
            requisitionId: input.requisitionId,
            rfqNumber:
              (requisitionWithDetails as any).rfqNumber ||
              `RFQ-${input.requisitionId}`,
            requisitionTitle:
              (requisitionWithDetails as any).title || input.title,
            projectName:
              (requisitionWithDetails as any).Project?.projectName ||
              "Unknown Project",
            vendorId: input.vendorId,
            vendorName: vendor.name || vendor.email,
            vendorEmail: vendor.email,
            negotiationDeadline: negotiationControl?.deadline
              ? new Date(negotiationControl.deadline)
              : (requisitionWithDetails as any).negotiationClosureDate ||
                undefined,
            products:
              products.length > 0
                ? products
                : [
                    {
                      name: "Products as per RFQ",
                      quantity: 1,
                      targetPrice: priceQuantity.targetUnitPrice,
                    },
                  ],
            priceConfig: {
              targetUnitPrice: priceQuantity.targetUnitPrice,
              maxAcceptablePrice: priceQuantity.maxAcceptablePrice,
            },
            paymentTerms: paymentTerms
              ? {
                  minDays: paymentTerms.minDays || 30,
                  maxDays: paymentTerms.maxDays || 90,
                }
              : undefined,
            deliveryDate: delivery?.requiredDate || undefined,
          };

          emailStatus = await sendDealCreatedEmail(emailData);

          if (emailStatus.success) {
            logger.info(
              `Deal created email (first deal) sent to vendor ${vendor.email} for deal ${dealId}`,
            );
          } else {
            logger.warn(
              `Failed to send deal created email: ${emailStatus.error}`,
              { dealId, vendorEmail: vendor.email },
            );
          }
        } else {
          // Subsequent deal for this vendor - send continued negotiation email with chatbot link
          const continuedEmailData = {
            dealId: dealId,
            dealTitle: input.title,
            requisitionId: input.requisitionId,
            rfqNumber:
              (requisitionWithDetails as any).rfqNumber ||
              `RFQ-${input.requisitionId}`,
            requisitionTitle:
              (requisitionWithDetails as any).title || input.title,
            projectName:
              (requisitionWithDetails as any).Project?.projectName ||
              "Unknown Project",
            vendorId: input.vendorId,
            vendorName: vendor.name || vendor.email,
            vendorEmail: vendor.email,
            contractUniqueToken: contractUniqueToken!, // Token from the newly created contract
            negotiationDeadline: negotiationControl?.deadline
              ? new Date(negotiationControl.deadline)
              : (requisitionWithDetails as any).negotiationClosureDate ||
                undefined,
            previousDealsCount: existingDealsCount, // Number of previous deals
            products:
              products.length > 0
                ? products
                : [
                    {
                      name: "Products as per RFQ",
                      quantity: 1,
                      targetPrice: priceQuantity.targetUnitPrice,
                    },
                  ],
            paymentTerms: paymentTerms
              ? {
                  minDays: paymentTerms.minDays || 30,
                  maxDays: paymentTerms.maxDays || 90,
                }
              : undefined,
            deliveryDate: delivery?.requiredDate || undefined,
          };

          emailStatus = await sendContinuedNegotiationEmail(continuedEmailData);

          if (emailStatus.success) {
            logger.info(
              `Continued negotiation email sent to vendor ${vendor.email} for deal ${dealId} (previous deals: ${existingDealsCount})`,
            );
          } else {
            logger.warn(
              `Failed to send continued negotiation email: ${emailStatus.error}`,
              { dealId, vendorEmail: vendor.email },
            );
          }
        }
      } else {
        logger.warn(
          `Cannot send deal created email: missing requisition details or vendor email`,
          {
            dealId,
            hasRequisition: !!requisitionWithDetails,
            hasVendorEmail: !!vendor.email,
          },
        );
      }
    } catch (emailError) {
      logger.error(
        `Error sending deal created email: ${(emailError as Error).message}`,
        { dealId },
      );
      emailStatus = { success: false, error: (emailError as Error).message };
    }

    // Return deal with email status (deal is created regardless of email status)
    return {
      ...deal.toJSON(),
      emailStatus,
    } as ChatbotDeal & { emailStatus: typeof emailStatus };
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      `Failed to create deal with config: ${(error as Error).message}`,
      500,
    );
  }
};

/**
 * Get smart defaults for a vendor/RFQ combination
 * Based on historical data from similar deals
 */
/**
 * Smart defaults response structure matching frontend SmartDefaults interface
 */
interface SmartDefaultsResponse {
  priceQuantity: {
    targetUnitPrice: number | null;
    maxAcceptablePrice: number | null;
    // New fields for auto-populating from requisition totals
    totalQuantity: number | null;
    totalTargetPrice: number | null;
    totalMaxPrice: number | null;
  };
  paymentTerms: {
    minDays: number;
    maxDays: number;
    // Additional payment fields from requisition
    paymentTermsText: string | null; // e.g., "Net 30", "Net 60"
    netPaymentDay: number | null; // Parsed net payment day
    prePaymentPercentage: number | null; // Pre-payment percentage
    postPaymentPercentage: number | null; // Post-payment percentage
  };
  delivery: {
    typicalDeliveryDays: number | null;
    // Date fields from requisition for auto-populating wizard
    deliveryDate?: string | null; // Maps to preferredDate in wizard
    maxDeliveryDate?: string | null; // Maps to requiredDate in wizard
    negotiationClosureDate?: string | null; // Maps to deadline in wizard Step 3
  };
  // BATNA and discount limits from requisition
  negotiationLimits: {
    batna: number | null; // Best Alternative to Negotiated Agreement
    maxDiscount: number | null; // Maximum discount allowed
    discountedValue: number | null; // Discounted value calculation
  };
  /** Currency code from the requisition (e.g. "USD", "INR", "GBP") */
  currency: string;
  source: "vendor_history" | "similar_deals" | "industry_default" | "combined";
  confidence: number;
}

export const getSmartDefaultsService = async (
  rfqId: number,
  vendorId: number,
): Promise<SmartDefaultsResponse> => {
  try {
    // Get requisition for base pricing
    const requisition = await models.Requisition.findByPk(rfqId, {
      include: [
        {
          model: models.RequisitionProduct,
          as: "RequisitionProduct",
        },
      ],
    });

    if (!requisition) {
      throw new CustomError("Requisition not found", 404);
    }

    // Calculate totals from requisition products
    let totalTargetValue = 0;
    let totalMaxValue = 0;
    let totalQuantity = 0;
    let hasValidProducts = false;

    if (
      requisition.RequisitionProduct &&
      requisition.RequisitionProduct.length > 0
    ) {
      for (const reqProduct of requisition.RequisitionProduct) {
        const quantity = (reqProduct as any).qty || 0;
        const targetPrice = (reqProduct as any).targetPrice;
        const maxPrice = (reqProduct as any).maximum_price;

        if (quantity > 0) {
          totalQuantity += quantity;

          // Only add to totals if price values exist
          if (targetPrice !== null && targetPrice !== undefined) {
            totalTargetValue += targetPrice * quantity;
            hasValidProducts = true;
          }
          if (maxPrice !== null && maxPrice !== undefined) {
            totalMaxValue += maxPrice * quantity;
          }
        }
      }
    }

    // Calculate average for backward compatibility (unit prices)
    const averageTarget =
      totalQuantity > 0 && hasValidProducts
        ? totalTargetValue / totalQuantity
        : 100;

    // Prepare total values - return null if no valid data (user requirement: leave fields empty)
    const finalTotalQuantity = totalQuantity > 0 ? totalQuantity : null;
    const finalTotalTargetPrice =
      hasValidProducts && totalTargetValue > 0
        ? Math.round(totalTargetValue * 100) / 100
        : null;
    const finalTotalMaxPrice =
      totalMaxValue > 0 ? Math.round(totalMaxValue * 100) / 100 : null;

    // Extract requisition-level dates for auto-populating wizard
    // deliveryDate → preferredDate (ideal delivery date)
    const deliveryDate = requisition.deliveryDate
      ? new Date(requisition.deliveryDate).toISOString().split("T")[0]
      : null;

    // maxDeliveryDate → requiredDate (hard deadline)
    const maxDeliveryDate = requisition.maxDeliveryDate
      ? new Date(requisition.maxDeliveryDate).toISOString().split("T")[0]
      : null;

    // negotiationClosureDate → deadline in Step 3
    const negotiationClosureDate = requisition.negotiationClosureDate
      ? new Date(requisition.negotiationClosureDate).toISOString().split("T")[0]
      : null;

    // Look for historical deals with this vendor
    const historicalDeals = await models.ChatbotDeal.findAll({
      where: {
        vendorId,
        status: "ACCEPTED",
      },
      limit: 10,
      order: [["createdAt", "DESC"]],
    });

    // Calculate averages from historical data
    let avgPaymentDays = 45;
    let avgVolumeDiscount = 5;
    let avgDeliveryDays = 14;
    let source: SmartDefaultsResponse["source"] = "industry_default";
    let confidence = 0.5;

    if (historicalDeals.length > 0) {
      // Use historical data if available
      avgPaymentDays = 45;
      avgVolumeDiscount = 8;
      avgDeliveryDays = 21;
      source = "vendor_history";
      confidence = 0.8;
    }

    const targetUnitPrice = Math.round(averageTarget * 100) / 100;
    const maxAcceptablePrice = Math.round(averageTarget * 1.2 * 100) / 100;

    // Extract payment terms details from requisition
    const paymentTermsText = requisition.payment_terms || null;
    const netPaymentDay = requisition.net_payment_day
      ? parseInt(requisition.net_payment_day, 10)
      : null;
    const prePaymentPercentage = requisition.pre_payment_percentage || null;
    const postPaymentPercentage = requisition.post_payment_percentage || null;

    // Extract BATNA and discount limits
    const batna = requisition.batna || null;
    const maxDiscount = requisition.maxDiscount || null;
    const discountedValue = requisition.discountedValue || null;

    return {
      priceQuantity: {
        targetUnitPrice,
        maxAcceptablePrice,
        // New total fields from requisition
        totalQuantity: finalTotalQuantity,
        totalTargetPrice: finalTotalTargetPrice,
        totalMaxPrice: finalTotalMaxPrice,
      },
      paymentTerms: {
        minDays: netPaymentDay || 30, // Use requisition's net payment day if available
        maxDays: (netPaymentDay || 30) + 30, // Allow 30 days flexibility
        // Additional payment fields from requisition
        paymentTermsText,
        netPaymentDay,
        prePaymentPercentage,
        postPaymentPercentage,
      },
      delivery: {
        typicalDeliveryDays: avgDeliveryDays,
        deliveryDate, // Maps to preferredDate in wizard
        maxDeliveryDate, // Maps to requiredDate in wizard
        negotiationClosureDate, // Maps to deadline in wizard Step 3
      },
      // BATNA and discount limits from requisition
      negotiationLimits: {
        batna,
        maxDiscount,
        discountedValue,
      },
      currency: (requisition.typeOfCurrency as string) || "USD",
      source,
      confidence,
    };
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      `Failed to get smart defaults: ${(error as Error).message}`,
      500,
    );
  }
};

/**
 * Process a vendor message in INSIGHTS (demo) mode
 * Extracts offer, makes decision, generates counter
 */
/**
 * Format delivery date for display in messages
 * Format: "Mar 15 (30 days)" or "30 days" if no date
 */
const formatDeliveryForMessage = (
  deliveryDate: string | null | undefined,
  deliveryDays: number | null | undefined,
): string => {
  if (!deliveryDate && !deliveryDays) return "";

  let dateText = "";
  if (deliveryDate) {
    try {
      const date = new Date(deliveryDate);
      dateText = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    } catch {
      dateText = deliveryDate;
    }
  }

  if (deliveryDays && deliveryDays > 0) {
    if (dateText) {
      return `${dateText} (${deliveryDays} days)`;
    }
    return `${deliveryDays} days`;
  }

  return dateText;
};

/** Map currency code → display symbol */
const CURRENCY_SYMBOL_MAP: Record<string, string> = {
  USD: "$",
  INR: "₹",
  EUR: "€",
  GBP: "£",
  AUD: "A$",
};

/** Format a price with the correct currency symbol for a deal */
const formatPrice = (amount: number, currencyCode: string): string => {
  const symbol = CURRENCY_SYMBOL_MAP[currencyCode] ?? currencyCode + " ";
  return `${symbol}${amount.toLocaleString()}`;
};

/**
 * Generate Accordo response text based on decision
 * Now includes delivery date and days in response messages
 */
const generateAccordoResponseText = (
  decision: Decision,
  config: NegotiationConfig,
  vendorOffer?: {
    total_price?: number | null;
    payment_terms?: string | null;
    delivery_date?: string | null;
    delivery_days?: number | null;
  } | null,
): string => {
  const { action, counterOffer, utilityScore } = decision;
  const currencyCode = (config as any).currency || "USD";

  // Format delivery if available in counterOffer
  const deliveryText = formatDeliveryForMessage(
    counterOffer?.delivery_date,
    counterOffer?.delivery_days,
  );

  switch (action) {
    case "ACCEPT": {
      // For ACCEPT, show the vendor's accepted price (not a counter offer)
      const acceptedPrice = vendorOffer?.total_price;
      const acceptedTerms = vendorOffer?.payment_terms;
      const acceptDelivery = deliveryText
        ? ` and delivery by ${deliveryText}`
        : "";
      const priceStr = acceptedPrice
        ? formatPrice(acceptedPrice, currencyCode)
        : "the agreed amount";
      const termsStr = acceptedTerms || "the agreed terms";
      return `We are pleased to accept your offer of ${priceStr} with ${termsStr} payment terms${acceptDelivery}. This meets our procurement requirements and we look forward to formalizing the agreement. Thank you for working with us.`;
    }

    case "COUNTER": {
      const targetPriceValue =
        config.parameters?.total_price?.target ??
        (
          (config.parameters as Record<string, unknown>)?.unit_price as
            | { target?: number }
            | undefined
        )?.target ??
        1000;
      const priceText = counterOffer?.total_price
        ? formatPrice(counterOffer.total_price, currencyCode)
        : formatPrice(targetPriceValue, currencyCode);
      const termsText = counterOffer?.payment_terms || "Net 60";
      const counterDelivery = deliveryText
        ? `, delivery by ${deliveryText}`
        : "";
      return `Thank you for your offer. After careful review, we would like to counter with ${priceText}, ${termsText} payment terms${counterDelivery}. We believe these terms reflect a fair path forward for both parties.`;
    }

    case "WALK_AWAY":
      return `I appreciate your time, but unfortunately the current terms do not align with our procurement requirements. We have reached the limit of what is workable within our constraints and will need to conclude this negotiation.`;

    case "ESCALATE": {
      const escalateDelivery = deliveryText
        ? `, delivery by ${deliveryText}`
        : "";
      const escalatePrice = counterOffer?.total_price
        ? formatPrice(counterOffer.total_price, currencyCode)
        : "pending";
      return `This negotiation has reached a point where I need to escalate it to a human decision-maker for review. Our counter-proposal is ${escalatePrice} with ${counterOffer?.payment_terms || "negotiable"} terms${escalateDelivery}. Thank you for your patience.`;
    }

    case "ASK_CLARIFY":
      return `I need some clarification on your offer. Could you please provide more details about the pricing, payment terms, and delivery timeline?`;

    default:
      return `Thank you for your message. We have reviewed the details and will be in touch shortly regarding the next steps.`;
  }
};

export const processVendorMessageService = async (
  input: ProcessMessageInput,
): Promise<{
  message: ChatbotMessage;
  accordoMessage: ChatbotMessage;
  decision: Decision;
  explainability: Explainability;
}> => {
  try {
    const deal = await models.ChatbotDeal.findByPk(input.dealId, {
      include: [{ model: models.Requisition, as: "Requisition" }],
    });
    if (!deal) {
      throw new CustomError("Deal not found", 404);
    }

    if (deal.status !== "NEGOTIATING") {
      throw new CustomError("Deal is not in negotiating status", 400);
    }

    // Get requisition currency for offer parsing (February 2026)
    const requisition = (deal as any).Requisition;
    const requisitionCurrency = requisition?.typeOfCurrency as
      | "USD"
      | "INR"
      | "EUR"
      | "GBP"
      | "AUD"
      | undefined;

    // Use stored negotiation config from deal (includes priority-adjusted thresholds and weights)
    // This ensures the priority settings from deal creation are respected during negotiation
    let config: NegotiationConfig;
    if (deal.negotiationConfigJson) {
      // Use the stored config which includes priority-based thresholds, weights, and strategy
      const storedConfig = deal.negotiationConfigJson as NegotiationConfig & {
        wizardConfig?: unknown;
      };
      if (!storedConfig.parameters) {
        logger.warn(
          `Deal ${input.dealId} stored config missing parameters, rebuilding from source`,
        );
        if (deal.requisitionId) {
          config = await buildConfigFromRequisition(deal.requisitionId);
        } else if (deal.contractId) {
          config = await buildConfigFromContract(deal.contractId);
        } else {
          const { negotiationConfig } = await import("./engine/config.js");
          config = negotiationConfig;
        }
      } else {
        config = {
          parameters: storedConfig.parameters,
          accept_threshold: storedConfig.accept_threshold,
          escalate_threshold: storedConfig.escalate_threshold,
          walkaway_threshold: storedConfig.walkaway_threshold,
          max_rounds: storedConfig.max_rounds,
          priority: storedConfig.priority,
          currency: storedConfig.currency,
        };
        logger.debug(
          `Using stored negotiation config for deal ${input.dealId} (priority: ${config.priority})`,
        );
      }
    } else if (deal.requisitionId) {
      // Fallback: rebuild from requisition (legacy deals without stored config)
      config = await buildConfigFromRequisition(deal.requisitionId);
      logger.warn(
        `Deal ${input.dealId} has no stored config, rebuilding from requisition`,
      );
    } else if (deal.contractId) {
      config = await buildConfigFromContract(deal.contractId);
    } else {
      // Fallback to default config
      const { negotiationConfig } = await import("./engine/config.js");
      config = negotiationConfig;
    }

    // Parse vendor offer from message (with currency conversion)
    const extractedOffer = parseOfferRegex(input.content, requisitionCurrency);

    // Increment round
    const newRound = deal.round + 1;

    // Adaptive behavioral analysis (opt-in)
    const adaptiveFeats = (deal.negotiationConfigJson as any)
      ?.adaptiveFeatures as AdaptiveFeaturesConfig | undefined;
    let behavioralSigs: BehavioralSignals | null = null;
    let adaptiveStrat: AdaptiveStrategyResult | null = null;

    if (adaptiveFeats?.enabled) {
      try {
        const allMsgs = await models.ChatbotMessage.findAll({
          where: { dealId: input.dealId },
          order: [["createdAt", "ASC"]],
        });
        const analyzableMsgs = allMsgs.map((m) => ({
          role: m.role as "VENDOR" | "ACCORDO" | "SYSTEM" | "PM",
          content: m.content,
          extractedOffer: m.extractedOffer as any,
          counterOffer: m.counterOffer as any,
          createdAt: m.createdAt,
        }));
        behavioralSigs = analyzeBehavior(analyzableMsgs, newRound);
        adaptiveStrat = computeAdaptiveStrategy(
          behavioralSigs,
          config,
          newRound,
        );
      } catch (adaptErr) {
        logger.warn(
          `[ProcessVendorMessage] Adaptive analysis failed:`,
          adaptErr,
        );
      }
    }

    // Make decision
    const decision = decideNextMove(
      config,
      extractedOffer,
      newRound,
      undefined,
      undefined,
      behavioralSigs,
      adaptiveStrat,
    );

    // Compute explainability
    const explainability = computeExplainability(
      config,
      extractedOffer,
      decision,
    );

    // Attach behavioral data to explainability
    if (behavioralSigs && adaptiveStrat) {
      (explainability as any).behavioral = {
        momentum: behavioralSigs.momentum,
        strategy: adaptiveStrat.strategyLabel,
        convergenceRate: behavioralSigs.convergenceRate,
        concessionVelocity: behavioralSigs.concessionVelocity,
        isStalling: behavioralSigs.isStalling,
        isConverging: behavioralSigs.isConverging,
        isDiverging: behavioralSigs.isDiverging,
        reasoning: adaptiveStrat.reasoning,
        shouldExtendRounds: adaptiveStrat.shouldExtendRounds,
        latestSentiment: behavioralSigs.latestSentiment,
      };
    }

    // Save VENDOR message
    const vendorMessageId = uuidv4();
    const message = await models.ChatbotMessage.create({
      id: vendorMessageId,
      dealId: input.dealId,
      role: input.role,
      content: input.content,
      extractedOffer: extractedOffer as any,
      engineDecision: null,
      decisionAction: null,
      utilityScore: null,
      counterOffer: null,
      explainabilityJson: null,
    });

    // Generate and save ACCORDO response message
    const accordoResponseText = generateAccordoResponseText(
      decision,
      config,
      extractedOffer,
    );
    const accordoMessageId = uuidv4();
    const accordoMessage = await models.ChatbotMessage.create({
      id: accordoMessageId,
      dealId: input.dealId,
      role: "ACCORDO",
      content: accordoResponseText,
      extractedOffer: null,
      engineDecision: decision as any,
      decisionAction: decision.action,
      utilityScore: decision.utilityScore,
      counterOffer: decision.counterOffer as any,
      explainabilityJson: explainability as any,
    });

    // Update deal with latest state
    let finalStatus: "NEGOTIATING" | "ACCEPTED" | "WALKED_AWAY" | "ESCALATED" =
      deal.status;
    if (decision.action === "ACCEPT") finalStatus = "ACCEPTED";
    else if (decision.action === "WALK_AWAY") finalStatus = "WALKED_AWAY";
    else if (decision.action === "ESCALATE") finalStatus = "ESCALATED";

    await deal.update({
      round: newRound,
      status: finalStatus,
      latestVendorOffer: extractedOffer as any,
      latestOfferJson: decision.counterOffer as any,
      latestDecisionAction: decision.action,
      latestUtility: decision.utilityScore,
    });

    logger.info(
      `Processed vendor message for deal ${input.dealId}: ${decision.action} (utility: ${decision.utilityScore})`,
    );

    // Hook: Sync contract status and capture vendor bid when deal reaches terminal state (fire-and-forget)
    // CRITICAL FIX (Jan 2026): Run these in background to avoid blocking the response
    if (["ACCEPTED", "WALKED_AWAY", "ESCALATED"].includes(finalStatus)) {
      // Sync contract status (fire-and-forget)
      syncContractStatus(deal.id, finalStatus, deal.contractId).catch((err) =>
        logger.error(
          `Failed to sync contract status: ${(err as Error).message}`,
        ),
      );

      // Update vendor negotiation profile (fire-and-forget)
      updateVendorProfileOnDealCompletion(
        deal.id,
        finalStatus as "ACCEPTED" | "WALKED_AWAY" | "ESCALATED",
        deal.vendorId,
      ).catch((err) =>
        logger.error(
          `Failed to update vendor profile: ${(err as Error).message}`,
        ),
      );

      // Fire-and-forget: don't await, just log errors
      captureVendorBid(deal.id)
        .then(() => {
          logger.info(
            `Captured vendor bid for deal ${deal.id} with status ${finalStatus}`,
          );
          if (deal.requisitionId) {
            return checkAndTriggerComparison(deal.requisitionId);
          }
        })
        .catch((bidError) => {
          logger.error(
            `Failed to capture vendor bid: ${(bidError as Error).message}`,
          );
        });
    }

    return { message, accordoMessage, decision, explainability };
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      `Failed to process vendor message: ${(error as Error).message}`,
      500,
    );
  }
};

// ============================================================================
// TWO-PHASE MESSAGE PROCESSING (PM Response Enhancement - January 2026)
// ============================================================================
// Split message processing into two phases:
// Phase 1: saveVendorMessageOnly - instant, saves vendor message
// Phase 2: generatePMResponseAsync - async, generates human-like PM response
// ============================================================================

/**
 * Input for saving vendor message only (Phase 1)
 */
export interface SaveVendorMessageInput {
  dealId: string;
  content: string;
  userId: number;
}

/**
 * Processing state for the PM response pipeline.
 * Frontend uses this to show contextual loading indicators.
 */
export interface ProcessingState {
  /** Current step in the pipeline */
  step:
    | "analyzing_offer"
    | "calculating_utility"
    | "generating_response"
    | "complete";
  /** Estimated time to complete PM response (ms) */
  estimatedMs: number;
  /** Whether the extracted offer is complete (has both price and terms) */
  offerComplete: boolean;
  /** Deal mode that will be used for response generation */
  mode: "INSIGHTS" | "CONVERSATION";
}

/**
 * Result from saving vendor message (Phase 1)
 */
export interface SaveVendorMessageResult {
  message: ChatbotMessage;
  deal: ChatbotDeal;
  extractedOffer: Offer;
  pmProcessing: boolean;
  processingState: ProcessingState;
}

/**
 * Input for generating PM response (Phase 2)
 */
export interface GeneratePMResponseInput {
  dealId: string;
  vendorMessageId: string;
  userId: number;
}

/**
 * Result from PM response generation (Phase 2)
 */
export interface PMResponseResult {
  message: ChatbotMessage;
  decision: Decision;
  explainability: Explainability;
  deal: ChatbotDeal;
  generationSource: "llm" | "fallback";
  meso?: MesoResult | null;
}

/**
 * Phase 1: Save vendor message only (instant, <100ms target)
 *
 * This function saves the vendor message immediately without generating
 * the PM response. It parses the offer (including delivery) and updates
 * the deal round, but does NOT generate or save the Accordo response.
 *
 * @param input - Vendor message input
 * @returns Saved message with deal context
 */
export const saveVendorMessageOnlyService = async (
  input: SaveVendorMessageInput,
): Promise<SaveVendorMessageResult> => {
  try {
    const deal = await models.ChatbotDeal.findByPk(input.dealId, {
      include: [{ model: models.Requisition, as: "Requisition" }],
    });
    if (!deal) {
      throw new CustomError("Deal not found", 404);
    }

    if (deal.status !== "NEGOTIATING") {
      throw new CustomError("Deal is not in negotiating status", 400);
    }

    // Get requisition currency for offer parsing (February 2026)
    const requisition = (deal as any).Requisition;
    const requisitionCurrency = requisition?.typeOfCurrency as
      | "USD"
      | "INR"
      | "EUR"
      | "GBP"
      | "AUD"
      | undefined;

    // Parse vendor offer from message (now includes delivery and currency conversion)
    const currentExtraction = parseOfferWithDelivery(
      input.content,
      requisitionCurrency,
    );

    // Calculate the round for this message pair
    // Vendor message STARTS a new round, PM response CONCLUDES it
    // deal.round represents COMPLETED rounds, so new round = deal.round + 1
    const currentRound = deal.round + 1;

    // Save VENDOR message with round number
    const vendorMessageId = uuidv4();

    // OFFER ACCUMULATION: Merge partial offers across messages
    // If vendor provides complete offer (price AND terms), reset accumulation
    // Otherwise, merge with previously accumulated state
    const previousAccumulated =
      deal.latestVendorOffer as AccumulatedOffer | null;
    let accumulatedOffer: AccumulatedOffer;

    if (shouldResetAccumulation(currentExtraction)) {
      // Vendor provided complete offer (price AND terms) - start fresh
      accumulatedOffer = createAccumulatedOffer(
        currentExtraction,
        vendorMessageId,
      );
      logger.info(
        `[Phase1] Complete offer detected, resetting accumulation for deal ${input.dealId}`,
      );
    } else {
      // Only merge with previous if the previous offer was also incomplete (partial chain).
      // If previous was complete, treat this as a new partial offer — don't inherit old terms/price.
      const previousWasIncomplete =
        previousAccumulated && !previousAccumulated.accumulation?.isComplete;
      accumulatedOffer = mergeOffers(
        previousWasIncomplete ? previousAccumulated : null,
        currentExtraction,
        vendorMessageId,
      );
      logger.info(`[Phase1] Partial offer for deal ${input.dealId}`, {
        mergedWithPrevious: !!previousWasIncomplete,
        provided: getProvidedComponents(currentExtraction),
        missing: getMissingComponents(accumulatedOffer),
        isComplete: accumulatedOffer.accumulation.isComplete,
      });
    }

    // Use accumulated offer as the extracted offer
    const extractedOffer = accumulatedOffer;

    const message = await models.ChatbotMessage.create({
      id: vendorMessageId,
      dealId: input.dealId,
      role: "VENDOR",
      content: input.content,
      extractedOffer: extractedOffer as any,
      engineDecision: null,
      decisionAction: null,
      utilityScore: null,
      counterOffer: null,
      explainabilityJson: null,
      round: currentRound, // Set round on vendor message
    });

    // Update deal with latest vendor offer (but DON'T increment round yet - that happens after PM response)
    await deal.update({
      latestVendorOffer: extractedOffer as any,
      lastMessageAt: new Date(),
    });

    logger.info(
      `[Phase1] Vendor message saved for deal ${input.dealId} (round ${currentRound}, awaiting PM response)`,
    );

    // Build processing state for frontend loading indicators
    const dealMode = (deal.mode as "INSIGHTS" | "CONVERSATION") || "INSIGHTS";
    const offerIsComplete = accumulatedOffer.accumulation?.isComplete ?? false;
    const processingState: ProcessingState = {
      step: "analyzing_offer",
      estimatedMs: dealMode === "CONVERSATION" ? 4000 : 1500,
      offerComplete: offerIsComplete,
      mode: dealMode,
    };

    return {
      message,
      deal,
      extractedOffer,
      pmProcessing: true,
      processingState,
    };
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      `Failed to save vendor message: ${(error as Error).message}`,
      500,
    );
  }
};

/**
 * Phase 2: Generate PM response asynchronously (1-5 seconds expected)
 *
 * This function generates a human-like PM response using the LLM.
 * It analyzes the conversation context, detects vendor tone, extracts
 * concerns, and generates an appropriate response with delivery terms.
 *
 * Falls back to enhanced templates if LLM fails or times out.
 *
 * @param input - PM response input with vendor message ID
 * @returns PM response with decision and explainability
 */
export const generatePMResponseAsyncService = async (
  input: GeneratePMResponseInput,
): Promise<PMResponseResult> => {
  try {
    const deal = await models.ChatbotDeal.findByPk(input.dealId);
    if (!deal) {
      throw new CustomError("Deal not found", 404);
    }

    const vendorMessage = await models.ChatbotMessage.findByPk(
      input.vendorMessageId,
    );
    if (!vendorMessage) {
      throw new CustomError("Vendor message not found", 404);
    }

    // Scope Guard: reject off-topic messages before expensive processing
    const scopeCheck = checkScopeGuard(
      vendorMessage.content,
      deal.title ?? undefined,
    );
    if (scopeCheck.isOffTopic) {
      logger.info(
        `[Phase2] Off-topic message blocked by scope guard for deal ${input.dealId}`,
        {
          category: scopeCheck.category,
          confidence: scopeCheck.confidence,
        },
      );

      // Save the redirection response as an ACCORDO message
      const redirectMessage = await models.ChatbotMessage.create({
        id: uuidv4(),
        dealId: input.dealId,
        role: "ACCORDO",
        content: scopeCheck.response!,
        extractedOffer: null,
        engineDecision: {
          action: "REDIRECT",
          reason: `Off-topic: ${scopeCheck.category}`,
        } as any,
        decisionAction: "REDIRECT",
        utilityScore: deal.latestUtility ?? null,
        counterOffer: null,
        explainabilityJson: null,
        round: deal.round,
      });

      return {
        message: redirectMessage,
        decision: {
          action: "REDIRECT" as any,
          utilityScore: deal.latestUtility ?? 0,
          counterOffer: null,
          reasons: [`Off-topic message: ${scopeCheck.category}`],
        },
        explainability: {} as Explainability,
        deal,
        generationSource: "fallback" as const,
        meso: null,
      };
    }

    // Get conversation history for context
    const allMessages = await models.ChatbotMessage.findAll({
      where: { dealId: input.dealId },
      order: [["createdAt", "ASC"]],
    });

    // Use stored negotiation config from deal (includes priority-adjusted thresholds and weights)
    let config: NegotiationConfig;
    if (deal.negotiationConfigJson) {
      const storedConfig = deal.negotiationConfigJson as NegotiationConfig & {
        wizardConfig?: unknown;
      };
      // If parameters is missing from stored config (e.g. wizard-only deals), rebuild from requisition/contract
      if (!storedConfig.parameters) {
        logger.warn(
          `[Phase2] Deal ${input.dealId} stored config missing parameters, rebuilding from source`,
        );
        if (deal.requisitionId) {
          config = await buildConfigFromRequisition(deal.requisitionId);
        } else if (deal.contractId) {
          config = await buildConfigFromContract(deal.contractId);
        } else {
          const { negotiationConfig } = await import("./engine/config.js");
          config = negotiationConfig;
        }
      } else {
        config = {
          parameters: storedConfig.parameters,
          accept_threshold: storedConfig.accept_threshold,
          escalate_threshold: storedConfig.escalate_threshold,
          walkaway_threshold: storedConfig.walkaway_threshold,
          max_rounds: storedConfig.max_rounds,
          priority: storedConfig.priority,
          currency: storedConfig.currency,
        };
      }
    } else if (deal.requisitionId) {
      config = await buildConfigFromRequisition(deal.requisitionId);
    } else if (deal.contractId) {
      config = await buildConfigFromContract(deal.contractId);
    } else {
      const { negotiationConfig } = await import("./engine/config.js");
      config = negotiationConfig;
    }

    // Backfill currency from requisition for legacy deals that don't have it in stored config
    if (!config.currency && deal.requisitionId) {
      try {
        const reqForCurrency = await models.Requisition.findByPk(
          deal.requisitionId,
          { attributes: ["typeOfCurrency"] },
        );
        if (reqForCurrency?.typeOfCurrency) {
          config.currency = reqForCurrency.typeOfCurrency as string;
        }
      } catch {
        /* non-critical */
      }
    }

    // Get vendor offer from the message (may be an AccumulatedOffer)
    let extractedOffer =
      (vendorMessage.extractedOffer as Offer | AccumulatedOffer) ||
      parseOfferWithDelivery(vendorMessage.content);

    // Get current negotiation state from deal (stored in convoStateJson)
    let negotiationState: NegotiationState | null =
      deal.convoStateJson as NegotiationState | null;

    // Find previous vendor offer for concession tracking
    const previousVendorMessages = allMessages.filter(
      (m) => m.role === "VENDOR" && m.id !== input.vendorMessageId,
    );
    const previousVendorMessage =
      previousVendorMessages.length > 0
        ? previousVendorMessages[previousVendorMessages.length - 1]
        : null;
    const previousVendorOffer = previousVendorMessage?.extractedOffer as
      | Offer
      | AccumulatedOffer
      | null;

    // Get previous PM counter-offer
    const previousPmOffer = negotiationState
      ? getLastPmCounter(negotiationState)
      : null;

    // Affirmative detection: if vendor sends a short acceptance message ("ok", "agreed", "deal", etc.)
    // force ACCEPT using the PM's last counter — bypass utility scoring entirely.
    const AFFIRMATIVE_PATTERN =
      /^\s*(ok|okay|sure|agreed|deal|yes|accept|accepted|confirm|confirmed|sounds good|looks good|that works|perfect|fine|great|done|alright|alright then|absolutely|of course|works for me|i accept|we accept|i agree|we agree)\s*[.!]?\s*$/i;
    const rawContent = vendorMessage.content.trim();
    const isVendorAffirmative =
      AFFIRMATIVE_PATTERN.test(rawContent) && previousPmOffer != null;
    if (isVendorAffirmative && previousPmOffer) {
      logger.info(
        `[Phase2] Affirmative message detected ("${vendorMessage.content}") — forcing ACCEPT on PM's last counter`,
        {
          dealId: input.dealId,
          pmCounter: previousPmOffer,
        },
      );
      extractedOffer = {
        total_price: previousPmOffer.price,
        payment_terms: previousPmOffer.terms,
        delivery_days: previousPmOffer.deliveryDays ?? null,
        delivery_date: null,
      };
    }

    // DEBUG: Log config.parameters to diagnose crash
    if (!config.parameters) {
      logger.error(
        `[Phase2] CRITICAL: config.parameters is undefined for deal ${input.dealId}`,
        {
          configKeys: config ? Object.keys(config) : "config is null",
          negotiationConfigJsonKeys: deal.negotiationConfigJson
            ? Object.keys(deal.negotiationConfigJson)
            : "null",
        },
      );
    }

    // Get price config with fallback defaults
    const priceConfig = config.parameters?.total_price ??
      ((config.parameters as Record<string, unknown>)
        ?.unit_price as typeof config.parameters.total_price) ?? {
        target: 1000,
        max_acceptable: 1500,
      };

    // Update negotiation state with new data
    negotiationState = updateNegotiationState(
      negotiationState,
      previousVendorOffer,
      extractedOffer,
      vendorMessage.content,
      null, // PM counter will be added after decision
      deal.round + 1,
      {
        pmTargetPrice: priceConfig.target ?? 1000,
        pmMaxPrice: priceConfig.max_acceptable ?? 1500,
        pmMinTermsDays: 30, // Default minimum
        pmMaxTermsDays: 90, // Default maximum
      },
    );

    // Detect MESO selection from vendor message (February 2026)
    const mesoSelectionType = detectMesoSelectionFromMessage(
      vendorMessage.content,
    );
    if (mesoSelectionType) {
      // Extract option ID from message if possible, otherwise generate one
      const optionIdMatch = vendorMessage.content.match(
        /meso_\d+_(price|terms|balanced)/,
      );
      const optionId = optionIdMatch
        ? optionIdMatch[0]
        : `meso_${deal.round + 1}_${mesoSelectionType}`;

      negotiationState = recordMesoSelection(
        negotiationState,
        mesoSelectionType,
        optionId,
        deal.round + 1,
      );

      logger.info(`[Phase2] MESO selection detected: ${mesoSelectionType}`, {
        dealId: input.dealId,
        round: deal.round + 1,
        consecutiveBalanced: negotiationState.consecutiveBalancedSelections,
        inExploration: isInPreferenceExploration(negotiationState),
        explorationRoundsRemaining:
          getPreferenceExplorationRoundsRemaining(negotiationState),
      });
    }

    logger.info(`[Phase2] Negotiation state updated for deal ${input.dealId}`, {
      vendorEmphasis: negotiationState.vendorEmphasis,
      emphasisConfidence: negotiationState.emphasisConfidence,
      priceConcessions: negotiationState.priceConcessions?.length ?? 0,
      termsConcessions: negotiationState.termsConcessions?.length ?? 0,
      mesoSelections: negotiationState.mesoSelections?.length ?? 0,
      consecutiveBalanced: negotiationState.consecutiveBalancedSelections ?? 0,
    });

    // Adaptive behavioral analysis (opt-in via adaptiveFeatures.enabled)
    const adaptiveFeatures = (deal.negotiationConfigJson as any)
      ?.adaptiveFeatures as AdaptiveFeaturesConfig | undefined;
    let behavioralSignals: BehavioralSignals | null = null;
    let adaptiveStrategy: AdaptiveStrategyResult | null = null;

    if (adaptiveFeatures?.enabled) {
      try {
        // Compute behavioral signals from all messages
        const analyzableMessages = allMessages.map((m) => ({
          role: m.role as "VENDOR" | "ACCORDO" | "SYSTEM" | "PM",
          content: m.content,
          extractedOffer: m.extractedOffer as any,
          counterOffer: m.counterOffer as any,
          createdAt: m.createdAt,
        }));

        behavioralSignals = analyzeBehavior(analyzableMessages, deal.round + 1);
        adaptiveStrategy = computeAdaptiveStrategy(
          behavioralSignals,
          config,
          deal.round + 1,
        );

        logger.info(`[Phase2] Adaptive analysis for deal ${input.dealId}`, {
          strategy: adaptiveStrategy.strategyLabel,
          momentum: behavioralSignals.momentum,
          convergenceRate: behavioralSignals.convergenceRate,
          isStalling: behavioralSignals.isStalling,
          adjustedAggressiveness: adaptiveStrategy.adjustedAggressiveness,
        });
      } catch (adaptiveError) {
        // Non-critical: fall back to standard decision engine
        logger.warn(
          `[Phase2] Adaptive analysis failed for deal ${input.dealId}, using standard engine:`,
          adaptiveError,
        );
      }
    }

    // ========================================================================
    // FEATURE 2 — Payment-terms prompt interception
    // ========================================================================
    // If the vendor's LATEST message contained a price but no payment terms,
    // AND we are NOT currently inside a MESO presentation cycle, AND the
    // initial-discount flow has already been resolved (so we don't fight with
    // Feature 1), bypass the engine for this turn and return a templated
    // "ask for payment terms" message. The frontend renders a dropdown
    // instead of a free-text composer; the vendor's reply comes back via the
    // dedicated /payment-terms endpoint which will then run the engine with
    // a complete offer.
    //
    // IMPORTANT: we re-parse the raw message content here instead of reading
    // `extractedOffer`, because `extractedOffer` is the result of
    // `mergeOffers(prev, current)` and still carries forward terms from
    // previous rounds. The client wants the prompt to fire whenever the
    // *current* message contains only a price, regardless of whether prior
    // rounds had terms attached.
    {
      const currentMsgExtraction = parseOfferWithDelivery(
        vendorMessage.content,
        config.currency as "USD" | "INR" | "EUR" | "GBP" | "AUD" | undefined,
      );
      const hasPriceInCurrentMsg =
        currentMsgExtraction?.total_price != null &&
        Number.isFinite(currentMsgExtraction.total_price);
      const termsMissingInCurrentMsg =
        currentMsgExtraction?.payment_terms == null &&
        currentMsgExtraction?.payment_terms_days == null;

      // MESO interlock — if a MESO round was shown recently we must not
      // steal that turn with a payment-terms prompt. `mesoCycleState` is
      // authoritative for "are we inside a MESO cycle right now".
      const mesoState = negotiationState.mesoCycleState;
      const inMesoCycle =
        !!mesoState &&
        mesoState.lastMesoShownAtRound > 0 &&
        mesoState.lastMesoShownAtRound >= deal.round; // MESO shown this round or later

      // Only trigger once the initial discount flow is settled. The flow is
      // settled when the deal's config carries `initialDiscount`.
      const discountSettled =
        (deal.negotiationConfigJson as any)?.initialDiscount != null;

      // Guard against re-asking: if the most recent ACCORDO message already
      // has a pending payment_terms prompt, the frontend composer should
      // already be in dropdown mode and the vendor should be answering via
      // the dedicated endpoint — not this path. Skip to avoid a duplicate
      // prompt.
      const latestAccordoMsg = [...allMessages]
        .reverse()
        .find((m: ChatbotMessage) => m.role === "ACCORDO");
      const latestPendingPrompt = (latestAccordoMsg?.engineDecision as any)
        ?.pendingPrompt;
      const alreadyAsked = latestPendingPrompt?.type === "payment_terms";

      if (
        hasPriceInCurrentMsg &&
        termsMissingInCurrentMsg &&
        !inMesoCycle &&
        discountSettled &&
        !alreadyAsked
      ) {
        logger.info(
          `[PaymentTermsPrompt] Triggered for deal ${input.dealId} — ` +
            `current msg has price but no terms, not in MESO, discount settled`,
        );

        const { buildPaymentTermsPromptMessage } =
          await import("../vendor-chat/structured-prompts.js");
        const { content: promptContent, pendingPrompt } =
          buildPaymentTermsPromptMessage();

        const promptMessage = await models.ChatbotMessage.create({
          id: uuidv4(),
          dealId: input.dealId,
          role: "ACCORDO",
          content: promptContent,
          extractedOffer: null,
          engineDecision: {
            action: "PAYMENT_TERMS_PROMPT",
            pendingPrompt,
          } as any,
          decisionAction: "PAYMENT_TERMS_PROMPT",
          utilityScore: null,
          counterOffer: null,
          explainabilityJson: null,
          round: deal.round,
        });

        // Don't increment round, don't run engine. Return a minimal
        // PMResponseResult-shaped object.
        return {
          message: promptMessage,
          decision: {
            action: "ASK_CLARIFY" as any,
            utilityScore: deal.latestUtility ?? 0,
            counterOffer: null,
            reasons: ["Awaiting payment terms from vendor via dropdown"],
          },
          explainability: {} as Explainability,
          deal,
          generationSource: "fallback" as const,
          meso: null,
        };
      }
    }

    // Rejection detection: vendor expressing disagreement (e.g., "not possible", "too low margin")
    // If detected, never accept — even if utility is high enough
    const REJECTION_PATTERN =
      /\b(not\s+possible|not\s+acceptable|not\s+feasible|cannot\s+accept|can'?t\s+accept|too\s+low|too\s+high|too\s+much|not\s+workable|not\s+viable|impossible|unacceptable|won'?t\s+work|doesn'?t\s+work|low\s+margin|no\s+margin|thin\s+margin|reject|decline)\b/i;
    const isVendorRejecting = REJECTION_PATTERN.test(rawContent);

    // Vendor-convergence ACCEPT (Apr 2026): when the vendor's NEW price is
    //   (a) within our maxAcceptable ceiling, AND
    //   (b) lower than their previous offer (i.e. they moved toward us),
    // close the deal at the vendor's price instead of generating yet another
    // counter. Catches the "vendor said 29K which we'd have accepted, but we
    // re-offered 28K and prolonged the negotiation" failure mode.
    const priceCfg =
      config.parameters?.total_price ??
      ((config.parameters as Record<string, unknown>)
        ?.unit_price as typeof config.parameters.total_price);
    const maxAcceptable = priceCfg?.max_acceptable;
    const previousVendorPrice =
      (previousVendorOffer as any)?.total_price ?? null;
    const currentVendorPrice = extractedOffer?.total_price ?? null;
    const isVendorConverging =
      !isVendorAffirmative &&
      currentVendorPrice != null &&
      maxAcceptable != null &&
      currentVendorPrice <= maxAcceptable &&
      previousVendorPrice != null &&
      currentVendorPrice < previousVendorPrice;
    if (isVendorConverging) {
      logger.info(
        `[Phase2] Vendor-convergence ACCEPT — vendor moved from ${previousVendorPrice} to ${currentVendorPrice} (within ceiling ${maxAcceptable})`,
        { dealId: input.dealId },
      );
    }

    // Make decision using the engine with negotiation state for dynamic counters
    // If vendor sent an affirmative, force ACCEPT — don't run utility scoring
    let decision = isVendorAffirmative
      ? {
          action: "ACCEPT" as const,
          utilityScore: 1.0,
          counterOffer: null as Offer | null,
          reasons: [
            `Vendor accepted PM's counter offer of ${getCurrencySymbol(config.currency)}${extractedOffer.total_price} with ${extractedOffer.payment_terms}.`,
          ],
        }
      : isVendorConverging
        ? {
            action: "ACCEPT" as const,
            utilityScore: 1.0,
            counterOffer: null as Offer | null,
            reasons: [
              `Vendor moved from ${getCurrencySymbol(config.currency)}${previousVendorPrice} to ${getCurrencySymbol(config.currency)}${currentVendorPrice}, within our acceptable range.`,
            ],
          }
        : decideNextMove(
            config,
            extractedOffer,
            deal.round,
            negotiationState,
            previousPmOffer,
            behavioralSignals,
            adaptiveStrategy,
          );

    // Guard: override ACCEPT → COUNTER if vendor is expressing rejection
    if (isVendorRejecting && decision.action === "ACCEPT") {
      logger.info(
        `[Phase2] Overriding ACCEPT → COUNTER due to vendor rejection language in message`,
        {
          dealId: input.dealId,
          message: rawContent.substring(0, 100),
        },
      );
      decision = decideNextMove(
        config,
        extractedOffer,
        deal.round,
        negotiationState,
        previousPmOffer,
        behavioralSignals,
        adaptiveStrategy,
      );
      // If the engine still returns ACCEPT (utility very high), force a COUNTER
      if (decision.action === "ACCEPT") {
        const priceConfig =
          config.parameters?.total_price ??
          ((config.parameters as Record<string, unknown>)
            ?.unit_price as typeof config.parameters.total_price);
        let counterPrice = priceConfig
          ? Math.round(
              (priceConfig.target +
                (priceConfig.max_acceptable - priceConfig.target) * 0.5) *
                100,
            ) / 100
          : (extractedOffer.total_price ?? 0) * 0.9;
        // Never counter above vendor's offer
        if (
          extractedOffer.total_price != null &&
          counterPrice > extractedOffer.total_price
        ) {
          counterPrice = extractedOffer.total_price;
        }
        decision = {
          action: "COUNTER",
          utilityScore: decision.utilityScore,
          counterOffer: {
            total_price: counterPrice,
            payment_terms: extractedOffer.payment_terms,
          },
          reasons: [
            ...decision.reasons,
            "Overridden: vendor expressed rejection — cannot accept",
          ],
        };
      }
    }

    // Compute explainability
    const explainability = computeExplainability(
      config,
      extractedOffer,
      decision,
    );

    // Attach behavioral data to explainability for frontend display
    if (behavioralSignals && adaptiveStrategy) {
      (explainability as any).behavioral = {
        momentum: behavioralSignals.momentum,
        strategy: adaptiveStrategy.strategyLabel,
        convergenceRate: behavioralSignals.convergenceRate,
        concessionVelocity: behavioralSignals.concessionVelocity,
        isStalling: behavioralSignals.isStalling,
        isConverging: behavioralSignals.isConverging,
        isDiverging: behavioralSignals.isDiverging,
        reasoning: adaptiveStrategy.reasoning,
        shouldExtendRounds: adaptiveStrategy.shouldExtendRounds,
        latestSentiment: behavioralSignals.latestSentiment,
      };
    }

    // Cap counter-offer payment terms to vendor's stated maximum (if any)
    // e.g., if vendor said "max I can do is net 60", don't counter with net 90
    if (decision.counterOffer?.payment_terms) {
      const vendorMaxDays = extractVendorMaxTermsDays(vendorMessage.content);
      if (vendorMaxDays !== null) {
        const cappedTerms = capTermsToVendorMax(
          decision.counterOffer.payment_terms,
          vendorMaxDays,
        );
        if (cappedTerms !== decision.counterOffer.payment_terms) {
          logger.info(
            `[Phase2] Capped counter payment terms from ${decision.counterOffer.payment_terms} to ${cappedTerms} (vendor max: Net ${vendorMaxDays})`,
            { dealId: input.dealId },
          );
          decision.counterOffer.payment_terms = cappedTerms;
        }
      }
    }

    // Guard: PM counter price must NEVER exceed vendor's current offer price
    // This is a fundamental procurement principle — buyer always negotiates DOWN
    if (
      decision.counterOffer?.total_price != null &&
      extractedOffer.total_price != null
    ) {
      if (decision.counterOffer.total_price > extractedOffer.total_price) {
        logger.info(
          `[Phase2] Capping counter price from ${decision.counterOffer.total_price} to vendor's offer ${extractedOffer.total_price}`,
          { dealId: input.dealId },
        );
        decision.counterOffer.total_price = extractedOffer.total_price;
      }
    }

    // Update negotiation state with PM's counter-offer (if any)
    if (decision.counterOffer) {
      negotiationState = updateNegotiationState(
        negotiationState,
        previousVendorOffer,
        extractedOffer,
        vendorMessage.content,
        decision.counterOffer,
        deal.round + 1,
        {
          pmTargetPrice: priceConfig.target ?? 1000,
          pmMaxPrice: priceConfig.max_acceptable ?? 1500,
          pmMinTermsDays: 30,
          pmMaxTermsDays: 90,
        },
      );
    }

    // Record utility score for stall detection (Feb 2026)
    negotiationState = recordUtilityScore(
      negotiationState,
      deal.round,
      decision.utilityScore,
    );

    // Build delivery config from deal's wizard configuration
    const dealConfig = deal.get("configJson") as
      | { delivery?: { requiredDate?: string; preferredDate?: string } }
      | undefined;
    const deliveryConfig: DeliveryConfig | undefined = dealConfig?.delivery
      ?.requiredDate
      ? {
          requiredDate: dealConfig.delivery.requiredDate,
          preferredDate: dealConfig.delivery.preferredDate,
          maxLateDays: 14, // Default 2 weeks grace period
        }
      : undefined;

    // ========================================================================
    // MESO Generation (Multiple Equivalent Simultaneous Offers)
    // ========================================================================
    // Enhanced MESO with:
    // 1. Stall detection - "Is this your final offer?" prompt
    // 2. Dynamic MESO - Learning-based offer generation
    // 3. Final MESO - Deal closure at 75%+ utility
    // ========================================================================
    let mesoResult: MesoResult | null = null;
    let stallPrompt: string | null = null;
    const currentRoundForMeso = deal.round + 1;
    const mesoEnabled =
      (deal.negotiationConfigJson as any)?.mesoEnabled !== false; // Default to enabled

    // Build resolved config for MESO generation (needed for multiple checks)
    const wizardConfig = (deal.negotiationConfigJson as any)?.wizardConfig;
    const resolvedConfig = resolveNegotiationConfig(wizardConfig || {});
    // Deal currency is stored on the negotiation config at deal creation (see createDealWithConfigService).
    // Threaded through to all MESO generators so every option's price label uses the requisition currency.
    const dealCurrency = ((deal.negotiationConfigJson as any)?.currency ||
      "USD") as SupportedCurrency;

    // ========================================================================
    // STALL DETECTION (February 2026)
    // Track vendor parameter history and detect stall patterns
    // ========================================================================
    let parameterHistories: ParameterHistory[] =
      (deal.convoStateJson as any)?.parameterHistories || [];

    // Track current vendor offer in parameter history
    if (extractedOffer) {
      parameterHistories = trackOffer(
        parameterHistories,
        extractedOffer as any,
        currentRoundForMeso,
      );

      // Check for stall pattern (vendor repeating same value 3+ rounds)
      stallPrompt = shouldAskFinalOffer(
        parameterHistories,
        currentRoundForMeso,
        3,
      );

      if (stallPrompt) {
        logger.info(
          `[STALL] Detected stall pattern for deal ${deal.id} round ${currentRoundForMeso}`,
          {
            prompt: stallPrompt.substring(0, 100) + "...",
          },
        );
      }
    }

    // Store updated parameter histories in negotiation state
    if (negotiationState) {
      (negotiationState as any).parameterHistories = parameterHistories;
    }

    // ========================================================================
    // FINAL MESO CHECK (75%+ utility trigger)
    // ========================================================================
    const isFinalMesoTrigger = shouldTriggerFinalMeso(
      decision.utilityScore,
      currentRoundForMeso,
      0.75, // 75% utility threshold
    );

    if (isFinalMesoTrigger) {
      logger.info(
        `[MESO] Final MESO triggered for deal ${deal.id} - utility ${(decision.utilityScore * 100).toFixed(1)}% >= 75%`,
      );
    }

    // Check previous MESO rounds to get the last one for dynamic generation
    const previousMesoRounds = await models.MesoRound.findAll({
      where: { dealId: deal.id },
      order: [["round", "DESC"]],
      limit: 1,
    });
    const previousMesoRoundsCount = await models.MesoRound.count({
      where: { dealId: deal.id },
    });

    // ========================================================================
    // PHASED MESO CHECK (February 2026)
    // Use new shouldUseMeso() with cycle state and final offer state
    // ========================================================================
    const mesoCheckParams: ShouldUseMesoParams = {
      round: currentRoundForMeso,
      mesoCycleState: negotiationState.mesoCycleState,
      finalOfferState: negotiationState.finalOfferState,
    };
    const mesoCheckResult: ShouldUseMesoResult = shouldUseMeso(mesoCheckParams);
    const mesoShouldApply = mesoCheckResult.shouldShow;

    // Increment post-Others round counter if we're in that phase
    if (
      negotiationState.mesoCycleState?.inPostOthersPhase &&
      !mesoShouldApply
    ) {
      negotiationState.mesoCycleState = incrementPostOthersRound(
        negotiationState.mesoCycleState,
      );
    }

    // Check for escalation triggers
    const lastOthersPrice =
      negotiationState.othersFormState?.lastOthersOffer?.totalPrice;
    const escalationCheck = checkEscalationTriggers(
      negotiationState.mesoCycleState,
      negotiationState.finalOfferState,
      lastOthersPrice,
    );

    if (escalationCheck.shouldEscalate) {
      logger.info(
        `[MESO] Escalation triggered for deal ${deal.id}: ${escalationCheck.reason}`,
      );
      // Force escalation decision
      decision.action = "ESCALATE";
    }

    // MESO should trigger on:
    // 1. COUNTER decisions (normal case), OR
    // 2. When phase logic says to show MESO
    const mesoDecisionOk =
      decision.action === "COUNTER" ||
      decision.action === "MESO" ||
      mesoCheckResult.phase === "MESO_PRESENTATION" ||
      mesoCheckResult.phase === "FINAL_MESO";

    logger.info(
      `[MESO] Check: action=${decision.action}, enabled=${mesoEnabled}, round=${currentRoundForMeso}, maxRounds=${config.max_rounds}, phase=${mesoCheckResult.phase}, shouldApply=${mesoShouldApply}, showOthers=${mesoCheckResult.showOthers}, isFinal=${mesoCheckResult.isFinal}`,
    );

    // Force MESO when decision engine explicitly requests it (counter = vendor offer)
    const forceMeso = decision.action === "MESO";
    if (mesoDecisionOk && mesoEnabled && (mesoShouldApply || forceMeso)) {
      try {
        // Determine which MESO generation strategy to use
        if (isFinalMesoTrigger) {
          // ========================================================================
          // FINAL MESO - Generate final 3 offers for deal closure
          // ========================================================================
          mesoResult = generateFinalMesoOptions(
            resolvedConfig,
            extractedOffer as any,
            currentRoundForMeso,
            decision.utilityScore,
            dealCurrency,
          );

          if (mesoResult.success) {
            logger.info(
              `[MESO] Generated FINAL MESO options for deal ${deal.id}`,
              {
                targetUtility: mesoResult.targetUtility,
                variance: mesoResult.variance,
              },
            );
          }
        } else if (previousMesoRounds.length > 0) {
          // ========================================================================
          // DYNAMIC MESO - Learning-based generation with different values
          // ========================================================================
          const lastMesoRound = previousMesoRounds[0];
          const previousMeso: PreviousMesoRound = {
            round: lastMesoRound.round,
            options: lastMesoRound.options as MesoOption[],
            selectedOptionId: lastMesoRound.selectedOptionId ?? undefined,
          };

          mesoResult = generateDynamicMesoOptions(
            resolvedConfig,
            extractedOffer as any,
            currentRoundForMeso,
            negotiationState,
            previousMeso,
            decision.utilityScore + 0.05, // Target slightly higher utility than current
            dealCurrency,
          );

          if (mesoResult.success) {
            logger.info(
              `[MESO] Generated DYNAMIC MESO options for deal ${deal.id}`,
              {
                targetUtility: mesoResult.targetUtility,
                variance: mesoResult.variance,
                hasPreviousMeso: true,
              },
            );
          }
        } else {
          // ========================================================================
          // STANDARD MESO - First MESO generation (no history yet)
          // ========================================================================
          mesoResult = generateMesoOptions(
            resolvedConfig,
            extractedOffer as any,
            currentRoundForMeso,
            decision.utilityScore + 0.05, // Target slightly higher utility than current
            dealCurrency,
            (deal.latestOfferJson as any)?.total_price ?? null,
          );

          if (mesoResult.success) {
            logger.info(
              `[MESO] Generated INITIAL MESO options for deal ${deal.id}`,
              {
                targetUtility: mesoResult.targetUtility,
                variance: mesoResult.variance,
              },
            );
          }
        }

        if (mesoResult && mesoResult.success && mesoResult.options.length > 0) {
          // Update MESO cycle state when MESO is shown
          negotiationState.mesoCycleState = updateMesoCycleStateOnShow(
            negotiationState.mesoCycleState,
            currentRoundForMeso,
          );

          // Apply flow control flags from mesoCheckResult
          mesoResult.showOthers = mesoCheckResult.showOthers;
          mesoResult.isFinal = mesoCheckResult.isFinal;
          mesoResult.inputDisabled = mesoCheckResult.inputDisabled;
          mesoResult.disabledMessage = mesoCheckResult.disabledMessage;
          mesoResult.phase = mesoCheckResult.phase;

          // Add stall prompt if detected
          if (stallPrompt) {
            mesoResult.stallPrompt = stallPrompt;
          }

          // Store MESO round in database
          await models.MesoRound.create({
            id: uuidv4(),
            dealId: deal.id,
            round: currentRoundForMeso,
            options: mesoResult.options as any,
            targetUtility: mesoResult.targetUtility,
            variance: mesoResult.variance,
            vendorSelection: null,
            selectedOptionId: null,
            inferredPreferences: null,
            preferenceConfidence: null,
            metadata: {
              vendorOfferId: vendorMessage.id,
              generatedAt: new Date().toISOString(),
              isFinal: mesoCheckResult.isFinal,
              showOthers: mesoCheckResult.showOthers,
              phase: mesoCheckResult.phase,
              stallPrompt: stallPrompt || undefined,
              generationType: mesoCheckResult.isFinal
                ? "final"
                : previousMesoRounds.length > 0
                  ? "dynamic"
                  : "initial",
              mesoCycleNumber: negotiationState.mesoCycleState?.mesoCycleNumber,
            },
          });

          logger.info(
            `[MESO] Generated ${mesoResult.options.length} options for deal ${deal.id} round ${currentRoundForMeso}`,
            {
              targetUtility: mesoResult.targetUtility,
              variance: mesoResult.variance,
              options: mesoResult.options.map((o) => ({
                id: o.id,
                label: o.label,
                utility: o.utility,
              })),
              phase: mesoCheckResult.phase,
              showOthers: mesoCheckResult.showOthers,
              isFinal: mesoCheckResult.isFinal,
              mesoCycleNumber: negotiationState.mesoCycleState?.mesoCycleNumber,
              hasStallPrompt: !!stallPrompt,
            },
          );
        } else {
          logger.info(
            `[MESO] Generation not successful for deal ${deal.id}: ${mesoResult?.reason || "unknown"}`,
          );
          mesoResult = null; // Reset to null if not successful
        }
      } catch (mesoError) {
        logger.warn(
          `[MESO] Failed to generate options for deal ${deal.id}:`,
          mesoError,
        );
        mesoResult = null;
      }
    }

    // Generate human-like response using LLM with fallback
    // Sanitize conversation history to remove stale negotiation context before LLM call
    const rawHistory = allMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const { messages: conversationHistory, sanitizedCount } =
      sanitizeNegotiationHistory(rawHistory);
    if (sanitizedCount > 0) {
      logger.info(
        `[Phase2] Sanitized ${sanitizedCount} stale messages from conversation history for deal ${input.dealId}`,
      );
    }

    // For ASK_CLARIFY, get the current partial extraction to show what was just provided
    const currentExtraction = parseOfferWithDelivery(vendorMessage.content);
    const accumulatedOffer =
      "accumulation" in extractedOffer
        ? (extractedOffer as AccumulatedOffer)
        : undefined;

    // For MESO decisions, treat as COUNTER for response generation so LLM produces
    // a natural "let me present some options" message instead of an unknown action fallback
    const responseDecision =
      decision.action === "MESO"
        ? { ...decision, action: "COUNTER" as const }
        : decision;

    const responseResult = await generateHumanLikeResponse({
      decision: responseDecision,
      config,
      conversationHistory,
      vendorOffer: extractedOffer,
      counterOffer: decision.counterOffer,
      deliveryConfig,
      dealTitle: deal.title,
      round: deal.round,
      maxRounds: config.max_rounds,
      currentExtraction:
        decision.action === "ASK_CLARIFY" ? currentExtraction : undefined,
      accumulatedOffer:
        decision.action === "ASK_CLARIFY" ? accumulatedOffer : undefined,
    });

    // Humanization pass (Apr 2026): the legacy response-generator output
    // bypassed the persona-renderer pipeline and leaked AI-tells (em-dashes,
    // exclamation marks, "we'd love to", etc.). Run it through the same
    // validator + sanitizer used on the buyer-side path. On validation
    // failure, fall back to the humanized template pool.
    let finalResponseContent: string;
    try {
      const tonePrimary: any =
        ((deal as any).convoStateJson as any)?.detectedTone ?? "formal";
      const humanizationIntent: NegotiationIntent = buildNegotiationIntent({
        action: decision.action as any,
        utilityScore: decision.utilityScore ?? 0,
        counterPrice: decision.counterOffer?.total_price ?? null,
        counterPaymentTerms: decision.counterOffer?.payment_terms ?? null,
        counterDelivery: decision.counterOffer?.delivery_date
          ? `by ${decision.counterOffer.delivery_date}`
          : decision.counterOffer?.delivery_days
            ? `within ${decision.counterOffer.delivery_days} days`
            : null,
        concerns: [],
        tone: tonePrimary,
        targetPrice: (config as any)?.parameters?.total_price?.target,
        maxAcceptablePrice: (config as any)?.parameters?.total_price
          ?.max_acceptable,
        currencyCode: (config as any)?.currency || "USD",
      });
      finalResponseContent = validateLlmOutput(
        responseResult.response,
        humanizationIntent,
      );
    } catch (validationError) {
      if (validationError instanceof ValidationError) {
        logger.warn(
          "[VendorChat] Response failed validation, using fallback template",
          {
            dealId: input.dealId,
            reason: validationError.reason,
            action: decision.action,
          },
        );
        const tonePrimary: any =
          ((deal as any).convoStateJson as any)?.detectedTone ?? "formal";
        const fallbackIntent: NegotiationIntent = buildNegotiationIntent({
          action: decision.action as any,
          utilityScore: decision.utilityScore ?? 0,
          counterPrice: decision.counterOffer?.total_price ?? null,
          counterPaymentTerms: decision.counterOffer?.payment_terms ?? null,
          counterDelivery: decision.counterOffer?.delivery_date
            ? `by ${decision.counterOffer.delivery_date}`
            : decision.counterOffer?.delivery_days
              ? `within ${decision.counterOffer.delivery_days} days`
              : null,
          concerns: [],
          tone: tonePrimary,
          targetPrice: (config as any)?.parameters?.total_price?.target,
          maxAcceptablePrice: (config as any)?.parameters?.total_price
            ?.max_acceptable,
          currencyCode: (config as any)?.currency || "USD",
        });
        finalResponseContent = getFallbackResponse(fallbackIntent);
      } else {
        // Non-validation error — keep the original response but still scrub.
        finalResponseContent = sanitizeText(responseResult.response);
      }
    }

    // Get the round from the vendor message (both messages in a pair share the same round)
    const currentRound = vendorMessage.round || deal.round + 1;

    // Save ACCORDO response message with the same round as vendor message
    const accordoMessageId = uuidv4();
    const accordoMessage = await models.ChatbotMessage.create({
      id: accordoMessageId,
      dealId: input.dealId,
      role: "ACCORDO",
      content: finalResponseContent,
      extractedOffer: null,
      engineDecision: decision as any,
      decisionAction: decision.action,
      utilityScore: decision.utilityScore,
      counterOffer: decision.counterOffer as any,
      explainabilityJson: explainability as any,
      round: currentRound, // PM message has same round as vendor message
    });

    // Update deal with final status based on decision
    // PM response CONCLUDES the round, so increment deal.round NOW
    let finalStatus: "NEGOTIATING" | "ACCEPTED" | "WALKED_AWAY" | "ESCALATED" =
      deal.status;
    if (decision.action === "ACCEPT") finalStatus = "ACCEPTED";
    else if (decision.action === "WALK_AWAY") finalStatus = "WALKED_AWAY";
    else if (decision.action === "ESCALATE") finalStatus = "ESCALATED";

    await deal.update({
      round: currentRound, // NOW increment deal.round (round is now complete)
      status: finalStatus,
      latestOfferJson: decision.counterOffer as any,
      latestDecisionAction: decision.action,
      latestUtility: decision.utilityScore,
      convoStateJson: negotiationState as any, // Save negotiation state for dynamic counters
    });

    logger.info(
      `[Phase2] PM response generated for deal ${input.dealId}: ${decision.action} (utility: ${decision.utilityScore}, source: ${responseResult.source}, emphasis: ${negotiationState.vendorEmphasis})`,
    );

    // Hook: Sync contract status and capture vendor bid when deal reaches terminal state (fire-and-forget)
    // CRITICAL FIX (Jan 2026): Run these in background to avoid blocking the response
    if (["ACCEPTED", "WALKED_AWAY", "ESCALATED"].includes(finalStatus)) {
      // Sync contract status (fire-and-forget)
      syncContractStatus(deal.id, finalStatus, deal.contractId).catch((err) =>
        logger.error(
          `[Phase2] Failed to sync contract status: ${(err as Error).message}`,
        ),
      );

      // Update vendor negotiation profile (fire-and-forget)
      updateVendorProfileOnDealCompletion(
        deal.id,
        finalStatus as "ACCEPTED" | "WALKED_AWAY" | "ESCALATED",
        deal.vendorId,
      ).catch((err) =>
        logger.error(
          `[Phase2] Failed to update vendor profile: ${(err as Error).message}`,
        ),
      );

      // Fire-and-forget: don't await, just log errors
      captureVendorBid(deal.id)
        .then(() => {
          logger.info(
            `[Phase2] Captured vendor bid for deal ${deal.id} with status ${finalStatus}`,
          );
          if (deal.requisitionId) {
            return checkAndTriggerComparison(deal.requisitionId);
          }
        })
        .catch((bidError) => {
          logger.error(
            `[Phase2] Failed to capture vendor bid: ${(bidError as Error).message}`,
          );
        });
    }

    // Add MESO data to explainability for frontend display
    if (mesoResult && mesoResult.success) {
      (explainability as any).meso = {
        enabled: true,
        options: mesoResult.options,
        targetUtility: mesoResult.targetUtility,
        variance: mesoResult.variance,
        // Flow control flags for phased negotiation (February 2026)
        showOthers: mesoResult.showOthers,
        isFinal: mesoResult.isFinal,
        inputDisabled: mesoResult.inputDisabled,
        disabledMessage: mesoResult.disabledMessage,
        phase: mesoResult.phase,
        stallPrompt: mesoResult.stallPrompt || undefined,
        // Cycle info
        mesoCycleNumber: negotiationState.mesoCycleState?.mesoCycleNumber,
      };
    } else if (stallPrompt) {
      // Even if no MESO, include stall prompt for display
      (explainability as any).stallDetection = {
        detected: true,
        prompt: stallPrompt,
        phase: "STALL_QUESTION" as NegotiationPhase,
      };
    }

    return {
      message: accordoMessage,
      decision,
      explainability,
      deal,
      generationSource: responseResult.source,
      meso: mesoResult, // Include MESO result for frontend
    };
  } catch (error) {
    // Error Recovery: never expose raw errors to vendor
    const errorCategory = classifyError(error);
    logger.error(`[Phase2] Error in PM response generation`, {
      dealId: input.dealId,
      errorCategory,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    });

    // For deal_not_found, still throw (controller needs to return 404)
    if (error instanceof CustomError && error.statusCode === 404) throw error;

    // Build a human-readable fallback response
    const fallbackResponse = getErrorFallbackResponse(errorCategory);

    try {
      // Try to save the fallback as an ACCORDO message so the vendor sees a response
      const deal = await models.ChatbotDeal.findByPk(input.dealId);
      if (deal) {
        const fallbackMessage = await models.ChatbotMessage.create({
          id: uuidv4(),
          dealId: input.dealId,
          role: "ACCORDO",
          content: fallbackResponse,
          extractedOffer: null,
          engineDecision: { action: "ERROR_RECOVERY", errorCategory } as any,
          decisionAction: "ERROR_RECOVERY",
          utilityScore: deal.latestUtility ?? null,
          counterOffer: null,
          explainabilityJson: null,
          round: deal.round,
        });

        return {
          message: fallbackMessage,
          decision: {
            action: "ERROR_RECOVERY" as any,
            utilityScore: deal.latestUtility ?? 0,
            counterOffer: null,
            reasons: [`Error recovery: ${errorCategory}`],
          },
          explainability: {} as Explainability,
          deal,
          generationSource: "fallback" as const,
          meso: null,
        };
      }
    } catch (saveError) {
      logger.error("[Phase2] Failed to save error recovery message", {
        dealId: input.dealId,
        saveError:
          saveError instanceof Error ? saveError.message : String(saveError),
      });
    }

    // Last resort: throw with human-readable message
    throw new CustomError(fallbackResponse, 500);
  }
};

/**
 * Generate a quick fallback PM response (for timeout scenarios)
 *
 * This function generates an immediate fallback response when the LLM
 * takes too long. It uses enhanced templates with delivery terms.
 *
 * @param input - PM response input
 * @returns Fallback PM response
 */
export const generatePMFallbackResponseService = async (
  input: GeneratePMResponseInput,
): Promise<PMResponseResult> => {
  try {
    const deal = await models.ChatbotDeal.findByPk(input.dealId);
    if (!deal) {
      throw new CustomError("Deal not found", 404);
    }

    const vendorMessage = await models.ChatbotMessage.findByPk(
      input.vendorMessageId,
    );
    if (!vendorMessage) {
      throw new CustomError("Vendor message not found", 404);
    }

    // Use stored negotiation config from deal (includes priority-adjusted thresholds and weights)
    let config: NegotiationConfig;
    if (deal.negotiationConfigJson) {
      const storedConfig = deal.negotiationConfigJson as NegotiationConfig & {
        wizardConfig?: unknown;
      };
      if (!storedConfig.parameters) {
        if (deal.requisitionId) {
          config = await buildConfigFromRequisition(deal.requisitionId);
        } else if (deal.contractId) {
          config = await buildConfigFromContract(deal.contractId);
        } else {
          const { negotiationConfig } = await import("./engine/config.js");
          config = negotiationConfig;
        }
      } else {
        config = {
          parameters: storedConfig.parameters,
          accept_threshold: storedConfig.accept_threshold,
          escalate_threshold: storedConfig.escalate_threshold,
          walkaway_threshold: storedConfig.walkaway_threshold,
          max_rounds: storedConfig.max_rounds,
          priority: storedConfig.priority,
          currency: storedConfig.currency,
        };
      }
    } else if (deal.requisitionId) {
      config = await buildConfigFromRequisition(deal.requisitionId);
    } else if (deal.contractId) {
      config = await buildConfigFromContract(deal.contractId);
    } else {
      const { negotiationConfig } = await import("./engine/config.js");
      config = negotiationConfig;
    }

    // Get vendor offer (may be an AccumulatedOffer)
    const extractedOffer =
      (vendorMessage.extractedOffer as Offer | AccumulatedOffer) ||
      parseOfferWithDelivery(vendorMessage.content);

    // Get negotiation state for fallback (simplified - just use stored state without updating)
    const negotiationState: NegotiationState | null =
      deal.convoStateJson as NegotiationState | null;
    const previousPmOffer = negotiationState
      ? getLastPmCounter(negotiationState)
      : null;

    // Make decision with negotiation state
    const decision = decideNextMove(
      config,
      extractedOffer,
      deal.round,
      negotiationState,
      previousPmOffer,
    );

    // Compute explainability
    const explainability = computeExplainability(
      config,
      extractedOffer,
      decision,
    );

    // Build delivery config
    const dealConfigFallback = deal.get("configJson") as
      | { delivery?: { requiredDate?: string; preferredDate?: string } }
      | undefined;
    const deliveryConfig: DeliveryConfig | undefined = dealConfigFallback
      ?.delivery?.requiredDate
      ? {
          requiredDate: dealConfigFallback.delivery.requiredDate,
          preferredDate: dealConfigFallback.delivery.preferredDate,
          maxLateDays: 14, // Default 2 weeks grace period
        }
      : undefined;

    // Generate quick fallback response (no LLM, instant)
    const fallbackResponse = generateQuickFallback({
      decision,
      config,
      conversationHistory: [],
      vendorOffer: extractedOffer,
      counterOffer: decision.counterOffer,
      deliveryConfig,
      round: deal.round,
      maxRounds: config.max_rounds,
    });

    // Get the round from the vendor message (both messages in a pair share the same round)
    const currentRound = vendorMessage.round || deal.round + 1;

    // Save ACCORDO response message with the same round as vendor message
    const accordoMessageId = uuidv4();
    const accordoMessage = await models.ChatbotMessage.create({
      id: accordoMessageId,
      dealId: input.dealId,
      role: "ACCORDO",
      content: fallbackResponse,
      extractedOffer: null,
      engineDecision: decision as any,
      decisionAction: decision.action,
      utilityScore: decision.utilityScore,
      counterOffer: decision.counterOffer as any,
      explainabilityJson: explainability as any,
      round: currentRound, // PM message has same round as vendor message
    });

    // Update deal status - PM response CONCLUDES the round
    let finalStatus: "NEGOTIATING" | "ACCEPTED" | "WALKED_AWAY" | "ESCALATED" =
      deal.status;
    if (decision.action === "ACCEPT") finalStatus = "ACCEPTED";
    else if (decision.action === "WALK_AWAY") finalStatus = "WALKED_AWAY";
    else if (decision.action === "ESCALATE") finalStatus = "ESCALATED";

    await deal.update({
      round: currentRound, // NOW increment deal.round (round is now complete)
      status: finalStatus,
      latestOfferJson: decision.counterOffer as any,
      latestDecisionAction: decision.action,
      latestUtility: decision.utilityScore,
    });

    logger.info(
      `[Fallback] PM fallback response generated for deal ${input.dealId}: ${decision.action}`,
    );

    // Hook: Sync contract status and capture vendor bid when deal reaches terminal state (fire-and-forget)
    // CRITICAL FIX (Jan 2026): Run these in background to avoid blocking the response
    if (["ACCEPTED", "WALKED_AWAY", "ESCALATED"].includes(finalStatus)) {
      // Sync contract status (fire-and-forget)
      syncContractStatus(deal.id, finalStatus, deal.contractId).catch((err) =>
        logger.error(
          `[Fallback] Failed to sync contract status: ${(err as Error).message}`,
        ),
      );

      // Update vendor negotiation profile (fire-and-forget)
      updateVendorProfileOnDealCompletion(
        deal.id,
        finalStatus as "ACCEPTED" | "WALKED_AWAY" | "ESCALATED",
        deal.vendorId,
      ).catch((err) =>
        logger.error(
          `[Fallback] Failed to update vendor profile: ${(err as Error).message}`,
        ),
      );

      // Fire-and-forget: don't await, just log errors
      captureVendorBid(deal.id)
        .then(() => {
          logger.info(
            `[Fallback] Captured vendor bid for deal ${deal.id} with status ${finalStatus}`,
          );
          if (deal.requisitionId) {
            return checkAndTriggerComparison(deal.requisitionId);
          }
        })
        .catch((bidError) => {
          logger.error(
            `[Fallback] Failed to capture vendor bid: ${(bidError as Error).message}`,
          );
        });
    }

    return {
      message: accordoMessage,
      decision,
      explainability,
      deal,
      generationSource: "fallback",
    };
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      `Failed to generate PM fallback response: ${(error as Error).message}`,
      500,
    );
  }
};

/**
 * Get deal with messages
 */
export const getDealService = async (
  dealId: string,
): Promise<DealWithMessages> => {
  try {
    const deal = await models.ChatbotDeal.findByPk(dealId, {
      include: [
        { model: models.Requisition, as: "Requisition" },
        { model: models.Contract, as: "Contract" },
        { model: models.User, as: "User", attributes: ["id", "name", "email"] },
        {
          model: models.User,
          as: "Vendor",
          attributes: ["id", "name", "email"],
        },
      ],
    });

    if (!deal) {
      throw new CustomError("Deal not found", 404);
    }

    const messages = await models.ChatbotMessage.findAll({
      where: { dealId },
      order: [["createdAt", "ASC"]],
    });

    return { deal, messages };
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      `Failed to get deal: ${(error as Error).message}`,
      500,
    );
  }
};

/**
 * List deals with filters and pagination
 */
export const listDealsService = async (
  filters: ListDealsFilters,
  page: number = 1,
  limit: number = 10,
): Promise<PaginatedDealsResponse> => {
  try {
    const where: any = {};

    if (filters.status) where.status = filters.status;
    if (filters.mode) where.mode = filters.mode;
    if (filters.userId) where.userId = filters.userId;
    if (filters.vendorId) where.vendorId = filters.vendorId;

    // Handle archived/deleted filters
    if (filters.archived === true) {
      where.archivedAt = { [Op.ne]: null };
    } else if (filters.archived === false) {
      where.archivedAt = null;
    }

    if (filters.deleted === true) {
      where.deletedAt = { [Op.ne]: null };
    } else if (filters.deleted === false) {
      where.deletedAt = null;
    }

    const offset = (page - 1) * limit;

    // Company isolation filter via Requisition → Project
    // Null-tolerant: legacy projects with null companyId remain accessible.
    if (filters.companyId) {
      where["$Requisition.Project.companyId$"] = {
        [Op.or]: [filters.companyId, null],
      };
    }

    const { rows, count } = await models.ChatbotDeal.findAndCountAll({
      where,
      limit,
      offset,
      subQuery: false,
      order: [["createdAt", "DESC"]],
      include: [
        {
          model: models.Requisition,
          as: "Requisition",
          attributes: ["id", "subject", "rfqId"],
          include: [
            {
              model: models.Project,
              as: "Project",
              attributes: ["id", "companyId"],
            },
          ],
        },
        {
          model: models.Contract,
          as: "Contract",
          attributes: ["id", "status"],
        },
        { model: models.User, as: "User", attributes: ["id", "name", "email"] },
        {
          model: models.User,
          as: "Vendor",
          attributes: ["id", "name", "email"],
        },
      ],
    });

    return {
      data: rows,
      total: count,
      page,
      totalPages: Math.ceil(count / limit),
    };
  } catch (error) {
    throw new CustomError(
      `Failed to list deals: ${(error as Error).message}`,
      500,
    );
  }
};

/**
 * Reset a deal (clear messages and state)
 */
export const resetDealService = async (
  dealId: string,
): Promise<ChatbotDeal> => {
  try {
    const deal = await models.ChatbotDeal.findByPk(dealId);
    if (!deal) {
      throw new CustomError("Deal not found", 404);
    }

    // Delete all messages
    await models.ChatbotMessage.destroy({ where: { dealId } });

    // Reset deal state
    await deal.update({
      status: "NEGOTIATING",
      round: 0,
      latestOfferJson: null,
      latestVendorOffer: null,
      latestDecisionAction: null,
      latestUtility: null,
      convoStateJson:
        deal.mode === "CONVERSATION"
          ? { phase: "GREETING", history: [] }
          : null,
    });

    logger.info(`Reset deal ${dealId}`);
    return deal;
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      `Failed to reset deal: ${(error as Error).message}`,
      500,
    );
  }
};

/**
 * Archive a deal
 */
export const archiveDealService = async (
  dealId: string,
): Promise<ChatbotDeal> => {
  try {
    const deal = await models.ChatbotDeal.findByPk(dealId);
    if (!deal) {
      throw new CustomError("Deal not found", 404);
    }

    await deal.update({ archivedAt: new Date() });
    logger.info(`Archived deal ${dealId}`);
    return deal;
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      `Failed to archive deal: ${(error as Error).message}`,
      500,
    );
  }
};

/**
 * Unarchive a deal (also clears deletedAt to fully recover)
 * Additionally auto-recovers the parent requisition if it was archived
 */
export const unarchiveDealService = async (
  dealId: string,
): Promise<ChatbotDeal> => {
  try {
    const deal = await models.ChatbotDeal.findByPk(dealId);
    if (!deal) {
      throw new CustomError("Deal not found", 404);
    }

    // Clear both archived and deleted flags to fully recover the deal
    await deal.update({ archivedAt: null, deletedAt: null });
    logger.info(`Unarchived deal ${dealId}`);

    // Auto-recover parent requisition if it was archived
    if (deal.requisitionId) {
      const requisition = await models.Requisition.findByPk(deal.requisitionId);
      if (requisition && requisition.archivedAt) {
        await requisition.update({ archivedAt: null });
        logger.info(
          `Auto-recovered parent requisition ${deal.requisitionId} after unarchiving deal ${dealId}`,
        );
      }
    }

    return deal;
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      `Failed to unarchive deal: ${(error as Error).message}`,
      500,
    );
  }
};

/**
 * Retry sending deal notification email to vendor
 * Fetches the deal and its related data, then resends the email
 */
export const retryDealEmailService = async (
  dealId: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> => {
  try {
    // Fetch the deal with vendor information
    const deal = await models.ChatbotDeal.findByPk(dealId);
    if (!deal) {
      return { success: false, error: "Deal not found" };
    }

    // Validate required relationships exist
    if (!deal.vendorId) {
      return { success: false, error: "Deal has no vendor attached" };
    }
    if (!deal.requisitionId) {
      return { success: false, error: "Deal has no requisition attached" };
    }

    // Fetch vendor
    const vendor = await models.User.findByPk(deal.vendorId);
    if (!vendor || !vendor.email) {
      return { success: false, error: "Vendor email not found" };
    }

    // Fetch requisition with details
    const requisition = await models.Requisition.findByPk(deal.requisitionId, {
      include: [
        {
          model: models.Project,
          as: "Project",
          attributes: ["id", "projectName"],
        },
        {
          model: models.RequisitionProduct,
          as: "RequisitionProduct",
          include: [
            {
              model: models.Product,
              as: "Product",
              attributes: ["id", "productName", "UOM"],
            },
          ],
        },
      ],
    });

    if (!requisition) {
      return { success: false, error: "Requisition not found" };
    }

    // Extract negotiation config from deal
    const config = deal.negotiationConfigJson as any;
    const wizardConfig = config?.wizardConfig;
    const priceQuantity = wizardConfig?.priceQuantity || {};
    const paymentTerms = wizardConfig?.paymentTerms;
    const delivery = wizardConfig?.delivery;
    const negotiationControl = wizardConfig?.negotiationControl;

    // Extract products from requisition
    const products = ((requisition as any).RequisitionProduct || []).map(
      (rp: any) => ({
        name: rp.Product?.productName || "Unknown Product",
        quantity: rp.quantity || 1,
        targetPrice: rp.targetPrice || priceQuantity.targetUnitPrice || 0,
        unit: rp.Product?.UOM || undefined,
      }),
    );

    // Build email data
    const emailData = {
      dealId: deal.id,
      dealTitle: deal.title,
      requisitionId: deal.requisitionId!,
      rfqNumber: (requisition as any).rfqNumber || `RFQ-${deal.requisitionId}`,
      requisitionTitle: (requisition as any).title || deal.title,
      projectName:
        (requisition as any).Project?.projectName || "Unknown Project",
      vendorId: deal.vendorId!,
      vendorName: vendor.name || vendor.email,
      vendorEmail: vendor.email,
      negotiationDeadline: negotiationControl?.deadline
        ? new Date(negotiationControl.deadline)
        : (requisition as any).negotiationClosureDate || undefined,
      products:
        products.length > 0
          ? products
          : [
              {
                name: "Products as per RFQ",
                quantity: 1,
                targetPrice: priceQuantity.targetUnitPrice || 0,
              },
            ],
      priceConfig: {
        targetUnitPrice: priceQuantity.targetUnitPrice || 0,
        maxAcceptablePrice: priceQuantity.maxAcceptablePrice || 0,
      },
      paymentTerms: paymentTerms
        ? {
            minDays: paymentTerms.minDays || 30,
            maxDays: paymentTerms.maxDays || 90,
          }
        : undefined,
      deliveryDate: delivery?.requiredDate || undefined,
    };

    const emailStatus = await sendDealCreatedEmail(emailData);

    if (emailStatus.success) {
      logger.info(
        `Deal email retry successful for deal ${dealId} to vendor ${vendor.email}`,
      );
    } else {
      logger.warn(`Deal email retry failed: ${emailStatus.error}`, {
        dealId,
        vendorEmail: vendor.email,
      });
    }

    return emailStatus;
  } catch (error) {
    const errorMessage = (error as Error).message;
    logger.error(`Error retrying deal email: ${errorMessage}`, { dealId });
    return { success: false, error: errorMessage };
  }
};

/**
 * Extended config response type that includes wizardConfig for display
 */
export interface ExtendedNegotiationConfig extends NegotiationConfig {
  wizardConfig?: {
    priority: "HIGH" | "MEDIUM" | "LOW";
    priceQuantity: {
      targetUnitPrice: number;
      maxAcceptablePrice: number;
      minOrderQuantity: number;
      preferredQuantity?: number;
    };
    paymentTerms: {
      minDays: number;
      maxDays: number;
      acceptedMethods?: ("BANK_TRANSFER" | "CREDIT" | "LC")[];
    };
    delivery: {
      requiredDate: string;
      preferredDate?: string;
      locationId?: number;
      locationAddress?: string;
      partialDelivery: {
        allowed: boolean;
        type?: "QUANTITY" | "PERCENTAGE";
        minValue?: number;
      };
    };
    contractSla: {
      warrantyPeriod: string;
      customWarrantyMonths?: number;
      defectLiabilityMonths?: number;
      lateDeliveryPenaltyPerDay: number;
      maxPenaltyCap?: {
        type: "PERCENTAGE" | "FIXED";
        value?: number;
      };
      qualityStandards?: string[];
    };
    negotiationControl: {
      deadline?: string | null;
      maxRounds: number;
      walkawayThreshold: number;
    };
    customParameters: Array<{
      id?: string;
      name: string;
      type: string;
      targetValue: boolean | number | string;
      flexibility: string;
      includeInNegotiation: boolean;
    }>;
  };
  parameterWeights?: Record<string, number>;
}

/**
 * Get negotiation config for a deal
 * Returns extended config with wizardConfig if available
 */
export const getDealConfigService = async (
  dealId: string,
): Promise<ExtendedNegotiationConfig> => {
  try {
    const deal = await models.ChatbotDeal.findByPk(dealId);
    if (!deal) {
      throw new CustomError("Deal not found", 404);
    }

    // Check if deal has stored negotiationConfigJson (with or without wizardConfig)
    const configJson = deal.negotiationConfigJson as Record<
      string,
      unknown
    > | null;
    if (configJson && configJson.parameters) {
      // Return the stored config including wizardConfig if present
      // This preserves priority-based thresholds set during deal creation
      return {
        parameters: configJson.parameters as NegotiationConfig["parameters"],
        accept_threshold: configJson.accept_threshold as number,
        escalate_threshold: (configJson.escalate_threshold as number) ?? 0.5,
        walkaway_threshold: configJson.walkaway_threshold as number,
        max_rounds: configJson.max_rounds as number,
        priority: configJson.priority as "HIGH" | "MEDIUM" | "LOW" | undefined,
        wizardConfig:
          configJson.wizardConfig as ExtendedNegotiationConfig["wizardConfig"],
        parameterWeights: configJson.parameterWeights as
          | Record<string, number>
          | undefined,
      };
    }

    // Fallback: Build config from requisition or contract (legacy deals)
    let baseConfig: NegotiationConfig;
    if (deal.requisitionId) {
      baseConfig = await buildConfigFromRequisition(deal.requisitionId);
    } else if (deal.contractId) {
      baseConfig = await buildConfigFromContract(deal.contractId);
    } else {
      // Return default config
      const { negotiationConfig } = await import("./engine/config.js");
      baseConfig = negotiationConfig;
    }

    return {
      ...baseConfig,
      wizardConfig: undefined,
      parameterWeights: undefined,
    };
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      `Failed to get deal config: ${(error as Error).message}`,
      500,
    );
  }
};

/**
 * Get last explainability for a deal (from most recent message)
 */
export const getLastExplainabilityService = async (
  dealId: string,
): Promise<Explainability | null> => {
  try {
    const lastMessage = await models.ChatbotMessage.findOne({
      where: { dealId, explainabilityJson: { [Op.ne]: null } },
      order: [["createdAt", "DESC"]],
    });

    return lastMessage
      ? (lastMessage.explainabilityJson as Explainability)
      : null;
  } catch (error) {
    throw new CustomError(
      `Failed to get last explainability: ${(error as Error).message}`,
      500,
    );
  }
};

/**
 * Get weighted utility calculation for a deal
 * Uses parameter weights from Step 4 to calculate overall utility
 * Applies thresholds: Accept (≥70%), Escalate (30-50%), Walk Away (<30%)
 *
 * GET /api/chatbot/deals/:dealId/utility
 */
export const getDealUtilityService = async (
  dealId: string,
): Promise<{
  utility: WeightedUtilityResult;
  summary: ReturnType<typeof getUtilitySummary>;
  latestOffer: ParsedVendorOffer | null;
  config: NegotiationConfig;
}> => {
  try {
    const deal = await models.ChatbotDeal.findByPk(dealId);
    if (!deal) {
      throw new CustomError("Deal not found", 404);
    }

    // Get the negotiation config (includes weights from Step 4)
    const config = await getDealConfigService(dealId);

    // Get the latest vendor message with extracted offer
    const latestVendorMessage = await models.ChatbotMessage.findOne({
      where: {
        dealId,
        role: "VENDOR",
        extractedOffer: { [Op.ne]: null },
      },
      order: [["createdAt", "DESC"]],
    });

    // Parse the latest offer from the vendor message
    let latestOffer: ParsedVendorOffer | null = null;
    if (latestVendorMessage && latestVendorMessage.extractedOffer) {
      const offer = latestVendorMessage.extractedOffer as Offer;
      // Cast negotiationConfigJson for type safety
      const configJson = deal.negotiationConfigJson as Record<
        string,
        any
      > | null;
      latestOffer = {
        unitPrice: offer.total_price,
        paymentTerms: offer.payment_terms,
        // Additional fields from deal config if available
        deliveryDate: configJson?.delivery?.targetDate ?? null,
        partialDelivery: configJson?.delivery?.allowPartial ?? null,
        warrantyMonths: configJson?.contractTerms?.warrantyPeriod ?? null,
        lateDeliveryPenalty:
          configJson?.contractTerms?.lateDeliveryPenalty ?? null,
      };
    }

    // Convert legacy config to weighted format if needed
    const weightedConfig = convertLegacyConfig({
      total_price:
        config.parameters?.total_price ??
        (config.parameters as any)?.unit_price,
      payment_terms: config.parameters?.payment_terms,
      accept_threshold: config.accept_threshold,
      walkaway_threshold: config.walkaway_threshold,
      max_rounds: config.max_rounds,
    });

    // Calculate weighted utility
    const utility = calculateWeightedUtility(latestOffer || {}, weightedConfig);

    // Generate display summary
    const summary = getUtilitySummary(utility);

    return {
      utility,
      summary,
      latestOffer,
      config,
    };
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      `Failed to get deal utility: ${(error as Error).message}`,
      500,
    );
  }
};

/**
 * Get behavioral analysis data for a deal
 * Computes from existing ChatbotMessage records (no new data needed)
 */
export const getBehavioralDataService = async (
  dealId: string,
): Promise<{
  momentum: number;
  strategy: string;
  convergenceRate: number;
  concessionVelocity: number;
  isStalling: boolean;
  isConverging: boolean;
  isDiverging: boolean;
  latestSentiment: string;
  roundHistory: Array<{
    round: number;
    vendorPrice: number | null;
    pmCounter: number | null;
    gap: number | null;
    utility: number | null;
  }>;
  dynamicRounds: {
    softMax: number;
    hardMax: number;
    currentRound: number;
    extendLikely: boolean;
    reason: string;
  } | null;
}> => {
  try {
    const deal = await models.ChatbotDeal.findByPk(dealId);
    if (!deal) {
      throw new CustomError("Deal not found", 404);
    }

    // Get all messages
    const allMessages = await models.ChatbotMessage.findAll({
      where: { dealId },
      order: [["createdAt", "ASC"]],
    });

    const config = deal.negotiationConfigJson as any;
    const negConfig = config as NegotiationConfig | null;

    // Build analyzable messages
    const analyzableMessages = allMessages.map((m) => ({
      role: m.role as "VENDOR" | "ACCORDO" | "SYSTEM" | "PM",
      content: m.content,
      extractedOffer: m.extractedOffer as any,
      counterOffer: m.counterOffer as any,
      createdAt: m.createdAt,
    }));

    // Compute behavioral signals
    const signals = analyzeBehavior(analyzableMessages, deal.round);

    // Compute adaptive strategy if config available
    let strategyLabel = "Matching Pace";
    if (negConfig) {
      const strategy = computeAdaptiveStrategy(signals, negConfig, deal.round);
      strategyLabel = strategy.strategyLabel;
    }

    // Build round history
    const roundHistory: Array<{
      round: number;
      vendorPrice: number | null;
      pmCounter: number | null;
      gap: number | null;
      utility: number | null;
    }> = [];

    let roundNum = 1;
    for (const msg of allMessages) {
      if (msg.role === "VENDOR" && msg.extractedOffer) {
        const offer = msg.extractedOffer as any;
        const vendorPrice = offer.total_price ?? null;

        // Find the matching ACCORDO response
        const accordoMsg = allMessages.find(
          (m) =>
            m.role === "ACCORDO" &&
            m.counterOffer &&
            new Date(m.createdAt).getTime() > new Date(msg.createdAt).getTime(),
        );
        const pmCounter =
          (accordoMsg?.counterOffer as any)?.total_price ?? null;
        const gap =
          vendorPrice != null && pmCounter != null
            ? vendorPrice - pmCounter
            : null;
        const utility = accordoMsg?.utilityScore ?? null;

        roundHistory.push({
          round: roundNum,
          vendorPrice,
          pmCounter,
          gap,
          utility,
        });
        roundNum++;
      }
    }

    // Dynamic rounds info
    let dynamicRounds: {
      softMax: number;
      hardMax: number;
      currentRound: number;
      extendLikely: boolean;
      reason: string;
    } | null = null;
    const dynamicRoundsCfg = config?.dynamicRounds;
    if (dynamicRoundsCfg?.autoExtendEnabled) {
      const extendLikely =
        signals.isConverging && signals.convergenceRate > 0.1;
      dynamicRounds = {
        softMax: dynamicRoundsCfg.softMaxRounds,
        hardMax: dynamicRoundsCfg.hardMaxRounds,
        currentRound: deal.round,
        extendLikely,
        reason: extendLikely
          ? `Offers converging at ${(signals.convergenceRate * 100).toFixed(0)}%/round`
          : signals.isStalling
            ? "Vendor offers stalling"
            : `Standard pace (${(signals.convergenceRate * 100).toFixed(0)}%/round)`,
      };
    }

    return {
      momentum: signals.momentum,
      strategy: strategyLabel,
      convergenceRate: signals.convergenceRate,
      concessionVelocity: signals.concessionVelocity,
      isStalling: signals.isStalling,
      isConverging: signals.isConverging,
      isDiverging: signals.isDiverging,
      latestSentiment: signals.latestSentiment,
      roundHistory,
      dynamicRounds,
    };
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      `Failed to get behavioral data: ${(error as Error).message}`,
      500,
    );
  }
};

/**
 * Create a system message (for automated responses)
 */
export const createSystemMessageService = async (
  dealId: string,
  content: string,
): Promise<ChatbotMessage> => {
  try {
    const messageId = uuidv4();
    const message = await models.ChatbotMessage.create({
      id: messageId,
      dealId,
      role: "SYSTEM",
      content,
      extractedOffer: null,
      engineDecision: null,
      decisionAction: null,
      utilityScore: null,
      counterOffer: null,
      explainabilityJson: null,
    });

    return message;
  } catch (error) {
    throw new CustomError(
      `Failed to create system message: ${(error as Error).message}`,
      500,
    );
  }
};

/**
 * Create a message with explicit properties
 */
export const createMessageService = async (input: {
  dealId: string;
  role: "VENDOR" | "ACCORDO" | "SYSTEM";
  content: string;
  extractedOffer?: Offer | null;
  engineDecision?: Decision | null;
  decisionAction?: string | null;
  utilityScore?: number | null;
  counterOffer?: Offer | null;
  explainabilityJson?: Explainability | null;
}): Promise<ChatbotMessage> => {
  try {
    const messageId = uuidv4();
    const message = await models.ChatbotMessage.create({
      id: messageId,
      dealId: input.dealId,
      role: input.role,
      content: input.content,
      extractedOffer: input.extractedOffer || null,
      engineDecision: input.engineDecision || null,
      decisionAction: input.decisionAction || null,
      utilityScore: input.utilityScore || null,
      counterOffer: input.counterOffer || null,
      explainabilityJson: input.explainabilityJson || null,
    });

    return message;
  } catch (error) {
    throw new CustomError(
      `Failed to create message: ${(error as Error).message}`,
      500,
    );
  }
};

/**
 * Run full demo negotiation with autopilot vendor
 *
 * Algorithm:
 * 1. Reset deal to initial state
 * 2. Set vendor scenario policy
 * 3. Loop until terminal state (ACCEPTED, WALKED_AWAY, ESCALATED, or maxRounds):
 *    - Generate vendor message using vendorAgent
 *    - Process vendor message (extract offer)
 *    - Run decision engine
 *    - Generate Accordo response
 *    - Save both messages
 *    - Check if deal is in terminal state
 * 4. Return complete transcript with steps array
 *
 * @param dealId - Deal ID
 * @param scenario - Vendor scenario (HARD, SOFT, WALK_AWAY)
 * @param maxRounds - Maximum number of rounds (default: 10)
 * @returns Complete demo transcript
 */
export const runDemoService = async (
  dealId: string,
  scenario: "HARD" | "SOFT" | "WALK_AWAY",
  maxRounds: number = 10,
): Promise<{
  deal: ChatbotDeal;
  messages: ChatbotMessage[];
  steps: Array<{
    vendorMessage: ChatbotMessage;
    accordoMessage: ChatbotMessage;
    round: number;
  }>;
  finalStatus: string;
  totalRounds: number;
  finalUtility: number | null;
}> => {
  try {
    logger.info("[RunDemo] Starting demo negotiation", {
      dealId,
      scenario,
      maxRounds,
    });

    // Reset deal to initial state
    const resetDeal = await resetDealService(dealId);

    // Validate deal mode is INSIGHTS
    if (resetDeal.mode !== "INSIGHTS") {
      throw new CustomError("Run demo only works in INSIGHTS mode", 400);
    }

    // Import vendor agent (dynamic to avoid circular deps)
    const { generateVendorReply } = await import("./vendor/vendor-agent.js");

    // Extract PM's price config from deal configuration
    // This ensures vendor offers are ABOVE PM's target price
    const configJson = resetDeal.negotiationConfigJson as Record<
      string,
      unknown
    > | null;
    const wizardConfig = configJson?.wizardConfig as
      | Record<string, unknown>
      | undefined;
    const priceQuantity = (wizardConfig?.priceQuantity ||
      configJson?.priceQuantity ||
      {}) as {
      targetUnitPrice?: number;
      maxAcceptablePrice?: number;
    };

    const pmPriceConfig =
      priceQuantity.targetUnitPrice && priceQuantity.maxAcceptablePrice
        ? {
            targetUnitPrice: priceQuantity.targetUnitPrice,
            maxAcceptablePrice: priceQuantity.maxAcceptablePrice,
          }
        : undefined;

    logger.info("[RunDemo] PM price config extracted", {
      dealId,
      pmPriceConfig,
      hasConfig: !!pmPriceConfig,
    });

    const steps: Array<{
      vendorMessage: ChatbotMessage;
      accordoMessage: ChatbotMessage;
      round: number;
    }> = [];

    let currentRound = 0;
    let dealStatus: string = "NEGOTIATING";
    let lastAccordoOffer: Offer | null = null;

    // Run negotiation loop
    while (currentRound < maxRounds && dealStatus === "NEGOTIATING") {
      logger.info("[RunDemo] Starting round", {
        dealId,
        round: currentRound,
        scenario,
      });

      // Generate vendor message using vendorAgent
      const vendorReplyResult = await generateVendorReply({
        dealId,
        round: currentRound,
        lastAccordoOffer,
        scenario,
        customPolicy: undefined,
        pmPriceConfig, // Pass PM's price config for correct vendor pricing
      });

      if (!vendorReplyResult.success || !vendorReplyResult.data) {
        throw new CustomError(
          vendorReplyResult.message || "Failed to generate vendor reply",
          500,
        );
      }

      const { content: vendorContent, offer: vendorOffer } =
        vendorReplyResult.data;

      // Save vendor message
      const vendorMessage = await createMessageService({
        dealId,
        role: "VENDOR",
        content: vendorContent,
        extractedOffer: vendorOffer as Offer,
      });

      logger.info("[RunDemo] Vendor message generated", {
        dealId,
        round: currentRound,
        messageId: vendorMessage.id,
        offer: vendorOffer,
      });

      // Process vendor message through decision engine
      const processResult = await processVendorMessageService({
        dealId,
        content: vendorContent,
        role: "VENDOR",
        userId: 0, // System user for autopilot
      });

      const { accordoMessage, decision } = processResult;

      logger.info("[RunDemo] Accordo message generated", {
        dealId,
        round: currentRound,
        messageId: accordoMessage.id,
        decision: decision.action,
      });

      // Add step to transcript
      steps.push({
        vendorMessage,
        accordoMessage,
        round: currentRound,
      });

      // Update last Accordo offer for next round
      lastAccordoOffer = accordoMessage.counterOffer as Offer | null;

      // Check terminal state
      const updatedDeal = await models.ChatbotDeal.findByPk(dealId);
      if (!updatedDeal) {
        throw new CustomError("Deal not found after processing", 500);
      }

      dealStatus = updatedDeal.status;

      if (
        dealStatus === "ACCEPTED" ||
        dealStatus === "WALKED_AWAY" ||
        dealStatus === "ESCALATED"
      ) {
        logger.info("[RunDemo] Demo completed with terminal state", {
          dealId,
          status: dealStatus,
          round: currentRound,
        });
        break;
      }

      currentRound++;
    }

    // If maxRounds reached without terminal state, set status to ESCALATED
    if (currentRound >= maxRounds && dealStatus === "NEGOTIATING") {
      await models.ChatbotDeal.update(
        { status: "ESCALATED" },
        { where: { id: dealId } },
      );

      await createSystemMessageService(
        dealId,
        `Maximum rounds (${maxRounds}) reached. Deal escalated to human.`,
      );

      dealStatus = "ESCALATED";
      logger.info("[RunDemo] Max rounds reached, deal escalated", {
        dealId,
        maxRounds,
      });
    }

    // Get final deal state and all messages
    const finalDealData = await getDealService(dealId);
    const { deal, messages } = finalDealData;

    logger.info("[RunDemo] Demo negotiation completed", {
      dealId,
      scenario,
      totalRounds: currentRound,
      finalStatus: deal.status,
      finalUtility: deal.latestUtility,
    });

    return {
      deal,
      messages,
      steps,
      finalStatus: deal.status,
      totalRounds: currentRound,
      finalUtility: deal.latestUtility,
    };
  } catch (error) {
    logger.error("[RunDemo] Failed to run demo negotiation", {
      dealId,
      scenario,
      error: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof CustomError) {
      throw error;
    }

    throw new CustomError(
      `Failed to run demo: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
};

/**
 * Resume an escalated deal
 *
 * Changes status from ESCALATED back to NEGOTIATING and adds a system message.
 *
 * @param dealId - Deal ID
 * @returns Updated deal
 */
export const resumeDealService = async (
  dealId: string,
): Promise<ChatbotDeal> => {
  try {
    const deal = await models.ChatbotDeal.findByPk(dealId);

    if (!deal) {
      throw new CustomError("Deal not found", 404);
    }

    // Use state machine to validate and execute the RESUME transition
    const { transition: smTransition, canTransition: smCanTransition } =
      await import("./engine/negotiation-state-machine.js");
    if (!smCanTransition(deal.status as any, "RESUME")) {
      throw new CustomError(
        `Cannot resume deal in '${deal.status}' status. Only ESCALATED deals can be resumed.`,
        400,
      );
    }

    const result = smTransition(deal.status as any, "RESUME");
    deal.status = result.newState;
    await deal.save();

    // Add system message
    await createSystemMessageService(
      dealId,
      "Deal resumed by human negotiator.",
    );

    logger.info("[ResumeService] Deal resumed", {
      dealId,
      status: deal.status,
    });

    return deal;
  } catch (error) {
    if (error instanceof CustomError) {
      throw error;
    }

    throw new CustomError(
      `Failed to resume deal: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
};

// ==================== REQUISITION-BASED DEAL QUERIES ====================

/**
 * Response type for requisitions with deal statistics
 */
export interface RequisitionWithDeals {
  id: number;
  rfqNumber: string;
  title: string;
  projectId: number;
  projectName: string;
  estimatedValue: number | null;
  deadline: string | null;
  createdAt: string;
  typeOfCurrency: string | null;

  // Aggregated stats
  vendorCount: number;
  activeDeals: number;
  completedDeals: number;

  // Status breakdown
  statusCounts: {
    negotiating: number;
    accepted: number;
    walkedAway: number;
    escalated: number;
  };

  // Progress
  completionPercentage: number;
  lastActivityAt: string | null;
}

/**
 * Response type for vendor deal summary
 */
export interface VendorDealSummary {
  dealId: string;
  vendorId: number;
  vendorName: string;
  vendorEmail: string;
  companyName: string | null;

  status: "NEGOTIATING" | "ACCEPTED" | "WALKED_AWAY" | "ESCALATED";
  currentRound: number;
  maxRounds: number;

  latestOffer: {
    unitPrice: number | null;
    paymentTerms: string | null;
  } | null;

  utilityScore: number | null;
  lastActivityAt: string | null;
  completedAt: string | null;
}

/**
 * Filters for requisitions with deals query
 */
export interface RequisitionsWithDealsFilters {
  projectId?: number;
  status?: "all" | "has_active" | "all_completed";
  dateFrom?: string;
  dateTo?: string;
  sortBy?: "recent_activity" | "estimated_value" | "vendor_count" | "deadline";
  archived?: "active" | "archived" | "all";
  companyId?: number | null;
}

/**
 * Get all requisitions that have associated deals with aggregated statistics
 */
export const getRequisitionsWithDealsService = async (
  filters: RequisitionsWithDealsFilters = {},
  page: number = 1,
  limit: number = 10,
): Promise<{
  data: RequisitionWithDeals[];
  total: number;
  page: number;
  totalPages: number;
}> => {
  try {
    // First, get all requisition IDs that have deals
    const requisitionIdsWithDeals = await models.ChatbotDeal.findAll({
      attributes: ["requisitionId"],
      where: {
        requisitionId: { [Op.ne]: null },
        deletedAt: null,
      },
      group: ["requisitionId"],
      raw: true,
    });

    const requisitionIds = requisitionIdsWithDeals.map(
      (d: any) => d.requisitionId,
    );

    if (requisitionIds.length === 0) {
      return { data: [], total: 0, page, totalPages: 0 };
    }

    // Build where clause for requisitions
    const whereClause: any = {
      id: { [Op.in]: requisitionIds },
    };

    // Company isolation filter
    // Null-tolerant: legacy projects with null companyId remain accessible.
    if (filters.companyId) {
      whereClause["$Project.companyId$"] = {
        [Op.or]: [filters.companyId, null],
      };
    }

    if (filters.projectId) {
      whereClause.projectId = filters.projectId;
    }

    if (filters.dateFrom || filters.dateTo) {
      whereClause.createdAt = {};
      if (filters.dateFrom) {
        whereClause.createdAt[Op.gte] = new Date(filters.dateFrom);
      }
      if (filters.dateTo) {
        whereClause.createdAt[Op.lte] = new Date(filters.dateTo);
      }
    }

    // Apply archived filter
    if (filters.archived === "active") {
      whereClause.archivedAt = null;
    } else if (filters.archived === "archived") {
      whereClause.archivedAt = { [Op.ne]: null };
    }
    // If 'all', no filter on archivedAt

    // Get requisitions with project info
    const { count: total, rows: requisitions } =
      await models.Requisition.findAndCountAll({
        where: whereClause,
        include: [
          {
            model: models.Project,
            as: "Project",
            attributes: ["id", "projectName", "companyId"],
          },
        ],
        subQuery: false,
        limit,
        offset: (page - 1) * limit,
        order: [["createdAt", "DESC"]],
      });

    // Get deal statistics for each requisition
    const result: RequisitionWithDeals[] = [];

    for (const requisition of requisitions) {
      // Get deals for this requisition
      const deals = await models.ChatbotDeal.findAll({
        where: {
          requisitionId: requisition.id,
          deletedAt: null,
        },
        include: [
          {
            model: models.User,
            as: "Vendor",
            attributes: ["id", "name", "email"],
          },
        ],
        order: [["lastMessageAt", "DESC"]],
      });

      // Calculate statistics
      const statusCounts = {
        negotiating: 0,
        accepted: 0,
        walkedAway: 0,
        escalated: 0,
      };

      let lastActivityAt: Date | null = null;

      for (const deal of deals) {
        switch (deal.status) {
          case "NEGOTIATING":
            statusCounts.negotiating++;
            break;
          case "ACCEPTED":
            statusCounts.accepted++;
            break;
          case "WALKED_AWAY":
            statusCounts.walkedAway++;
            break;
          case "ESCALATED":
            statusCounts.escalated++;
            break;
        }

        if (
          deal.lastMessageAt &&
          (!lastActivityAt || deal.lastMessageAt > lastActivityAt)
        ) {
          lastActivityAt = deal.lastMessageAt;
        }
      }

      const vendorCount = deals.length;
      const completedDeals =
        statusCounts.accepted +
        statusCounts.walkedAway +
        statusCounts.escalated;
      const activeDeals = statusCounts.negotiating;
      const completionPercentage =
        vendorCount > 0 ? Math.round((completedDeals / vendorCount) * 100) : 0;

      // Apply status filter
      if (filters.status === "has_active" && activeDeals === 0) {
        continue;
      }
      if (filters.status === "all_completed" && activeDeals > 0) {
        continue;
      }

      result.push({
        id: requisition.id,
        rfqNumber: requisition.rfqId || `RFQ${requisition.id}`,
        title: requisition.subject || "Untitled Requisition",
        projectId: requisition.projectId,
        projectName:
          (requisition as any).Project?.projectName || "Unknown Project",
        estimatedValue:
          requisition.totalPrice ||
          (requisition.totalEstimatedAmount as number | null),
        deadline: requisition.negotiationClosureDate?.toISOString() || null,
        createdAt: requisition.createdAt.toISOString(),
        typeOfCurrency: (requisition.typeOfCurrency as string) || null,
        vendorCount,
        activeDeals,
        completedDeals,
        statusCounts,
        completionPercentage,
        lastActivityAt: lastActivityAt?.toISOString() || null,
      });
    }

    // Apply sorting
    if (filters.sortBy === "recent_activity") {
      result.sort((a, b) => {
        if (!a.lastActivityAt && !b.lastActivityAt) return 0;
        if (!a.lastActivityAt) return 1;
        if (!b.lastActivityAt) return -1;
        return (
          new Date(b.lastActivityAt).getTime() -
          new Date(a.lastActivityAt).getTime()
        );
      });
    } else if (filters.sortBy === "estimated_value") {
      result.sort((a, b) => (b.estimatedValue || 0) - (a.estimatedValue || 0));
    } else if (filters.sortBy === "vendor_count") {
      result.sort((a, b) => b.vendorCount - a.vendorCount);
    } else if (filters.sortBy === "deadline") {
      result.sort((a, b) => {
        if (!a.deadline && !b.deadline) return 0;
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
      });
    }

    return {
      data: result,
      total: result.length,
      page,
      totalPages: Math.ceil(result.length / limit),
    };
  } catch (error) {
    logger.error("[getRequisitionsWithDeals] Error:", error);
    throw new CustomError(
      `Failed to get requisitions with deals: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
};

/**
 * Get all vendor deals for a specific requisition
 */
export const getRequisitionDealsService = async (
  requisitionId: number,
  filters: {
    status?: string;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    archived?: "active" | "archived" | "all";
  } = {},
  companyId?: number | null,
): Promise<{
  requisition: RequisitionWithDeals;
  deals: VendorDealSummary[];
}> => {
  try {
    // Get requisition with project
    const requisition = await models.Requisition.findByPk(requisitionId, {
      include: [
        {
          model: models.Project,
          as: "Project",
          attributes: ["id", "projectName", "companyId"],
        },
      ],
    });

    if (!requisition) {
      throw new CustomError("Requisition not found", 404);
    }

    // Company isolation check — only reject when Project has a non-null companyId
    // that does not match. Legacy requisitions with null Project.companyId remain accessible
    // so they continue to work after the multi-tenancy rollout.
    const projectCompanyId = (requisition as any).Project?.companyId ?? null;
    if (
      companyId &&
      projectCompanyId !== null &&
      projectCompanyId !== companyId
    ) {
      throw new CustomError("Requisition not found", 404);
    }

    // Build where clause for deals
    const whereClause: any = {
      requisitionId,
      deletedAt: null,
    };

    if (filters.status && filters.status !== "all") {
      whereClause.status = filters.status.toUpperCase();
    }

    // Apply archived filter
    if (filters.archived === "active") {
      whereClause.archivedAt = null;
    } else if (filters.archived === "archived") {
      whereClause.archivedAt = { [Op.ne]: null };
    }
    // If 'all', no filter on archivedAt

    // Get all deals for this requisition with vendor info and messages (for utility score fallback)
    // Note: User model doesn't have direct association to VendorCompany
    // So we only include basic User info and Company if available
    const deals = await models.ChatbotDeal.findAll({
      where: whereClause,
      include: [
        {
          model: models.User,
          as: "Vendor",
          attributes: ["id", "name", "email"],
          include: [
            {
              model: models.Company,
              as: "Company",
              attributes: ["id", "companyName"],
              required: false,
            },
          ],
        },
        {
          model: models.ChatbotMessage,
          as: "Messages",
          attributes: [
            "id",
            "role",
            "utilityScore",
            "extractedOffer",
            "createdAt",
          ],
          order: [["createdAt", "ASC"]],
        },
      ],
      order: [["lastMessageAt", "DESC"]],
    });

    logger.debug("[getRequisitionDealsService] Found deals", {
      count: deals.length,
      deals: deals.map((d) => ({ id: d.id, archivedAt: d.archivedAt })),
    });

    // Calculate requisition statistics
    const statusCounts = {
      negotiating: 0,
      accepted: 0,
      walkedAway: 0,
      escalated: 0,
    };

    let lastActivityAt: Date | null = null;

    const vendorDeals: VendorDealSummary[] = [];

    for (const deal of deals) {
      // Count statuses
      switch (deal.status) {
        case "NEGOTIATING":
          statusCounts.negotiating++;
          break;
        case "ACCEPTED":
          statusCounts.accepted++;
          break;
        case "WALKED_AWAY":
          statusCounts.walkedAway++;
          break;
        case "ESCALATED":
          statusCounts.escalated++;
          break;
      }

      if (
        deal.lastMessageAt &&
        (!lastActivityAt || deal.lastMessageAt > lastActivityAt)
      ) {
        lastActivityAt = deal.lastMessageAt;
      }

      // Get max rounds from config
      let maxRounds = 10;
      if (deal.negotiationConfigJson) {
        const config = deal.negotiationConfigJson as any;
        maxRounds =
          config.max_rounds || config.negotiationControl?.maxRounds || 10;
      }

      // Get messages for this deal to extract utility score and offer
      const messages = (deal.Messages || []) as any[];

      // Find the last Accordo message with utility score
      const lastAccordoMessage = [...messages]
        .reverse()
        .find((m) => m.role === "ACCORDO" && m.utilityScore);

      // Find the last vendor message with extracted offer
      const lastVendorMessage = [...messages]
        .reverse()
        .find((m) => m.role === "VENDOR" && m.extractedOffer);

      // Parse latest offer - try messages first, then fall back to deal-level data
      let latestOffer: {
        unitPrice: number | null;
        paymentTerms: string | null;
      } | null = null;

      if (lastVendorMessage?.extractedOffer) {
        const offer = lastVendorMessage.extractedOffer as any;
        latestOffer = {
          unitPrice:
            offer?.price || offer?.total_price || offer?.unitPrice || null,
          paymentTerms: offer?.paymentTerms || offer?.payment_terms || null,
        };
      } else if (deal.latestOfferJson || deal.latestVendorOffer) {
        const offer = (deal.latestOfferJson || deal.latestVendorOffer) as any;
        latestOffer = {
          unitPrice:
            offer?.price || offer?.total_price || offer?.unitPrice || null,
          paymentTerms: offer?.payment_terms || offer?.paymentTerms || null,
        };
      }

      // Get utility score - try messages first, then fall back to deal-level data
      let utilityScore: number | null = deal.latestUtility
        ? Number(deal.latestUtility)
        : null;
      if (!utilityScore && lastAccordoMessage?.utilityScore) {
        utilityScore = Number(lastAccordoMessage.utilityScore);
      }

      // Get vendor info
      const vendor = deal.Vendor as any;
      const companyName = vendor?.Company?.companyName || null;

      vendorDeals.push({
        dealId: deal.id,
        vendorId: deal.vendorId || 0,
        vendorName: vendor?.name || deal.counterparty || "Unknown Vendor",
        vendorEmail: vendor?.email || "",
        companyName,
        status: deal.status,
        currentRound: deal.round,
        maxRounds,
        latestOffer,
        utilityScore,
        lastActivityAt: deal.lastMessageAt?.toISOString() || null,
        completedAt:
          deal.status !== "NEGOTIATING" ? deal.updatedAt.toISOString() : null,
      });
    }

    // Apply sorting with sortOrder support
    const isDescending = filters.sortOrder === "desc";
    const sortMultiplier = isDescending ? -1 : 1;

    if (
      filters.sortBy === "utilityScore" ||
      filters.sortBy === "utility_score"
    ) {
      // Sort by utility score
      vendorDeals.sort((a, b) => {
        const scoreA = a.utilityScore || 0;
        const scoreB = b.utilityScore || 0;
        return (scoreA - scoreB) * sortMultiplier;
      });
    } else if (
      filters.sortBy === "lastActivity" ||
      filters.sortBy === "last_activity"
    ) {
      // Sort by last activity
      vendorDeals.sort((a, b) => {
        if (!a.lastActivityAt && !b.lastActivityAt) return 0;
        if (!a.lastActivityAt) return sortMultiplier;
        if (!b.lastActivityAt) return -sortMultiplier;
        const dateA = new Date(a.lastActivityAt).getTime();
        const dateB = new Date(b.lastActivityAt).getTime();
        return (dateA - dateB) * sortMultiplier;
      });
    } else if (
      filters.sortBy === "vendorName" ||
      filters.sortBy === "vendor_name"
    ) {
      // Sort by vendor name alphabetically
      vendorDeals.sort((a, b) => {
        const nameA = (a.vendorName || "").toLowerCase();
        const nameB = (b.vendorName || "").toLowerCase();
        return nameA.localeCompare(nameB) * sortMultiplier;
      });
    } else {
      // Default: status priority (NEGOTIATING first, then ACCEPTED, ESCALATED, WALKED_AWAY)
      // For status sorting: asc = active first, desc = completed first
      const statusPriority: Record<string, number> = {
        NEGOTIATING: 0,
        ACCEPTED: 1,
        ESCALATED: 2,
        WALKED_AWAY: 3,
      };
      vendorDeals.sort((a, b) => {
        const priorityA = statusPriority[a.status] ?? 99;
        const priorityB = statusPriority[b.status] ?? 99;
        return (priorityA - priorityB) * sortMultiplier;
      });
    }

    const vendorCount = deals.length;
    const completedDeals =
      statusCounts.accepted + statusCounts.walkedAway + statusCounts.escalated;
    const activeDeals = statusCounts.negotiating;
    const completionPercentage =
      vendorCount > 0 ? Math.round((completedDeals / vendorCount) * 100) : 0;

    const requisitionWithDeals: RequisitionWithDeals = {
      id: requisition.id,
      rfqNumber: requisition.rfqId || `RFQ${requisition.id}`,
      title: requisition.subject || "Untitled Requisition",
      projectId: requisition.projectId,
      projectName:
        (requisition as any).Project?.projectName || "Unknown Project",
      estimatedValue:
        requisition.totalPrice ||
        (requisition.totalEstimatedAmount as number | null),
      deadline: requisition.negotiationClosureDate?.toISOString() || null,
      createdAt: requisition.createdAt.toISOString(),
      typeOfCurrency: (requisition.typeOfCurrency as string) || null,
      vendorCount,
      activeDeals,
      completedDeals,
      statusCounts,
      completionPercentage,
      lastActivityAt: lastActivityAt?.toISOString() || null,
    };

    return {
      requisition: requisitionWithDeals,
      deals: vendorDeals,
    };
  } catch (error) {
    if (error instanceof CustomError) {
      throw error;
    }
    logger.error("[getRequisitionDeals] Error:", error);
    throw new CustomError(
      `Failed to get requisition deals: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
};
/**
 * Archive a requisition and cascade to all its deals
 */
export const archiveRequisitionService = async (
  requisitionId: number,
): Promise<{ requisition: any; archivedDealsCount: number }> => {
  const transaction = await sequelize.transaction();
  try {
    const requisition = await models.Requisition.findByPk(requisitionId);
    if (!requisition) {
      throw new CustomError("Requisition not found", 404);
    }
    if (requisition.archivedAt) {
      throw new CustomError("Requisition is already archived", 400);
    }

    await requisition.update({ archivedAt: new Date() }, { transaction });

    // Cascade: Archive all deals under this requisition
    const [archivedDealsCount] = await models.ChatbotDeal.update(
      { archivedAt: new Date() },
      {
        where: { requisitionId, archivedAt: null },
        transaction,
      },
    );

    await transaction.commit();
    logger.info(
      `[archiveRequisition] Archived requisition ${requisitionId} and ${archivedDealsCount} deals`,
    );
    return { requisition, archivedDealsCount };
  } catch (error) {
    await transaction.rollback();
    if (error instanceof CustomError) throw error;
    logger.error("[archiveRequisition] Error:", error);
    throw new CustomError(
      `Failed to archive requisition: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
};

/**
 * Unarchive a requisition and optionally unarchive all its deals
 */
export const unarchiveRequisitionService = async (
  requisitionId: number,
  unarchiveDeals: boolean = true,
): Promise<{ requisition: any; unarchivedDealsCount: number }> => {
  const transaction = await sequelize.transaction();
  try {
    const requisition = await models.Requisition.findByPk(requisitionId);
    if (!requisition) {
      throw new CustomError("Requisition not found", 404);
    }
    if (!requisition.archivedAt) {
      throw new CustomError("Requisition is not archived", 400);
    }

    await requisition.update({ archivedAt: null }, { transaction });

    let unarchivedDealsCount = 0;
    if (unarchiveDeals) {
      [unarchivedDealsCount] = await models.ChatbotDeal.update(
        { archivedAt: null },
        {
          where: { requisitionId, archivedAt: { [Op.ne]: null } },
          transaction,
        },
      );
    }

    await transaction.commit();
    logger.info(
      `[unarchiveRequisition] Unarchived requisition ${requisitionId} and ${unarchivedDealsCount} deals`,
    );
    return { requisition, unarchivedDealsCount };
  } catch (error) {
    await transaction.rollback();
    if (error instanceof CustomError) throw error;
    logger.error("[unarchiveRequisition] Error:", error);
    throw new CustomError(
      `Failed to unarchive requisition: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
};

/**
 * Response type for deal summary (used in modal)
 */
export interface DealSummaryResponse {
  deal: {
    id: string;
    title: string;
    status: string;
    mode: string;
    vendorName: string;
    vendorEmail: string;
    companyName: string | null;
  };
  finalOffer: {
    unitPrice: number | null;
    paymentTerms: string | null;
    totalValue: number | null;
    deliveryDate: string | null;
  };
  metrics: {
    utilityScore: number | null;
    totalRounds: number;
    maxRounds: number;
    startedAt: string;
    completedAt: string | null;
    durationDays: number | null;
  };
  timeline: Array<{
    round: number;
    vendorOffer: string;
    accordoResponse: string;
    action: string;
  }>;
  chatPreview: string[];
}

/**
 * Get detailed deal summary for completed deals
 */
export const getDealSummaryService = async (
  dealId: string,
): Promise<DealSummaryResponse> => {
  try {
    const deal = await models.ChatbotDeal.findByPk(dealId, {
      include: [
        {
          model: models.User,
          as: "Vendor",
          attributes: ["id", "name", "email"],
          include: [
            {
              model: models.Company,
              as: "Company",
              attributes: ["companyName"],
              required: false,
            },
          ],
        },
        {
          model: models.ChatbotMessage,
          as: "Messages",
          order: [["createdAt", "ASC"]],
        },
        {
          model: models.Requisition,
          as: "Requisition",
          attributes: ["id"],
          include: [
            {
              model: models.RequisitionProduct,
              as: "RequisitionProduct",
              attributes: ["qty", "targetPrice"],
            },
          ],
          required: false,
        },
      ],
    });

    if (!deal) {
      throw new CustomError("Deal not found", 404);
    }

    const vendor = deal.Vendor as any;
    const messages = (deal.Messages || []) as ChatbotMessage[];

    // Parse final offer from messages (the actual data is stored in chatbot_messages)
    let finalOffer = {
      unitPrice: null as number | null,
      paymentTerms: null as string | null,
      totalValue: null as number | null,
      deliveryDate: null as string | null,
    };

    // Get the last vendor message with extracted_offer for final agreed terms
    // Or the last Accordo message with counter_offer if deal was accepted
    const lastVendorMessage = [...messages]
      .reverse()
      .find((m) => m.role === "VENDOR" && m.extractedOffer);
    const lastAccordoMessage = [...messages]
      .reverse()
      .find((m) => m.role === "ACCORDO" && (m.counterOffer || m.utilityScore));

    // For ACCEPTED deals, the final offer is the last vendor's offer that was accepted
    // For other statuses, show the last known offer
    if (lastVendorMessage?.extractedOffer) {
      const offer = lastVendorMessage.extractedOffer as any;
      finalOffer.unitPrice =
        offer?.price || offer?.total_price || offer?.unitPrice || null;
      finalOffer.paymentTerms =
        offer?.paymentTerms || offer?.payment_terms || null;
      // Convert deliveryDays to a date if we have it
      if (offer?.deliveryDays) {
        const deliveryDate = new Date();
        deliveryDate.setDate(deliveryDate.getDate() + offer.deliveryDays);
        finalOffer.deliveryDate = deliveryDate.toISOString();
      }
    }

    // Fallback to deal-level data if messages don't have the offer
    if (
      !finalOffer.unitPrice &&
      (deal.latestOfferJson || deal.latestVendorOffer)
    ) {
      const offer = (deal.latestOfferJson || deal.latestVendorOffer) as any;
      finalOffer.unitPrice =
        offer?.price || offer?.total_price || offer?.unitPrice || null;
      finalOffer.paymentTerms =
        offer?.payment_terms || offer?.paymentTerms || null;
    }

    // Get delivery date from config if not found in offer
    if (!finalOffer.deliveryDate && deal.negotiationConfigJson) {
      const config = deal.negotiationConfigJson as any;
      finalOffer.deliveryDate = config.delivery?.requiredDate || null;
    }

    // Get utility score from the last Accordo message
    let latestUtility = deal.latestUtility ? Number(deal.latestUtility) : null;
    if (!latestUtility && lastAccordoMessage?.utilityScore) {
      latestUtility = Number(lastAccordoMessage.utilityScore);
    }

    // Calculate total value from RequisitionProducts quantity
    if (finalOffer.unitPrice) {
      let totalQuantity = 1; // Default quantity

      // Get total quantity from RequisitionProduct (the actual source of truth)
      const requisition = deal.Requisition as any;
      if (requisition?.RequisitionProduct?.length > 0) {
        totalQuantity = requisition.RequisitionProduct.reduce(
          (sum: number, product: any) => sum + (product.qty || 0),
          0,
        );
      }

      // Fallback: Try to get quantity from negotiation config
      if (totalQuantity <= 1 && deal.negotiationConfigJson) {
        const config = deal.negotiationConfigJson as any;
        totalQuantity =
          config.priceQuantity?.preferredQuantity ||
          config.priceQuantity?.minOrderQuantity ||
          config.quantity ||
          1;
      }

      // Fallback: Try to get quantity from the offer itself
      if (totalQuantity <= 1) {
        const offer = lastVendorMessage?.extractedOffer as any;
        if (offer?.quantity) {
          totalQuantity = offer.quantity;
        }
      }

      finalOffer.totalValue = finalOffer.unitPrice * totalQuantity;
    }

    // Get max rounds from config
    let maxRounds = 10;
    if (deal.negotiationConfigJson) {
      const config = deal.negotiationConfigJson as any;
      maxRounds =
        config.max_rounds || config.negotiationControl?.maxRounds || 10;
    }

    // Calculate duration
    let durationDays: number | null = null;
    if (deal.status !== "NEGOTIATING") {
      const startDate = new Date(deal.createdAt);
      const endDate = new Date(deal.updatedAt);
      durationDays = Math.ceil(
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
      );
    }

    // Build timeline from messages
    const timeline: Array<{
      round: number;
      vendorOffer: string;
      accordoResponse: string;
      action: string;
    }> = [];

    let currentRound = 0;
    let vendorOffer = "";
    let accordoResponse = "";
    let action = "";

    for (const message of messages) {
      if (message.role === "VENDOR") {
        // Start new round
        if (vendorOffer && accordoResponse) {
          timeline.push({
            round: currentRound,
            vendorOffer,
            accordoResponse,
            action,
          });
        }
        currentRound++;
        vendorOffer = message.content; // Return full message content
        accordoResponse = "";
        action = "";
      } else if (message.role === "ACCORDO") {
        accordoResponse = message.content; // Return full message content
        action = message.decisionAction || "";
      }
    }

    // Add final round
    if (vendorOffer) {
      timeline.push({
        round: currentRound,
        vendorOffer,
        accordoResponse,
        action,
      });
    }

    // Get last few messages for preview
    const chatPreview = messages
      .slice(-5)
      .map(
        (m) =>
          `${m.role}: ${m.content.substring(0, 150)}${m.content.length > 150 ? "..." : ""}`,
      );

    return {
      deal: {
        id: deal.id,
        title: deal.title,
        status: deal.status,
        mode: deal.mode,
        vendorName: vendor?.name || deal.counterparty || "Unknown Vendor",
        vendorEmail: vendor?.email || "",
        companyName: vendor?.Company?.companyName || null,
      },
      finalOffer,
      metrics: {
        utilityScore: latestUtility,
        totalRounds: deal.round,
        maxRounds,
        startedAt: deal.createdAt.toISOString(),
        completedAt:
          deal.status !== "NEGOTIATING" ? deal.updatedAt.toISOString() : null,
        durationDays,
      },
      timeline,
      chatPreview,
    };
  } catch (error) {
    if (error instanceof CustomError) {
      throw error;
    }
    logger.error("[getDealSummary] Error:", error);
    throw new CustomError(
      `Failed to get deal summary: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
};

/**
 * Export deal summary as PDF
 * Generates a comprehensive PDF report with analytics, timeline, and chat transcript
 */
export const exportDealPDFService = async (
  dealId: string,
  rfqId: number,
): Promise<{ data: Buffer; filename: string }> => {
  try {
    logger.info("[exportDealPDF] Generating PDF for deal:", { dealId, rfqId });

    // Get deal summary data
    const summary = await getDealSummaryService(dealId);

    // Get full message list for transcript
    const deal = await models.ChatbotDeal.findByPk(dealId, {
      include: [
        {
          model: models.ChatbotMessage,
          as: "Messages",
          order: [["createdAt", "ASC"]],
        },
      ],
    });

    if (!deal) {
      throw new CustomError("Deal not found", 404);
    }

    const messages = (deal.Messages || []) as ChatbotMessage[];

    // Extract price data from timeline for charts
    const timelineWithPrices = summary.timeline.map((item) => {
      let vendorPrice: number | null = null;
      let accordoPrice: number | null = null;

      // Try to extract prices from messages
      const vendorMatch = item.vendorOffer.match(/\$[\d,]+(?:\.\d{2})?/);
      if (vendorMatch) {
        vendorPrice = parseFloat(vendorMatch[0].replace(/[$,]/g, ""));
      }

      const accordoMatch = item.accordoResponse.match(/\$[\d,]+(?:\.\d{2})?/);
      if (accordoMatch) {
        accordoPrice = parseFloat(accordoMatch[0].replace(/[$,]/g, ""));
      }

      return {
        ...item,
        vendorPrice,
        accordoPrice,
      };
    });

    // Prepare PDF input
    const pdfInput: DealSummaryPDFInput = {
      deal: summary.deal,
      finalOffer: summary.finalOffer,
      metrics: summary.metrics,
      timeline: timelineWithPrices,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
        extractedOffer: m.extractedOffer as any,
      })),
      rfqId,
      generatedAt: new Date(),
    };

    // Generate PDF
    const pdfBuffer = await generateDealSummaryPDF(pdfInput);
    const filename = generatePDFFilename(summary.deal.vendorName, rfqId);

    logger.info("[exportDealPDF] PDF generated successfully:", {
      dealId,
      filename,
      size: pdfBuffer.length,
    });

    return { data: pdfBuffer, filename };
  } catch (error) {
    if (error instanceof CustomError) {
      throw error;
    }
    logger.error("[exportDealPDF] Error:", error);
    throw new CustomError(
      `Failed to export PDF: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
};

/**
 * Email deal summary PDF to recipient
 * Generates PDF and sends it as an email attachment
 */
export const emailDealPDFService = async (
  dealId: string,
  rfqId: number,
  email: string,
): Promise<void> => {
  try {
    logger.info("[emailDealPDF] Sending PDF for deal:", {
      dealId,
      rfqId,
      email,
    });

    // Generate the PDF
    const { data: pdfBuffer, filename } = await exportDealPDFService(
      dealId,
      rfqId,
    );

    // Get deal info for email subject
    const summary = await getDealSummaryService(dealId);

    // Send email with attachment
    await sendDealSummaryPDFEmail({
      to: email,
      dealTitle: summary.deal.title,
      vendorName: summary.deal.vendorName,
      rfqId,
      pdfBuffer,
      filename,
    });

    logger.info("[emailDealPDF] Email sent successfully:", {
      dealId,
      email,
      filename,
    });
  } catch (error) {
    if (error instanceof CustomError) {
      throw error;
    }
    logger.error("[emailDealPDF] Error:", error);
    throw new CustomError(
      `Failed to email PDF: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
};

// ==================== NEW API RESTRUCTURE SERVICES (January 2026) ====================

/**
 * Response type for requisitions available for negotiation
 */
export interface RequisitionForNegotiation {
  id: number;
  rfqNumber: string;
  title: string;
  projectId: number;
  projectName: string;
  status: string;
  estimatedValue: number; // Frontend expects this name
  currency: string; // Currency code for estimatedValue (e.g. "USD", "INR")
  negotiationClosureDate: string | null;
  createdAt: string;
  vendorCount: number;
  productCount: number; // Frontend expects this field
}

/**
 * Vendor address for delivery location selection
 * Used in the deal wizard for selecting delivery addresses
 */
export interface VendorAddress {
  id: number;
  label: string;
  address: string;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  isDefault: boolean;
  source?: "VENDOR" | "BUYER"; // Indicates whether address is from vendor or buyer company
}

/**
 * Response type for vendors attached to a requisition
 * NOTE: Frontend expects `id` to be vendor id and `name` to be vendor name
 */
export interface RequisitionVendor {
  id: number; // Vendor ID (frontend uses this as the value for selection)
  vendorId?: number; // Same as id, included for backward compatibility
  name: string; // Vendor name (frontend expects `name` not `vendorName`)
  email?: string;
  companyId?: number;
  companyName: string | null;
  pastDealsCount: number;
  avgUtilityScore?: number | null;
  addresses: VendorAddress[];
  // Extra context fields (optional for frontend)
  contractId?: number | null;
  contractStatus?: string | null;
  hasDeal?: boolean;
  dealId?: string | null;
  dealStatus?: string | null;
}

/**
 * Response type for draft configuration
 */
export interface DealDraft {
  id: string;
  rfqId: number;
  vendorId: number;
  userId: number;
  title: string;
  configData: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Get requisitions available for negotiation
 * Returns requisitions that have vendors attached via contracts
 */
export const getRequisitionsForNegotiationService = async (
  companyId?: number | null,
): Promise<{
  requisitions: RequisitionForNegotiation[];
  total: number;
}> => {
  try {
    // Build where clause for company isolation
    // Null-tolerant: legacy projects with null companyId remain accessible.
    const whereClause: any = {};
    if (companyId) {
      whereClause["$Project.companyId$"] = { [Op.or]: [companyId, null] };
    }

    // Find requisitions that have contracts (vendors attached)
    const requisitionsWithContracts = await models.Requisition.findAll({
      where: whereClause,
      subQuery: false,
      include: [
        {
          model: models.Project,
          as: "Project",
          attributes: ["id", "projectName", "companyId"],
        },
        {
          model: models.Contract,
          as: "Contract",
          attributes: ["id", "vendorId", "status"],
          where: {
            vendorId: { [Op.ne]: null },
          },
          required: true,
        },
        {
          model: models.RequisitionProduct,
          as: "RequisitionProduct",
          attributes: ["id"],
          required: false,
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    const result: RequisitionForNegotiation[] = requisitionsWithContracts.map(
      (req) => {
        const contracts = (req as any).Contract || [];
        const requisitionProducts = (req as any).RequisitionProduct || [];
        return {
          id: req.id,
          rfqNumber: req.rfqId || `RFQ${req.id}`,
          title: req.subject || "Untitled Requisition",
          projectId: req.projectId,
          projectName: (req as any).Project?.projectName || "Unknown Project",
          status: req.status || "Open",
          estimatedValue:
            (req.totalPrice as number) ||
            (req.totalEstimatedAmount as number) ||
            0,
          currency: (req.typeOfCurrency as string) || "USD",
          negotiationClosureDate:
            req.negotiationClosureDate?.toISOString() || null,
          createdAt: req.createdAt.toISOString(),
          vendorCount: Array.isArray(contracts) ? contracts.length : 1,
          productCount: Array.isArray(requisitionProducts)
            ? requisitionProducts.length
            : 0, // Frontend expects productCount
        };
      },
    );

    return {
      requisitions: result,
      total: result.length,
    };
  } catch (error) {
    logger.error("[getRequisitionsForNegotiation] Error:", error);
    throw new CustomError(
      `Failed to get requisitions for negotiation: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
};

/**
 * Get vendors attached to a specific requisition via contracts
 * Returns data in format expected by frontend VendorSummary interface
 */
export const getRequisitionVendorsService = async (
  rfqId: number,
): Promise<RequisitionVendor[]> => {
  try {
    // Fetch requisition WITH buyer company and addresses via Project
    // Requisition -> Project -> Company -> Addresses
    const requisition = await models.Requisition.findByPk(rfqId, {
      include: [
        {
          model: models.Project,
          as: "Project",
          attributes: ["id", "projectName", "companyId"],
          required: false,
          include: [
            {
              model: models.Company,
              as: "Company",
              attributes: ["id", "companyName"],
              required: false,
              include: [
                {
                  model: models.Address,
                  as: "Addresses",
                  attributes: [
                    "id",
                    "label",
                    "address",
                    "city",
                    "state",
                    "country",
                    "postalCode",
                    "isDefault",
                  ],
                  required: false,
                },
              ],
            },
          ],
        },
      ],
    });
    if (!requisition) {
      throw new CustomError("Requisition not found", 404);
    }

    // Map buyer company addresses (per user requirement: buyer addresses only)
    // Access through: requisition.Project.Company.Addresses
    const buyerCompany = (requisition as any).Project?.Company;
    const buyerAddresses: VendorAddress[] = (buyerCompany?.Addresses || []).map(
      (addr: any) => ({
        id: addr.id,
        label: addr.label || "Delivery Address",
        address: addr.address || "",
        city: addr.city || null,
        state: addr.state || null,
        country: addr.country || null,
        postalCode: addr.postalCode || null,
        isDefault: addr.isDefault || false,
        source: "BUYER" as const,
      }),
    );

    // Get all contracts for this requisition with vendor info and addresses
    const contracts = await models.Contract.findAll({
      where: {
        requisitionId: rfqId,
        vendorId: { [Op.ne]: null },
      },
      include: [
        {
          model: models.User,
          as: "Vendor",
          attributes: ["id", "name", "email"],
          include: [
            {
              model: models.Company,
              as: "Company",
              attributes: ["id", "companyName"],
              required: false,
              include: [
                {
                  model: models.Address,
                  as: "Addresses",
                  attributes: [
                    "id",
                    "label",
                    "address",
                    "city",
                    "state",
                    "country",
                    "postalCode",
                    "isDefault",
                  ],
                  required: false,
                },
              ],
            },
          ],
        },
      ],
    });

    // For each vendor, check if they have an existing deal and count past deals
    const result: RequisitionVendor[] = [];
    const processedVendorIds = new Set<number>();

    for (const contract of contracts) {
      const vendor = (contract as any).Vendor;
      if (!vendor) continue;

      // Skip if this vendor was already added (multiple contracts per vendor on same RFQ)
      if (processedVendorIds.has(vendor.id)) continue;

      processedVendorIds.add(vendor.id);

      // Check for existing deal for this requisition
      const existingDeal = await models.ChatbotDeal.findOne({
        where: {
          requisitionId: rfqId,
          vendorId: vendor.id,
          deletedAt: null,
        },
        order: [["createdAt", "DESC"]],
      });

      // Count past completed deals for this vendor
      const pastDealsCount = await models.ChatbotDeal.count({
        where: {
          vendorId: vendor.id,
          status: { [Op.in]: ["ACCEPTED", "WALKED_AWAY", "ESCALATED"] },
          deletedAt: null,
        },
      });

      // Calculate average utility score from past deals
      const pastDeals = await models.ChatbotDeal.findAll({
        where: {
          vendorId: vendor.id,
          status: "ACCEPTED",
          latestUtility: { [Op.ne]: null },
          deletedAt: null,
        },
        attributes: ["latestUtility"],
      });
      const avgUtilityScore =
        pastDeals.length > 0
          ? pastDeals.reduce((sum, d) => sum + (d.latestUtility || 0), 0) /
            pastDeals.length
          : null;

      // Per user requirement: Only return buyer addresses (not vendor addresses)
      // The buyer addresses are from the requisition's project's company
      const addresses: VendorAddress[] = [...buyerAddresses];

      result.push({
        id: vendor.id, // Frontend expects vendor ID as `id` (User table)
        vendorId: contract.vendorId ?? undefined, // Vendor table ID (for matching with VendorDetails)
        name: vendor.name || "Unknown Vendor", // Frontend expects `name`
        email: vendor.email || "",
        companyId: vendor.Company?.id || undefined,
        companyName: vendor.Company?.companyName || null,
        pastDealsCount,
        avgUtilityScore,
        addresses,
        // Extra context fields for UI
        contractId: contract.id,
        contractStatus: contract.status,
        hasDeal: !!existingDeal,
        dealId: existingDeal?.id || null,
        dealStatus: existingDeal?.status || null,
      });
    }

    // FALLBACK: Also check ChatbotDeals table for vendors that may have deals
    // without corresponding Contract records (legacy data or edge cases)
    const dealsWithoutContracts = await models.ChatbotDeal.findAll({
      where: {
        requisitionId: rfqId,
        vendorId: { [Op.ne]: null },
        deletedAt: null,
      },
      attributes: ["vendorId"],
      group: ["vendorId"],
    });

    for (const deal of dealsWithoutContracts) {
      const vendorId = deal.vendorId;
      if (!vendorId || processedVendorIds.has(vendorId)) continue;

      // This vendor has a deal but no contract - fetch their info
      const vendor = await models.User.findByPk(vendorId, {
        attributes: ["id", "name", "email"],
        include: [
          {
            model: models.Company,
            as: "Company",
            attributes: ["id", "companyName"],
            required: false,
          },
        ],
      });

      if (!vendor) continue;

      processedVendorIds.add(vendorId);

      // Get the most recent deal for this vendor on this requisition
      const existingDeal = await models.ChatbotDeal.findOne({
        where: {
          requisitionId: rfqId,
          vendorId: vendorId,
          deletedAt: null,
        },
        order: [["createdAt", "DESC"]],
      });

      // Count past completed deals for this vendor
      const pastDealsCount = await models.ChatbotDeal.count({
        where: {
          vendorId: vendorId,
          status: { [Op.in]: ["ACCEPTED", "WALKED_AWAY", "ESCALATED"] },
          deletedAt: null,
        },
      });

      // Calculate average utility score from past deals
      const pastDeals = await models.ChatbotDeal.findAll({
        where: {
          vendorId: vendorId,
          status: "ACCEPTED",
          latestUtility: { [Op.ne]: null },
          deletedAt: null,
        },
        attributes: ["latestUtility"],
      });
      const avgUtilityScore =
        pastDeals.length > 0
          ? pastDeals.reduce((sum, d) => sum + (d.latestUtility || 0), 0) /
            pastDeals.length
          : null;

      result.push({
        id: vendor.id,
        vendorId: vendor.id,
        name: vendor.name || "Unknown Vendor",
        email: vendor.email || "",
        companyId: (vendor as any).Company?.id || undefined,
        companyName: (vendor as any).Company?.companyName || null,
        pastDealsCount,
        avgUtilityScore,
        addresses: [...buyerAddresses],
        // No contract exists for this vendor
        contractId: null,
        contractStatus: null,
        hasDeal: !!existingDeal,
        dealId: existingDeal?.id || null,
        dealStatus: existingDeal?.status || null,
      });

      logger.info(
        `[getRequisitionVendors] Added vendor ${vendorId} from ChatbotDeals fallback (no contract exists)`,
      );
    }

    logger.info("[getRequisitionVendors] Retrieved vendors", {
      rfqId,
      vendorCount: result.length,
      fromContracts: contracts.length,
      fromDealsFallback: result.length - contracts.length,
    });

    return result;
  } catch (error) {
    if (error instanceof CustomError) throw error;
    logger.error("[getRequisitionVendors] Error:", error);
    throw new CustomError(
      `Failed to get requisition vendors: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
};

// ==================== DRAFT MANAGEMENT (In-Memory Storage) ====================
// Note: Drafts are stored in memory for now. Can be moved to database if needed.

const draftStorage = new Map<string, DealDraft>();

/**
 * Save a draft deal configuration
 */
export const saveDraftService = async (input: {
  rfqId: number;
  vendorId: number;
  userId: number;
  data: Record<string, unknown>;
}): Promise<DealDraft> => {
  try {
    const draftId = uuidv4();
    const now = new Date().toISOString();

    const draft: DealDraft = {
      id: draftId,
      rfqId: input.rfqId,
      vendorId: input.vendorId,
      userId: input.userId,
      title: (input.data.title as string) || "Untitled Draft",
      configData: input.data,
      createdAt: now,
      updatedAt: now,
    };

    draftStorage.set(draftId, draft);

    logger.info("[saveDraft] Draft saved", {
      draftId,
      rfqId: input.rfqId,
      vendorId: input.vendorId,
      userId: input.userId,
    });

    return draft;
  } catch (error) {
    throw new CustomError(
      `Failed to save draft: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
};

/**
 * List drafts for a specific RFQ+Vendor combination
 */
export const listDraftsService = async (
  rfqId: number,
  vendorId: number,
  userId: number,
): Promise<DealDraft[]> => {
  try {
    const drafts: DealDraft[] = [];

    for (const draft of draftStorage.values()) {
      if (
        draft.rfqId === rfqId &&
        draft.vendorId === vendorId &&
        draft.userId === userId
      ) {
        drafts.push(draft);
      }
    }

    // Sort by updatedAt descending
    drafts.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    logger.info("[listDrafts] Retrieved drafts", {
      rfqId,
      vendorId,
      userId,
      count: drafts.length,
    });

    return drafts;
  } catch (error) {
    throw new CustomError(
      `Failed to list drafts: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
};

/**
 * Get a specific draft by ID
 */
export const getDraftService = async (draftId: string): Promise<DealDraft> => {
  try {
    const draft = draftStorage.get(draftId);

    if (!draft) {
      throw new CustomError("Draft not found", 404);
    }

    return draft;
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      `Failed to get draft: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
};

/**
 * Delete a draft by ID
 */
export const deleteDraftService = async (draftId: string): Promise<void> => {
  try {
    const draft = draftStorage.get(draftId);

    if (!draft) {
      throw new CustomError("Draft not found", 404);
    }

    draftStorage.delete(draftId);

    logger.info("[deleteDraft] Draft deleted", { draftId });
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      `Failed to delete draft: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
};

// ==================== VENDOR ADDRESSES ====================

/**
 * Response type for vendor delivery addresses
 */
export interface VendorDeliveryAddress {
  id: string;
  name: string;
  address: string;
  type: "company";
  isDefault: boolean;
}

/**
 * Get delivery addresses for a specific vendor
 * Returns the vendor's company addresses from the Addresses table
 * Falls back to legacy fullAddress field if no addresses exist
 */
export const getVendorAddressesService = async (
  vendorId: number,
): Promise<VendorDeliveryAddress[]> => {
  try {
    // Get the vendor user with their company and addresses
    const vendor = await models.User.findByPk(vendorId, {
      include: [
        {
          model: models.Company,
          as: "Company",
          attributes: ["id", "companyName", "fullAddress"],
          include: [
            {
              model: models.Address,
              as: "Addresses",
              attributes: [
                "id",
                "label",
                "address",
                "city",
                "state",
                "country",
                "postalCode",
                "isDefault",
              ],
            },
          ],
        },
      ],
    });

    if (!vendor) {
      throw new CustomError("Vendor not found", 404);
    }

    const addresses: VendorDeliveryAddress[] = [];

    // First, add addresses from the Addresses table (preferred)
    if (vendor.Company?.Addresses && vendor.Company.Addresses.length > 0) {
      for (const addr of vendor.Company.Addresses) {
        // Build full address string from components
        const addressParts = [
          addr.address,
          addr.city,
          addr.state,
          addr.postalCode,
          addr.country,
        ].filter(Boolean);

        addresses.push({
          id: `address-${addr.id}`,
          name: addr.label || "Address",
          address: addressParts.join(", "),
          type: "company",
          isDefault: addr.isDefault,
        });
      }
    }
    // Fall back to legacy fullAddress field if no addresses in Addresses table
    else if (vendor.Company && vendor.Company.fullAddress) {
      addresses.push({
        id: `company-${vendor.Company.id}`,
        name: vendor.Company.companyName || "Company Address",
        address: vendor.Company.fullAddress,
        type: "company",
        isDefault: true,
      });
    }

    logger.info("[getVendorAddresses] Retrieved addresses", {
      vendorId,
      addressCount: addresses.length,
      source: vendor.Company?.Addresses?.length
        ? "Addresses table"
        : "legacy fullAddress",
    });

    return addresses;
  } catch (error) {
    if (error instanceof CustomError) {
      throw error;
    }
    logger.error("[getVendorAddresses] Error:", error);
    throw new CustomError(
      `Failed to get vendor addresses: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
};

// ==================== VENDOR NEGOTIATION (AI-PM MODE) ====================

import {
  generateVendorScenarios,
  generateAiPmResponse,
  generatePmOpeningOffer,
  type PmStance,
  type VendorScenarioOffer,
  type AiPmDecision,
} from "./vendor/vendor-policy.js";

/**
 * Extract PM stance from deal's wizard config
 *
 * UPDATED January 2026: Now handles multiple config structures:
 * 1. wizardConfig.priceQuantity.targetUnitPrice (new wizard deals)
 * 2. parameters.total_price.target (engine config format)
 * 3. Root level targetPrice/maxAcceptablePrice (legacy seeded deals)
 */
const extractPmStance = (deal: ChatbotDeal): PmStance => {
  const configJson = deal.negotiationConfigJson as Record<
    string,
    unknown
  > | null;
  const wizardConfig = configJson?.wizardConfig as
    | Record<string, unknown>
    | undefined;

  // Extract values from wizard config with defaults
  const priceQuantity = (wizardConfig?.priceQuantity || {}) as Record<
    string,
    number
  >;
  const paymentTerms = (wizardConfig?.paymentTerms || {}) as Record<
    string,
    number
  >;
  const delivery = (wizardConfig?.delivery || {}) as Record<string, string>;
  const negotiationControl = (wizardConfig?.negotiationControl || {}) as Record<
    string,
    number
  >;

  // Also check for engine config format (parameters.total_price)
  const parameters = configJson?.parameters as
    | Record<string, Record<string, number>>
    | undefined;
  const unitPriceConfig = parameters?.total_price || {};

  // Also check for legacy root-level config (seeded deals)
  const rootConfig = configJson as Record<string, number> | null;

  // Extract target price with fallback chain:
  // 1. wizardConfig.priceQuantity.targetUnitPrice (new wizard deals)
  // 2. parameters.total_price.target (engine config format)
  // 3. root level targetPrice (legacy seeded deals)
  // 4. default 100
  const targetUnitPrice =
    priceQuantity.targetUnitPrice ||
    unitPriceConfig.target ||
    (rootConfig?.targetPrice as number) ||
    100;

  // Extract max price with fallback chain:
  // 1. wizardConfig.priceQuantity.maxAcceptablePrice (new wizard deals)
  // 2. parameters.total_price.max_acceptable (engine config format)
  // 3. root level maxAcceptablePrice (legacy seeded deals)
  // 4. default to target * 1.2
  const maxAcceptablePrice =
    priceQuantity.maxAcceptablePrice ||
    unitPriceConfig.max_acceptable ||
    (rootConfig?.maxAcceptablePrice as number) ||
    targetUnitPrice * 1.2;

  return {
    targetUnitPrice,
    maxAcceptablePrice,
    idealPaymentDays: paymentTerms.minDays || 30,
    maxPaymentDays: paymentTerms.maxDays || 60,
    requiredDeliveryDate:
      delivery.requiredDate ||
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0],
    preferredDeliveryDate: delivery.preferredDate as string | undefined,
    walkawayThreshold: (negotiationControl.walkawayThreshold || 30) / 100,
    acceptThreshold: 0.7, // Default accept threshold
    escalateThreshold: 0.5, // Default escalate threshold
    maxRounds: negotiationControl.maxRounds || 10,
  };
};

/**
 * Start negotiation - generates AI-PM's opening offer
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/start-negotiation
 *
 * Called when vendor opens the deal for the first time.
 * AI-PM generates opening offer based on wizard config values.
 */
export const startNegotiationService = async (
  dealId: string,
): Promise<{
  deal: ChatbotDeal;
  messages: ChatbotMessage[];
  pmOpeningMessage: ChatbotMessage;
}> => {
  try {
    const deal = await models.ChatbotDeal.findByPk(dealId, {
      include: [
        { model: models.Requisition, as: "Requisition" },
        {
          model: models.User,
          as: "Vendor",
          attributes: ["id", "name", "email"],
        },
      ],
    });

    if (!deal) {
      throw new CustomError("Deal not found", 404);
    }

    // Check if deal already started (has messages)
    const existingMessages = await models.ChatbotMessage.findAll({
      where: { dealId },
      order: [["createdAt", "ASC"]],
    });

    if (existingMessages.length > 0) {
      // Already started - just return current state
      return {
        deal,
        messages: existingMessages,
        pmOpeningMessage: existingMessages[0],
      };
    }

    // Extract PM stance from wizard config
    const pmStance = extractPmStance(deal);

    // Get product info from requisition
    const requisition = deal.Requisition as any;
    const productName = requisition?.subject || "the products";
    const quantity = 1; // Default quantity

    // Generate PM opening offer
    const pmOpeningText = generatePmOpeningOffer(
      pmStance,
      productName,
      quantity,
    );

    // Create PM's opening message
    const pmMessageId = uuidv4();
    const pmOpeningMessage = await models.ChatbotMessage.create({
      id: pmMessageId,
      dealId,
      role: "ACCORDO",
      content: pmOpeningText,
      extractedOffer: {
        total_price: pmStance.targetUnitPrice,
        payment_terms:
          pmStance.idealPaymentDays <= 30
            ? "Net 30"
            : pmStance.idealPaymentDays <= 60
              ? "Net 60"
              : "Net 90",
      } as any,
      engineDecision: null,
      decisionAction: "COUNTER", // PM's first offer is a counter
      utilityScore: 1.0, // PM's target = 100% utility for PM
      counterOffer: {
        total_price: pmStance.targetUnitPrice,
        payment_terms:
          pmStance.idealPaymentDays <= 30
            ? "Net 30"
            : pmStance.idealPaymentDays <= 60
              ? "Net 60"
              : "Net 90",
      } as any,
      explainabilityJson: null,
    });

    // Update deal status
    await deal.update({
      status: "NEGOTIATING",
      round: 1,
      lastMessageAt: new Date(),
    });

    logger.info("[StartNegotiation] PM opening offer generated", {
      dealId,
      targetPrice: pmStance.targetUnitPrice,
    });

    return {
      deal,
      messages: [pmOpeningMessage],
      pmOpeningMessage,
    };
  } catch (error) {
    if (error instanceof CustomError) throw error;
    logger.error("[StartNegotiation] Error:", error);
    throw new CustomError(
      `Failed to start negotiation: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
};

/**
 * Get vendor scenarios - scenario chips for vendor based on current state
 * GET /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/vendor-scenarios
 *
 * Returns HARD/MEDIUM/SOFT scenario chips calculated from:
 * - PM's last offer
 * - Product category margins
 * - Vendor's profit goals
 */
export const getVendorScenariosService = async (
  dealId: string,
): Promise<{
  scenarios: VendorScenarioOffer[];
  pmLastOffer: {
    price: number;
    paymentTerms: string;
    deliveryDate: string;
  } | null;
  productCategory: string;
}> => {
  try {
    const deal = await models.ChatbotDeal.findByPk(dealId, {
      include: [{ model: models.Requisition, as: "Requisition" }],
    });

    if (!deal) {
      throw new CustomError("Deal not found", 404);
    }

    // Get PM's last offer from messages
    const lastPmMessage = await models.ChatbotMessage.findOne({
      where: { dealId, role: "ACCORDO" },
      order: [["createdAt", "DESC"]],
    });

    let pmLastOffer: {
      price: number;
      paymentTerms: string;
      deliveryDate: string;
    } | null = null;

    if (lastPmMessage && lastPmMessage.counterOffer) {
      const counterOffer = lastPmMessage.counterOffer as any;
      pmLastOffer = {
        price: counterOffer.total_price || counterOffer.price || 0,
        paymentTerms:
          counterOffer.payment_terms || counterOffer.paymentTerms || "Net 30",
        deliveryDate:
          counterOffer.delivery_date ||
          counterOffer.deliveryDate ||
          new Date().toISOString().split("T")[0],
      };
    }

    // Get product category from requisition or default
    const productCategory = (deal.Requisition as any)?.category || "default";

    // Extract PM stance to get target and max prices
    const pmStance = extractPmStance(deal);
    const pmTargetPrice = pmStance.targetUnitPrice;
    const pmMaxPrice = pmStance.maxAcceptablePrice;

    // Generate vendor scenarios using PM's price range
    // UPDATED January 2026: Now uses PM's target and max prices for realistic vendor offers
    const scenarios = generateVendorScenarios(
      pmLastOffer,
      productCategory,
      pmTargetPrice,
      pmMaxPrice,
      1, // quantity
    );

    logger.info("[GetVendorScenarios] Scenarios generated", {
      dealId,
      pmLastOffer,
      pmTargetPrice,
      pmMaxPrice,
      scenarioCount: scenarios.length,
    });

    return {
      scenarios,
      pmLastOffer,
      productCategory,
    };
  } catch (error) {
    if (error instanceof CustomError) throw error;
    logger.error("[GetVendorScenarios] Error:", error);
    throw new CustomError(
      `Failed to get vendor scenarios: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
};

/**
 * Vendor sends message - vendor sends offer, AI-PM responds immediately
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/vendor-message
 *
 * Flow:
 * 1. Vendor sends message
 * 2. System parses vendor's offer
 * 3. AI-PM evaluates against PM's config
 * 4. AI-PM generates response (ACCEPT/COUNTER/ESCALATE/WALK_AWAY)
 * 5. Both messages returned to frontend
 */
export const vendorSendMessageService = async (
  dealId: string,
  content: string,
  userId: number,
): Promise<{
  deal: ChatbotDeal;
  messages: ChatbotMessage[];
  vendorMessage: ChatbotMessage;
  pmResponse: ChatbotMessage;
  pmDecision: AiPmDecision;
}> => {
  try {
    const deal = await models.ChatbotDeal.findByPk(dealId);
    if (!deal) {
      throw new CustomError("Deal not found", 404);
    }

    if (deal.status !== "NEGOTIATING") {
      throw new CustomError("Deal is not in negotiating status", 400);
    }

    // Parse vendor's offer from message
    const vendorOffer = parseOfferRegex(content);

    // Save vendor message
    const vendorMessageId = uuidv4();
    const vendorMessage = await models.ChatbotMessage.create({
      id: vendorMessageId,
      dealId,
      role: "VENDOR",
      content,
      extractedOffer: vendorOffer as any,
      engineDecision: null,
      decisionAction: null,
      utilityScore: null,
      counterOffer: null,
      explainabilityJson: null,
    });

    // Extract PM stance from wizard config
    const pmStance = extractPmStance(deal);

    // Generate AI-PM response
    const pmDecision = generateAiPmResponse(
      {
        price: vendorOffer.total_price,
        paymentTerms: vendorOffer.payment_terms,
        deliveryDate: null, // TODO: Parse delivery date from message
      },
      pmStance,
      deal.round,
    );

    // Save PM response message
    const pmMessageId = uuidv4();
    const pmResponse = await models.ChatbotMessage.create({
      id: pmMessageId,
      dealId,
      role: "ACCORDO",
      content: pmDecision.message,
      extractedOffer: null,
      engineDecision: {
        action: pmDecision.action,
        utilityScore: pmDecision.utility,
        counterOffer: pmDecision.counterOffer || null,
        reasoning: pmDecision.reasoning,
      } as any,
      decisionAction: pmDecision.action,
      utilityScore: pmDecision.utility,
      counterOffer: pmDecision.counterOffer
        ? ({
            total_price: pmDecision.counterOffer.price,
            payment_terms: pmDecision.counterOffer.paymentTerms,
          } as any)
        : null,
      explainabilityJson: {
        reasoning: pmDecision.reasoning,
        utility: pmDecision.utility,
      } as any,
    });

    // Determine final status based on PM decision
    let finalStatus: "NEGOTIATING" | "ACCEPTED" | "WALKED_AWAY" | "ESCALATED" =
      deal.status;
    if (pmDecision.action === "ACCEPT") finalStatus = "ACCEPTED";
    else if (pmDecision.action === "WALK_AWAY") finalStatus = "WALKED_AWAY";
    else if (pmDecision.action === "ESCALATE") finalStatus = "ESCALATED";

    // Update deal status
    await deal.update({
      status: finalStatus,
      round: deal.round + 1,
      latestVendorOffer: vendorOffer as any,
      latestOfferJson: pmDecision.counterOffer
        ? ({
            total_price: pmDecision.counterOffer.price,
            payment_terms: pmDecision.counterOffer.paymentTerms,
          } as any)
        : null,
      latestDecisionAction: pmDecision.action,
      latestUtility: pmDecision.utility,
      lastMessageAt: new Date(),
    });

    // Reload deal with updated status
    await deal.reload();

    // Get all messages for this deal
    const allMessages = await models.ChatbotMessage.findAll({
      where: { dealId },
      order: [["createdAt", "ASC"]],
    });

    logger.info("[VendorSendMessage] Vendor message processed", {
      dealId,
      vendorOffer,
      pmDecision: pmDecision.action,
      utility: pmDecision.utility,
      newRound: deal.round,
      finalStatus,
    });

    // Send PM notification email if deal status changed to terminal state
    if (
      finalStatus === "ACCEPTED" ||
      finalStatus === "WALKED_AWAY" ||
      finalStatus === "ESCALATED"
    ) {
      try {
        // Only proceed if we have valid user and requisition IDs
        if (!deal.userId || !deal.requisitionId) {
          logger.warn(
            "[VendorSendMessage] Cannot send PM notification - missing userId or requisitionId",
            {
              dealId,
              hasUserId: !!deal.userId,
              hasRequisitionId: !!deal.requisitionId,
            },
          );
        } else {
          // Get PM (deal creator) info
          const pmUser = await models.User.findByPk(deal.userId);
          // Get requisition info
          const requisition = await models.Requisition.findByPk(
            deal.requisitionId,
          );
          // Get vendor info
          const vendorUser = deal.vendorId
            ? await models.User.findByPk(deal.vendorId)
            : null;
          const vendorCompany = deal.vendorId
            ? await models.Company.findOne({
                include: [
                  {
                    model: models.VendorCompany,
                    as: "VendorCompanies",
                    where: { vendorId: deal.vendorId },
                    required: true,
                  },
                ],
              })
            : null;

          if (pmUser && requisition) {
            const emailResult = await sendPmDealStatusNotificationEmail({
              dealId: deal.id,
              dealTitle: deal.title,
              requisitionId: deal.requisitionId as number,
              rfqNumber:
                (requisition as any).rfqId || `RFQ-${deal.requisitionId}`,
              vendorName: vendorUser?.name || "Vendor",
              vendorCompanyName: (vendorCompany as any)?.name || undefined,
              pmEmail: pmUser.email || "",
              pmName: pmUser.name || "Procurement Manager",
              pmUserId: pmUser.id,
              newStatus: finalStatus,
              utility: pmDecision.utility,
              vendorOffer: {
                price: vendorOffer.total_price,
                paymentTerms: vendorOffer.payment_terms,
              },
              reasoning: pmDecision.reasoning
                ? [pmDecision.reasoning]
                : undefined,
            });

            if (emailResult.success) {
              logger.info("[VendorSendMessage] PM notification email sent", {
                dealId,
                pmEmail: pmUser.email,
                status: finalStatus,
              });
            } else {
              logger.warn("[VendorSendMessage] PM notification email failed", {
                dealId,
                error: emailResult.error,
              });
            }
          } else {
            logger.warn(
              "[VendorSendMessage] Could not send PM notification - missing user or requisition",
              {
                dealId,
                hasUser: !!pmUser,
                hasRequisition: !!requisition,
              },
            );
          }
        }
      } catch (emailError) {
        // Don't fail the entire operation if email fails
        logger.error(
          "[VendorSendMessage] Error sending PM notification email",
          {
            dealId,
            error:
              emailError instanceof Error
                ? emailError.message
                : String(emailError),
          },
        );
      }

      // Update vendor negotiation profile (fire-and-forget)
      updateVendorProfileOnDealCompletion(
        deal.id,
        finalStatus as "ACCEPTED" | "WALKED_AWAY" | "ESCALATED",
        deal.vendorId,
      ).catch((err) =>
        logger.error(
          `[VendorSendMessage] Failed to update vendor profile: ${(err as Error).message}`,
        ),
      );
    }

    return {
      deal,
      messages: allMessages,
      vendorMessage,
      pmResponse,
      pmDecision,
    };
  } catch (error) {
    if (error instanceof CustomError) throw error;
    logger.error("[VendorSendMessage] Error:", error);
    throw new CustomError(
      `Failed to process vendor message: ${error instanceof Error ? error.message : String(error)}`,
      500,
    );
  }
};

// ============================================================================
// MESO SELECTION SERVICES (February 2026)
// ============================================================================

/**
 * Input for processing MESO selection
 */
export interface ProcessMesoSelectionInput {
  dealId: string;
  selectedOptionId: string;
  userId: number;
}

/**
 * Result from MESO selection processing
 */
export interface ProcessMesoSelectionResult {
  deal: ChatbotDeal;
  message: ChatbotMessage;
  selectedOption: MesoOption;
}

/**
 * Process MESO option selection (Offer 1, 2, or 3)
 *
 * When vendor selects a MESO offer:
 * 1. Load deal and MESO round
 * 2. Find selected option
 * 3. Update deal.status = 'ACCEPTED'
 * 4. Update deal.latestOfferJson with selected offer
 * 5. Create ACCORDO message: "Your deal is under review..."
 * 6. Sync contract status
 *
 * @param input - Selection input
 * @returns Deal and confirmation message
 */
export const processMesoSelectionService = async (
  input: ProcessMesoSelectionInput,
): Promise<ProcessMesoSelectionResult> => {
  try {
    const deal = await models.ChatbotDeal.findByPk(input.dealId);
    if (!deal) {
      throw new CustomError("Deal not found", 404);
    }

    if (deal.status !== "NEGOTIATING") {
      throw new CustomError("Deal is not in negotiating status", 400);
    }

    // Get the latest MESO round for this deal
    const mesoRound = await models.MesoRound.findOne({
      where: { dealId: input.dealId },
      order: [["round", "DESC"]],
    });

    if (!mesoRound) {
      throw new CustomError("No MESO round found for this deal", 400);
    }

    // Find the selected option
    const options = mesoRound.options as MesoOption[];
    const selectedOption = options.find((o) => o.id === input.selectedOptionId);

    if (!selectedOption) {
      throw new CustomError(
        `Selected option ${input.selectedOptionId} not found in MESO round`,
        400,
      );
    }

    // Update MESO round with selection
    await mesoRound.update({
      selectedOptionId: input.selectedOptionId,
      vendorSelection: {
        selectedOptionId: input.selectedOptionId,
        selectedOffer: selectedOption.offer,
        selectedAt: new Date().toISOString(),
      },
    });

    // Create confirmation message
    const mesoCurrencySymbol = getCurrencySymbol(
      (deal.negotiationConfigJson as any)?.currency,
    );
    const messageContent =
      `Thank you for your selection! Your deal has been accepted at:\n\n` +
      `• Price: ${mesoCurrencySymbol}${selectedOption.offer.total_price?.toLocaleString()}\n` +
      `• Payment Terms: ${selectedOption.offer.payment_terms}\n` +
      (selectedOption.offer.delivery_days
        ? `• Delivery: ${selectedOption.offer.delivery_days} days\n`
        : "") +
      (selectedOption.offer.warranty_months
        ? `• Warranty: ${selectedOption.offer.warranty_months} months\n`
        : "") +
      `\nYour deal is now **under review** and will be finalized shortly. You will receive a confirmation email once the contract is ready.`;

    const messageId = uuidv4();
    const confirmationMessage = await models.ChatbotMessage.create({
      id: messageId,
      dealId: input.dealId,
      role: "ACCORDO",
      content: messageContent,
      extractedOffer: null,
      engineDecision: null,
      decisionAction: "ACCEPT",
      utilityScore: selectedOption.utility,
      counterOffer: selectedOption.offer as any,
      explainabilityJson: null,
      round: deal.round,
    });

    // Update deal status to ACCEPTED
    await deal.update({
      status: "ACCEPTED",
      latestOfferJson: selectedOption.offer as any,
      latestDecisionAction: "ACCEPT",
      latestUtility: selectedOption.utility,
    });

    logger.info(`[MESO] Deal ${input.dealId} accepted via MESO selection`, {
      selectedOptionId: input.selectedOptionId,
      price: selectedOption.offer.total_price,
      utility: selectedOption.utility,
    });

    // Sync contract status (fire-and-forget)
    syncContractStatus(deal.id, "ACCEPTED", deal.contractId).catch((err) =>
      logger.error(
        `[MESO] Failed to sync contract status: ${(err as Error).message}`,
      ),
    );

    // Update vendor negotiation profile (fire-and-forget)
    updateVendorProfileOnDealCompletion(
      deal.id,
      "ACCEPTED",
      deal.vendorId,
    ).catch((err) =>
      logger.error(
        `[MESO] Failed to update vendor profile: ${(err as Error).message}`,
      ),
    );

    return {
      deal,
      message: confirmationMessage,
      selectedOption,
    };
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      `Failed to process MESO selection: ${(error as Error).message}`,
      500,
    );
  }
};

/**
 * Input for processing "Others" selection
 */
export interface ProcessOthersSelectionInput {
  dealId: string;
  totalPrice: number;
  paymentTermsDays: number;
  userId: number;
}

/**
 * Process "Others" selection with vendor's counter-offer
 *
 * When vendor submits Others form:
 * 1. Load deal
 * 2. Update mesoCycleState: othersSelectedCount++, inPostOthersPhase=true
 * 3. Create ExtendedOffer from form data
 * 4. Create VENDOR message with offer
 * 5. Continue with generatePMResponseAsyncService logic
 *
 * @param input - Others form input
 * @returns PM response result
 */
export const processOthersSelectionService = async (
  input: ProcessOthersSelectionInput,
): Promise<PMResponseResult> => {
  try {
    const deal = await models.ChatbotDeal.findByPk(input.dealId);
    if (!deal) {
      throw new CustomError("Deal not found", 404);
    }

    if (deal.status !== "NEGOTIATING") {
      throw new CustomError("Deal is not in negotiating status", 400);
    }

    // Get current negotiation state
    let negotiationState: NegotiationState =
      (deal.convoStateJson as NegotiationState) ||
      createEmptyNegotiationState();

    // Update MESO cycle state for Others selection
    negotiationState.mesoCycleState = updateMesoCycleStateOnOthersSelection(
      negotiationState.mesoCycleState,
      deal.round + 1,
    );

    // Store last Others offer
    negotiationState.othersFormState = {
      lastOthersOffer: {
        totalPrice: input.totalPrice,
        paymentTermsDays: input.paymentTermsDays,
        submittedAt: new Date().toISOString(),
      },
    };

    // Create vendor offer from form data
    const vendorOffer: ExtendedOffer = {
      total_price: input.totalPrice,
      payment_terms: `Net ${input.paymentTermsDays}`,
      payment_terms_days: input.paymentTermsDays,
    };

    // Create vendor message
    const othersCsym = getCurrencySymbol(
      (deal.negotiationConfigJson as any)?.currency,
    );
    const vendorMessageContent = `I'd like to propose ${othersCsym}${input.totalPrice.toLocaleString()} with Net ${input.paymentTermsDays} payment terms.`;
    const vendorMessageId = uuidv4();
    const currentRound = deal.round + 1;

    const vendorMessage = await models.ChatbotMessage.create({
      id: vendorMessageId,
      dealId: input.dealId,
      role: "VENDOR",
      content: vendorMessageContent,
      extractedOffer: vendorOffer as any,
      engineDecision: null,
      decisionAction: null,
      utilityScore: null,
      counterOffer: null,
      explainabilityJson: null,
      round: currentRound,
    });

    // Update deal with negotiation state
    await deal.update({
      latestVendorOffer: vendorOffer as any,
      convoStateJson: negotiationState as any,
      lastMessageAt: new Date(),
    });

    logger.info(`[MESO] Others selected for deal ${input.dealId}`, {
      totalPrice: input.totalPrice,
      paymentTermsDays: input.paymentTermsDays,
      othersSelectedCount: negotiationState.mesoCycleState?.othersSelectedCount,
    });

    // Now generate PM response using the existing async service
    const pmResult = await generatePMResponseAsyncService({
      dealId: input.dealId,
      vendorMessageId,
      userId: input.userId,
    });

    return pmResult;
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      `Failed to process Others selection: ${(error as Error).message}`,
      500,
    );
  }
};

/**
 * Input for processing final offer confirmation
 */
export interface ProcessFinalOfferConfirmationInput {
  dealId: string;
  isConfirmedFinal: boolean;
  userId: number;
}

/**
 * Result from final offer confirmation
 */
export interface ProcessFinalOfferConfirmationResult {
  deal: ChatbotDeal;
  message?: ChatbotMessage;
  meso?: MesoResult;
  continueNegotiation: boolean;
}

/**
 * Process "Is this your final offer?" confirmation
 *
 * If Yes (isConfirmedFinal=true):
 *   1. Check if stalledPrice <= maxAcceptablePrice
 *   2. Generate MESO based on vendor's price, isFinal=true (no Others option)
 *   3. Update finalOfferState.vendorConfirmedFinal = true
 *
 * If No (isConfirmedFinal=false):
 *   1. Reset stall detection state
 *   2. Continue normal negotiation
 *
 * @param input - Confirmation input
 * @returns Final offer result
 */
export const processFinalOfferConfirmationService = async (
  input: ProcessFinalOfferConfirmationInput,
): Promise<ProcessFinalOfferConfirmationResult> => {
  try {
    const deal = await models.ChatbotDeal.findByPk(input.dealId);
    if (!deal) {
      throw new CustomError("Deal not found", 404);
    }

    if (deal.status !== "NEGOTIATING") {
      throw new CustomError("Deal is not in negotiating status", 400);
    }

    // Get current negotiation state
    let negotiationState: NegotiationState =
      (deal.convoStateJson as NegotiationState) ||
      createEmptyNegotiationState();

    // Get vendor's last offer price (stalled price)
    const latestVendorOffer = deal.latestVendorOffer as ExtendedOffer | null;
    const stalledPrice = latestVendorOffer?.total_price;

    if (!stalledPrice) {
      throw new CustomError("No vendor offer found to confirm as final", 400);
    }

    if (!input.isConfirmedFinal) {
      // Vendor said "No" - continue normal negotiation
      // Reset stall detection (clear parameter histories)
      if ((negotiationState as any).parameterHistories) {
        (negotiationState as any).parameterHistories = [];
      }

      // Reset final offer state
      negotiationState.finalOfferState = createEmptyFinalOfferState();

      await deal.update({
        convoStateJson: negotiationState as any,
      });

      // Create system message
      const messageContent = `Thank you for the clarification. Let's continue our negotiation. I'm looking forward to finding a mutually beneficial agreement.`;
      const messageId = uuidv4();
      const systemMessage = await models.ChatbotMessage.create({
        id: messageId,
        dealId: input.dealId,
        role: "ACCORDO",
        content: messageContent,
        round: deal.round,
      });

      logger.info(
        `[MESO] Final offer NOT confirmed for deal ${input.dealId}, continuing negotiation`,
      );

      return {
        deal,
        message: systemMessage,
        continueNegotiation: true,
      };
    }

    // Vendor said "Yes" - generate final MESO
    negotiationState.finalOfferState = updateFinalOfferStateOnConfirm(
      negotiationState.finalOfferState,
      stalledPrice,
    );

    // Get resolved config for MESO generation
    const wizardConfig = (deal.negotiationConfigJson as any)?.wizardConfig;
    const resolvedConfig = resolveNegotiationConfig(wizardConfig || {});
    // Deal currency is stored on the negotiation config at deal creation (chatbot.service.ts ~L607)
    const dealCurrency = ((deal.negotiationConfigJson as any)?.currency ||
      "USD") as SupportedCurrency;

    // Generate MESO based on vendor's confirmed price
    const mesoResult = generateMesoFromVendorPrice(
      resolvedConfig,
      stalledPrice,
      deal.round + 1,
      dealCurrency,
    );

    if (mesoResult.success && mesoResult.options.length > 0) {
      // Store MESO round in database
      await models.MesoRound.create({
        id: uuidv4(),
        dealId: deal.id,
        round: deal.round + 1,
        options: mesoResult.options as any,
        targetUtility: mesoResult.targetUtility,
        variance: mesoResult.variance,
        vendorSelection: null,
        selectedOptionId: null,
        inferredPreferences: null,
        preferenceConfidence: null,
        metadata: {
          generatedAt: new Date().toISOString(),
          isFinal: true,
          vendorConfirmedPrice: stalledPrice,
          generationType: "vendor_final",
        },
      });

      // Mark final MESO as shown
      negotiationState.finalOfferState = updateFinalOfferStateOnMesoShown(
        negotiationState.finalOfferState,
      );
    }

    // Create system message introducing final MESO
    const finalCsym = getCurrencySymbol(
      (deal.negotiationConfigJson as any)?.currency,
    );
    const priceAdjusted = stalledPrice > resolvedConfig.maxAcceptablePrice;
    const messageContent = priceAdjusted
      ? `Thank you for confirming. Your price of ${finalCsym}${stalledPrice.toLocaleString()} exceeds our maximum budget. We've prepared adjusted offers within our acceptable range. Please select one of the final offers below to close this deal.`
      : `Thank you for confirming your final offer of ${finalCsym}${stalledPrice.toLocaleString()}. We've prepared final offers based on your price. Please select one to close this deal.`;

    const messageId = uuidv4();
    const systemMessage = await models.ChatbotMessage.create({
      id: messageId,
      dealId: input.dealId,
      role: "ACCORDO",
      content: messageContent,
      round: deal.round + 1,
    });

    // Update deal
    await deal.update({
      convoStateJson: negotiationState as any,
    });

    logger.info(`[MESO] Final offer confirmed for deal ${input.dealId}`, {
      stalledPrice,
      priceAdjusted,
      mesoOptions: mesoResult.options.length,
    });

    return {
      deal,
      message: systemMessage,
      meso: mesoResult,
      continueNegotiation: false,
    };
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError(
      `Failed to process final offer confirmation: ${(error as Error).message}`,
      500,
    );
  }
};
