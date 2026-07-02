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
  detectTermsRequest,
} from "./engine/parse-offer.js";
import {
  decideNextMove,
  extractVendorMaxTermsDays,
  capTermsToVendorMax,
} from "./engine/decide.js";
import {
  computeExplainability,
  totalUtility,
  priceUtility,
  type NegotiationConfig,
} from "./engine/utility.js";
import {
  readWizardMaxTotalPrice,
  readWizardMinTotalPrice,
  readEngineMaxTotalPrice,
  readEngineMinTotalPrice,
  resolveEngineTotalPriceBlock,
  writeEngineTotalPriceFields,
  resolveRfqTotalPriceBounds,
  resolveRfqTotalPriceBoundsWithProducts,
  sumRequisitionProductTotals,
} from "./engine/pricing-field-keys.js";
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
    if (config?.minTotalPrice && latestOffer?.total_price) {
      const minTotalPrice = config.minTotalPrice;
      const finalPrice = latestOffer.total_price;
      finalPriceReduction = ((minTotalPrice - finalPrice) / minTotalPrice) * 100;
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
  mode?: "CONVERSATION";
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
  mode: "CONVERSATION";
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
    minTotalPrice: number;
    maxTotalPrice: number;
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
  mode?: "CONVERSATION";
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

  // Product line totals (qty × unit) + RFQ header authority
  const bounds = resolveRfqTotalPriceBoundsWithProducts(
    requisition,
    requisition.RequisitionProduct as Parameters<
      typeof resolveRfqTotalPriceBoundsWithProducts
    >[1],
  );

  const minTotal = bounds.minTotalPrice ?? 1000;
  const maxAcceptable = bounds.maxTotalPrice ?? minTotal * 1.25;
  const anchor = minTotal * 0.85;
  const concessionStep = (maxAcceptable - minTotal) / 6;

  const currencyCode = (requisition.typeOfCurrency as string) || "USD";
  logger.info(
    `Built config from requisition ${requisitionId}: min=${currencyCode} ${minTotal}, max=${currencyCode} ${maxAcceptable}`,
  );

  return {
    parameters: {
      total_price: writeEngineTotalPriceFields(minTotal, maxAcceptable, {
        weight: 0.6,
        direction: "minimize",
        anchor,
        concession_step: concessionStep,
      }),
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
      mode: "CONVERSATION",
      latestOfferJson: null,
      latestVendorOffer: null,
      latestDecisionAction: null,
      latestUtility: null,
      convoStateJson: { phase: "GREETING", history: [] },
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

    // Both minTotalPrice/maxTotalPrice (and legacy targetUnitPrice/maxAcceptablePrice) are total contract values.
    const orderQty = priceQuantity.minOrderQuantity || 1;
    const minTotalPrice =
      readWizardMinTotalPrice(priceQuantity) ?? 0;
    const maxTotalPriceVal =
      readWizardMaxTotalPrice(priceQuantity) ?? 0;

    // Calculate concession step based on total price range
    const priceRange = maxTotalPriceVal - minTotalPrice;
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
        total_price: writeEngineTotalPriceFields(minTotalPrice, maxTotalPriceVal, {
          weight: priceWeight,
          direction: "minimize",
          anchor: minTotalPrice * 0.85,
          concession_step: concessionStep,
        }),
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
        resolveEngineTotalPriceBlock(negotiationConfig.parameters)?.anchor ?? 0,
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
        const priceParams = resolveEngineTotalPriceBlock(negotiationConfig.parameters);
        const originalAnchor = priceParams?.anchor ?? 0;
        const adjustedAnchor = adjustAnchorFromHistory(
          originalAnchor,
          readEngineMinTotalPrice(priceParams),
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
      mode: "CONVERSATION",
      latestOfferJson: null,
      latestVendorOffer: null,
      latestDecisionAction: null,
      latestUtility: null,
      convoStateJson: { phase: "GREETING", history: [] },
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
          minUnitPrice: rp.minUnitPrice ?? rp.targetPrice ?? minTotalPrice,
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
                      targetPrice: minTotalPrice,
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
                      targetPrice: minTotalPrice,
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
                      targetPrice: minTotalPrice,
                    },
                  ],
            priceConfig: {
              minTotalPrice,
              maxTotalPrice: maxTotalPriceVal,
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
                      targetPrice: minTotalPrice,
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
    minTotalPrice: number | null;
    maxTotalPrice: number | null;
    totalQuantity: number | null;
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

    // Calculate totals from requisition products (qty × unit price)
    const productTotals = sumRequisitionProductTotals(
      requisition.RequisitionProduct as Parameters<
        typeof sumRequisitionProductTotals
      >[0],
    );
    const finalTotalQuantity = productTotals.totalQuantity;
    const finalTotalTargetPrice = productTotals.minTotalPrice;
    const finalTotalMaxPrice = productTotals.maxTotalPrice;
    const hasValidProducts = finalTotalTargetPrice != null;

    const priceBounds = resolveRfqTotalPriceBoundsWithProducts(
      requisition,
      requisition.RequisitionProduct as Parameters<
        typeof resolveRfqTotalPriceBoundsWithProducts
      >[1],
    );

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

    if (
      requisition.minTotalPrice != null &&
      requisition.maxTotalPrice != null &&
      requisition.minTotalPrice > 0
    ) {
      source = "combined";
      confidence = Math.max(confidence, 0.95);
    }

    const minTotalPrice = priceBounds.minTotalPrice;
    const maxTotalPrice = priceBounds.maxTotalPrice;

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
        minTotalPrice,
        maxTotalPrice,
        totalQuantity: finalTotalQuantity,
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
  mode: "CONVERSATION";
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
    const dealMode = "CONVERSATION" as const;
    const offerIsComplete = accumulatedOffer.accumulation?.isComplete ?? false;
    const processingState: ProcessingState = {
      step: "analyzing_offer",
      estimatedMs: 4000,
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
 * Phase 2: Generate PM response asynchronously (P0.5 — unified pipeline).
 *
 * Legacy full implementation remains in convo/conversation-service.ts until P4.
 */
export const generatePMResponseAsyncService = async (
  input: GeneratePMResponseInput,
): Promise<PMResponseResult> => {
  const { runPmResponseViaPipeline } = await import(
    "./pipeline/pm-response-via-pipeline.js"
  );
  return runPmResponseViaPipeline(input);
};


/**
 * Generate PM response when the async call is retried (e.g. after client timeout).
 * Uses the same P0 pipeline as generatePMResponseAsyncService — no template fallback.
 */
export const generatePMFallbackResponseService = async (
  input: GeneratePMResponseInput,
): Promise<PMResponseResult> => {
  const { runPmResponseViaPipeline } = await import(
    "./pipeline/pm-response-via-pipeline.js"
  );
  const result = await runPmResponseViaPipeline(input);
  return {
    message: result.message,
    decision: result.decision,
    explainability: result.explainability,
    deal: result.deal,
    generationSource: "llm",
    meso: null,
  };
};

/**
 * Migrate legacy INSIGHTS deals to CONVERSATION mode.
 */
const ensureConversationMode = async (deal: ChatbotDeal): Promise<ChatbotDeal> => {
  if (deal.mode === "CONVERSATION") {
    return deal;
  }

  const previousMode = deal.mode;
  await deal.update({
    mode: "CONVERSATION",
    convoStateJson: deal.convoStateJson ?? { phase: "GREETING", history: [] },
  });

  logger.info(`Migrated deal ${deal.id} from ${previousMode} to CONVERSATION`);
  return deal;
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

    await ensureConversationMode(deal);

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
      convoStateJson: { phase: "GREETING", history: [] },
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

    const wizardMinTotal = readWizardMinTotalPrice(priceQuantity);
    const wizardMaxTotal = readWizardMaxTotalPrice(priceQuantity);

    // Extract products from requisition
    const products = ((requisition as any).RequisitionProduct || []).map(
      (rp: any) => ({
        name: rp.Product?.productName || "Unknown Product",
        quantity: rp.quantity || 1,
        minUnitPrice: rp.minUnitPrice ?? rp.targetPrice ?? wizardMinTotal ?? 0,
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
                targetPrice: wizardMinTotal || 0,
              },
            ],
      priceConfig: {
        minTotalPrice: wizardMinTotal || 0,
        maxTotalPrice: wizardMaxTotal || 0,
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
      minTotalPrice: number;
      maxTotalPrice: number;
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
      total_price: resolveEngineTotalPriceBlock(config.parameters),
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
          requisition.minTotalPrice ??
          (requisition as any).totalPrice ??
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
        requisition.minTotalPrice ??
        (requisition as any).totalPrice ??
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
            ((req.minTotalPrice as number) ??
            (req as any).totalPrice ??
            (req.totalEstimatedAmount as number)) ||
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
 * 1. wizardConfig.priceQuantity.minTotalPrice (canonical wizard deals)
 * 2. parameters.total_price.min_total_price (engine config format)
 * 3. Root level targetPrice/maxAcceptablePrice (legacy seeded deals — read-only)
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
  const unitPriceConfig = resolveEngineTotalPriceBlock(parameters) ?? {};

  // Also check for legacy root-level config (seeded deals)
  const rootConfig = configJson as Record<string, number> | null;

  // Extract minimum/maximum total price with dual-read fallback chain
  const minTotalPrice =
    readWizardMinTotalPrice(priceQuantity as Parameters<typeof readWizardMinTotalPrice>[0]) ??
    readEngineMinTotalPrice(unitPriceConfig, (rootConfig?.targetPrice as number) ?? 100);
  const maxTotalPrice =
    readWizardMaxTotalPrice(priceQuantity as Parameters<typeof readWizardMaxTotalPrice>[0]) ??
    readEngineMaxTotalPrice(
      unitPriceConfig,
      (rootConfig?.maxAcceptablePrice as number) ?? minTotalPrice * 1.2,
    );

  return {
    minTotalPrice,
    maxTotalPrice,
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
 * @deprecated Negotiation opens via vendor-chat bootstrap (WELCOME → vendor quote → COUNTER).
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
        total_price: pmStance.minTotalPrice,
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
        total_price: pmStance.minTotalPrice,
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
      targetPrice: pmStance.minTotalPrice,
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
    const pmTargetPrice = pmStance.minTotalPrice;
    const pmMaxPrice = pmStance.maxTotalPrice;

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
    const legacyConfig = deal.negotiationConfigJson as any;
    const resolvedConfig = resolveNegotiationConfig(
      wizardConfig,
      legacyConfig
        ? {
            total_price: resolveEngineTotalPriceBlock(legacyConfig.parameters),
            accept_threshold: legacyConfig.accept_threshold,
            escalate_threshold: legacyConfig.escalate_threshold,
            walkaway_threshold: legacyConfig.walkaway_threshold,
            max_rounds: legacyConfig.max_rounds,
            priority: legacyConfig.priority,
          }
        : undefined,
    );
    // Deal currency is stored on the negotiation config at deal creation (chatbot.service.ts ~L607)
    const dealCurrency = ((deal.negotiationConfigJson as any)?.currency ||
      "USD") as SupportedCurrency;

    // Generate MESO based on vendor's confirmed price
    const mesoResult = generateMesoFromVendorPrice(
      resolvedConfig,
      stalledPrice,
      deal.round + 1,
      dealCurrency,
      (deal.latestOfferJson as any)?.total_price ?? null,
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
    const priceAdjusted = stalledPrice > resolvedConfig.maxTotalPrice;
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
