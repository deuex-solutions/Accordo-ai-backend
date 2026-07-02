/**
 * Context Service - Manages negotiation and requisition context
 */

import models from '../models/index.js';
import logger from '../config/logger.js';

interface NegotiationContext {
  requisitionId?: number;
  vendorId?: number;
  negotiationId?: string;
  preferences?: UserPreferences;
  history?: NegotiationRoundData[];
}

interface UserPreferences {
  batna?: number;
  maxDiscount?: number;
  maxPrice?: number;
  priceWeight?: number;
  deliveryWeight?: number;
}

interface NegotiationRoundData {
  roundNumber: number;
  offerDetails: Record<string, unknown>;
  feedback?: Record<string, unknown>;
  createdAt: Date;
}

interface RequisitionContext {
  id: number;
  rfqId: string;
  subject: string;
  category: string;
  deliveryDate?: Date;
  minTotalPrice?: number;
  products?: unknown[];
}

/**
 * Get negotiation context
 */
export async function getNegotiationContext(negotiationId: string): Promise<NegotiationContext> {
  try {
    const negotiation = await models.Negotiation.findByPk(negotiationId, {
      include: [
        {
          model: models.NegotiationRound,
          as: 'Rounds',
          order: [['roundNumber', 'ASC']],
        },
      ],
    });

    if (!negotiation) {
      throw new Error('Negotiation not found');
    }

    const context: NegotiationContext = {
      negotiationId: negotiationId,
      requisitionId: negotiation.rfqId ? Number(negotiation.rfqId) : undefined,
      vendorId: negotiation.vendorId ? Number(negotiation.vendorId) : undefined,
      history: [],
    };

    return context;
  } catch (error) {
    logger.error('Failed to get negotiation context:', error);
    throw error;
  }
}

/**
 * Get requisition context
 */
export async function getRequisitionContext(requisitionId: number): Promise<RequisitionContext> {
  try {
    const requisition = await models.Requisition.findByPk(requisitionId, {
      include: [
        {
          model: models.RequisitionProduct,
          as: 'RequisitionProduct',
          include: [
            {
              model: models.Product,
              as: 'Product',
            },
          ],
        },
      ],
    });

    if (!requisition) {
      throw new Error('Requisition not found');
    }

    return {
      id: requisition.id,
      rfqId: requisition.rfqId || '',
      subject: requisition.subject || '',
      category: requisition.category || '',
      deliveryDate: requisition.deliveryDate || undefined,
      minTotalPrice: requisition.minTotalPrice || undefined,
    };
  } catch (error) {
    logger.error('Failed to get requisition context:', error);
    throw error;
  }
}

/**
 * Get user preferences
 */
export async function getUserPreferences(userId: number): Promise<UserPreferences> {
  try {
    const preference = await models.Preference.findOne({
      where: {
        entityId: userId,
        entityType: 'User',
      },
    });

    if (!preference) {
      return {};
    }

    return {
      batna: preference.constraints?.batna as number | undefined,
      maxDiscount: preference.constraints?.maxDiscount as number | undefined,
      maxPrice: preference.constraints?.maxPrice,
      priceWeight: preference.weights?.price,
      deliveryWeight: preference.weights?.delivery,
    };
  } catch (error) {
    logger.error('Failed to get user preferences:', error);
    return {};
  }
}

/**
 * Build context string for LLM
 */
export function buildContextString(context: NegotiationContext | RequisitionContext): string {
  const parts: string[] = [];

  if ('negotiationId' in context) {
    parts.push(`Negotiation ID: ${context.negotiationId}`);
    if (context.requisitionId) {
      parts.push(`Requisition ID: ${context.requisitionId}`);
    }
    if (context.vendorId) {
      parts.push(`Vendor ID: ${context.vendorId}`);
    }
    if (context.preferences) {
      parts.push(`Preferences: ${JSON.stringify(context.preferences)}`);
    }
  } else {
    const reqContext = context as RequisitionContext;
    parts.push(`Requisition ID: ${reqContext.id}`);
    parts.push(`RFQ ID: ${reqContext.rfqId}`);
    parts.push(`Subject: ${reqContext.subject}`);
    if (reqContext.category) {
      parts.push(`Category: ${reqContext.category}`);
    }
    if (reqContext.minTotalPrice) {
      parts.push(`Total Price: ${reqContext.minTotalPrice}`);
    }
  }

  return parts.join('\n');
}

export default {
  getNegotiationContext,
  getRequisitionContext,
  getUserPreferences,
  buildContextString,
};
