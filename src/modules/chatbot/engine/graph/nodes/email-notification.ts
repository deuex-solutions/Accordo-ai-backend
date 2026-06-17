import { NegotiationState } from "../state.js";
import { NodeName } from "../types.js";
import models from "../../../../../models/index.js";
import { sendVendorAttachedEmail, sendStatusChangeEmail } from "../../../../../services/email.service.js";
import logger from "../../../../../config/logger.js";

/**
 * EmailNotificationNode (Track 3: Adarsh)
 * 
 * Responsibilities:
 * - Listens to state changes and triggers corresponding email notifications.
 * - Prevents double-sending by tracking sent emails in `metadata.sentEmails`.
 * 
 * @source src/services/email.service.ts
 */
export const emailNotificationNode = async (state: NegotiationState) => {
  logger.info(`[Node: email_notification] Evaluating email notification triggers...`);

  const dealId = state.dealId;
  if (!dealId) {
    logger.warn(`[Node: email_notification] No dealId present in state. Skipping.`);
    return {};
  }

  // Load the ChatbotDeal with associated models to get email details
  const deal = await models.ChatbotDeal.findByPk(dealId, {
    include: [
      {
        model: models.Contract,
        as: "Contract",
        include: [{ model: models.User, as: "Vendor" }],
      },
      {
        model: models.Requisition,
        as: "Requisition",
        include: [
          { model: models.Project, as: "Project" },
          { model: models.RequisitionProduct, as: "RequisitionProduct", include: [{ model: models.Product, as: "Product" }] }
        ],
      },
    ],
  });

  if (!deal) {
    logger.error(`[Node: email_notification] ChatbotDeal with ID ${dealId} not found.`);
    return {};
  }

  const contract = deal.Contract;
  const requisition = deal.Requisition;

  if (!contract || !requisition) {
    logger.warn(`[Node: email_notification] Contract or Requisition missing for deal ${dealId}. Skipping.`);
    return {};
  }

  const sentEmails = state.metadata?.sentEmails || [];
  const updatedSentEmails = [...sentEmails];

  // 1. Welcome / Vendor Attached Email (triggered on round 1, once)
  if (state.round === 1 && !sentEmails.includes("vendor_attached")) {
    try {
      logger.info(`[Node: email_notification] Sending Vendor Attached Welcome Email for deal ${dealId}...`);
      
      // Transform requisition structure for legacy email service mapping
      const requisitionJson = requisition.toJSON() as any;
      const reqWithProducts = {
        ...requisitionJson,
        title: requisitionJson.subject,
        Products: requisitionJson.RequisitionProduct?.map((rp: any) => ({
          name: rp.Product?.productName || "Unknown Product",
          quantity: rp.qty || 0,
          targetPrice: rp.targetPrice || 0,
        })) || [],
      };

      await sendVendorAttachedEmail(contract as any, reqWithProducts as any, dealId);
      updatedSentEmails.push("vendor_attached");
    } catch (err) {
      logger.error(`[Node: email_notification] Failed to send vendor attached email`, err);
    }
  }

  // 2. Status Change Email
  const oldStatus = deal.status || "NEGOTIATING";
  const newStatus = state.metadata?.dealStatus || oldStatus;

  if (newStatus !== oldStatus && !sentEmails.includes(`status_change_${newStatus}`)) {
    try {
      logger.info(`[Node: email_notification] Sending Status Change Email: ${oldStatus} -> ${newStatus} for deal ${dealId}...`);
      await sendStatusChangeEmail(contract as any, requisition as any, oldStatus, newStatus);
      updatedSentEmails.push(`status_change_${newStatus}`);
    } catch (err) {
      logger.error(`[Node: email_notification] Failed to send status change email`, err);
    }
  }

  return {
    metadata: {
      ...state.metadata,
      sentEmails: updatedSentEmails,
    },
  };
};
