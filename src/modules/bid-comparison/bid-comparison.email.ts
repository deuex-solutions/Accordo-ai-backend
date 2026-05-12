import { promises as fsp } from "fs";
import path from "path";
import { sendEmail } from "../../services/email.service.js";
import logger from "../../config/logger.js";
import env from "../../config/env.js";
import type { TopBidInfo, TriggerType } from "./bid-comparison.types.js";

interface SendComparisonEmailInput {
  recipientEmail: string;
  recipientName: string;
  requisitionId: number;
  requisitionTitle: string;
  projectName: string;
  rfqId: string;
  topBids: TopBidInfo[];
  totalVendors: number;
  completedVendors: number;
  triggeredBy: TriggerType;
  pdfPath: string;
}

interface SendVendorWonEmailInput {
  recipientEmail: string;
  vendorName: string;
  requisitionTitle: string;
  projectName: string;
  selectedPrice: number;
  chatSummary: string | null;
}

interface SendVendorLostEmailInput {
  recipientEmail: string;
  vendorName: string;
  requisitionTitle: string;
  projectName: string;
  bidPrice: number;
  winningPrice: number;
}

/**
 * Send comparison email to procurement owner with PDF attachment
 */
export async function sendComparisonEmail(
  input: SendComparisonEmailInput,
): Promise<void> {
  const {
    recipientEmail,
    recipientName,
    requisitionId,
    requisitionTitle,
    projectName,
    rfqId,
    topBids,
    totalVendors,
    completedVendors,
    triggeredBy,
    pdfPath,
  } = input;

  const portalLink = `${env.vendorPortalUrl?.replace("/vendor", "")}/requisitions/${requisitionId}/bids`;

  const triggerMessage =
    triggeredBy === "ALL_COMPLETED"
      ? "All vendors have completed their negotiations."
      : triggeredBy === "DEADLINE_REACHED"
        ? "The negotiation deadline has been reached."
        : "This report was manually generated.";

  const html = generateComparisonEmailHTML({
    recipientName,
    requisitionTitle,
    projectName,
    rfqId,
    topBids,
    totalVendors,
    completedVendors,
    triggerMessage,
    portalLink,
    requisitionId,
  });

  const plainText = generateComparisonEmailPlainText({
    recipientName,
    requisitionTitle,
    projectName,
    rfqId,
    topBids,
    totalVendors,
    completedVendors,
    triggerMessage,
    portalLink,
  });

  // Read PDF file for attachment
  let attachments: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }> = [];
  try {
    const pdfBuffer = await fsp.readFile(pdfPath);
    attachments = [
      {
        filename: `Bid_Comparison_${rfqId}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ];
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code !== "ENOENT") throw err;
    // PDF doesn't exist — send email without attachment
  }

  await sendEmail({
    to: recipientEmail,
    subject: `Bid Comparison Ready: ${requisitionTitle}`,
    html,
    text: plainText,
    attachments,
  });

  logger.info(
    `Sent comparison email to ${recipientEmail} for requisition ${requisitionId}`,
  );
}

/**
 * Send email to winning vendor
 */
export async function sendVendorWonEmail(
  input: SendVendorWonEmailInput,
): Promise<void> {
  const {
    recipientEmail,
    vendorName,
    requisitionTitle,
    projectName,
    selectedPrice,
    chatSummary,
  } = input;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); padding: 30px; border-radius: 10px 10px 0 0;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Congratulations!</h1>
        <p style="color: #ffffff; margin: 10px 0 0 0; opacity: 0.9;">Your bid has been selected</p>
      </div>

      <div style="background: #ffffff; padding: 30px; border: 1px solid #e9ecef; border-top: none; border-radius: 0 0 10px 10px;">
        <p>Dear ${vendorName},</p>

        <p>We are pleased to inform you that your bid has been <strong style="color: #28a745;">selected</strong> for the following requisition:</p>

        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Project:</strong> ${projectName}</p>
          <p style="margin: 5px 0;"><strong>Requisition:</strong> ${requisitionTitle}</p>
          <p style="margin: 5px 0;"><strong>Agreed Price:</strong> $${selectedPrice.toLocaleString()}</p>
        </div>

        ${
          chatSummary
            ? `
        <div style="background: #e8f5e9; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
          <p style="margin: 0 0 10px 0; font-weight: bold;">Negotiation Summary:</p>
          <p style="margin: 0; font-style: italic;">${chatSummary}</p>
        </div>
        `
            : ""
        }

        <p>A Purchase Order will be issued shortly. Please ensure you are prepared to fulfill the order according to the agreed terms.</p>

        <p>Thank you for your participation in the negotiation process. We look forward to working with you.</p>

        <p style="margin-top: 30px;">Best regards,<br><strong>The Procurement Team</strong></p>
      </div>

      <div style="text-align: center; padding: 20px; color: #6c757d; font-size: 12px;">
        <p>This is an automated message from Accordo AI</p>
      </div>
    </body>
    </html>
  `;

  const plainText = `
Congratulations, ${vendorName}!

Your bid has been SELECTED for the following requisition:

Project: ${projectName}
Requisition: ${requisitionTitle}
Agreed Price: $${selectedPrice.toLocaleString()}

${chatSummary ? `Negotiation Summary:\n${chatSummary}\n\n` : ""}
A Purchase Order will be issued shortly. Please ensure you are prepared to fulfill the order according to the agreed terms.

Thank you for your participation in the negotiation process. We look forward to working with you.

Best regards,
The Procurement Team
  `;

  await sendEmail({
    to: recipientEmail,
    subject: `Your Bid Has Been Selected: ${requisitionTitle}`,
    html,
    text: plainText,
  });

  logger.info(`Sent vendor won email to ${recipientEmail}`);
}

/**
 * Send email to non-winning vendors
 */
export async function sendVendorLostEmail(
  input: SendVendorLostEmailInput,
): Promise<void> {
  const {
    recipientEmail,
    vendorName,
    requisitionTitle,
    projectName,
    bidPrice,
    winningPrice,
  } = input;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #6c757d; padding: 30px; border-radius: 10px 10px 0 0;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Requisition Update</h1>
        <p style="color: #ffffff; margin: 10px 0 0 0; opacity: 0.9;">Vendor Selection Complete</p>
      </div>

      <div style="background: #ffffff; padding: 30px; border: 1px solid #e9ecef; border-top: none; border-radius: 0 0 10px 10px;">
        <p>Dear ${vendorName},</p>

        <p>Thank you for participating in the negotiation process for the following requisition:</p>

        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Project:</strong> ${projectName}</p>
          <p style="margin: 5px 0;"><strong>Requisition:</strong> ${requisitionTitle}</p>
          <p style="margin: 5px 0;"><strong>Your Bid:</strong> $${bidPrice.toLocaleString()}</p>
        </div>

        <p>After careful evaluation, we have selected another vendor for this opportunity. The winning bid was <strong>$${winningPrice.toLocaleString()}</strong>.</p>

        <p>We appreciate the time and effort you invested in this negotiation. We hope to work with you on future opportunities.</p>

        <p style="margin-top: 30px;">Best regards,<br><strong>The Procurement Team</strong></p>
      </div>

      <div style="text-align: center; padding: 20px; color: #6c757d; font-size: 12px;">
        <p>This is an automated message from Accordo AI</p>
      </div>
    </body>
    </html>
  `;

  const plainText = `
Dear ${vendorName},

Thank you for participating in the negotiation process for the following requisition:

Project: ${projectName}
Requisition: ${requisitionTitle}
Your Bid: $${bidPrice.toLocaleString()}

After careful evaluation, we have selected another vendor for this opportunity. The winning bid was $${winningPrice.toLocaleString()}.

We appreciate the time and effort you invested in this negotiation. We hope to work with you on future opportunities.

Best regards,
The Procurement Team
  `;

  await sendEmail({
    to: recipientEmail,
    subject: `Requisition Update: ${requisitionTitle}`,
    html,
    text: plainText,
  });

  logger.info(`Sent vendor lost email to ${recipientEmail}`);
}

/**
 * Generate comparison email HTML
 */
function generateComparisonEmailHTML(data: {
  recipientName: string;
  requisitionTitle: string;
  projectName: string;
  rfqId: string;
  topBids: TopBidInfo[];
  totalVendors: number;
  completedVendors: number;
  triggerMessage: string;
  portalLink: string;
  requisitionId: number;
}): string {
  const {
    recipientName,
    requisitionTitle,
    projectName,
    rfqId,
    topBids,
    totalVendors,
    completedVendors,
    triggerMessage,
    portalLink,
    requisitionId,
  } = data;

  const bidsRows = topBids
    .map(
      (bid) => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #e9ecef; text-align: center;">
        <span style="background: ${bid.rank === 1 ? "#28a745" : bid.rank === 2 ? "#17a2b8" : "#ffc107"}; color: #fff; padding: 4px 10px; border-radius: 12px; font-weight: bold;">#${bid.rank}</span>
      </td>
      <td style="padding: 12px; border-bottom: 1px solid #e9ecef;">${bid.vendorName}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e9ecef; font-weight: bold;">$${bid.finalPrice.toLocaleString()}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e9ecef;">${bid.paymentTerms || "N/A"}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e9ecef; text-align: center;">
        <a href="${portalLink}/select/${bid.bidId}" style="background: #0066cc; color: #fff; padding: 6px 12px; border-radius: 4px; text-decoration: none; font-size: 12px;">Select</a>
      </td>
    </tr>
  `,
    )
    .join("");

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 700px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #0066cc 0%, #17a2b8 100%); padding: 30px; border-radius: 10px 10px 0 0;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Bid Comparison Report</h1>
        <p style="color: #ffffff; margin: 10px 0 0 0; opacity: 0.9;">${triggerMessage}</p>
      </div>

      <div style="background: #ffffff; padding: 30px; border: 1px solid #e9ecef; border-top: none;">
        <p>Dear ${recipientName},</p>

        <p>The vendor negotiations for <strong>${requisitionTitle}</strong> are ready for your review.</p>

        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>Project:</strong> ${projectName}</p>
          <p style="margin: 5px 0;"><strong>RFQ ID:</strong> ${rfqId}</p>
          <p style="margin: 5px 0;"><strong>Vendors Invited:</strong> ${totalVendors}</p>
          <p style="margin: 5px 0;"><strong>Completed Negotiations:</strong> ${completedVendors}</p>
        </div>

        <h3 style="color: #0066cc; margin-top: 25px;">Top Bids</h3>

        <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
          <thead>
            <tr style="background: #f8f9fa;">
              <th style="padding: 12px; text-align: center; border-bottom: 2px solid #dee2e6;">Rank</th>
              <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Vendor</th>
              <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Price</th>
              <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Terms</th>
              <th style="padding: 12px; text-align: center; border-bottom: 2px solid #dee2e6;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${bidsRows}
          </tbody>
        </table>

        <div style="margin-top: 25px; text-align: center;">
          <a href="${portalLink}" style="display: inline-block; background: #0066cc; color: #ffffff; padding: 12px 30px; border-radius: 6px; text-decoration: none; font-weight: bold;">View Full Report in Portal</a>
        </div>

        <p style="margin-top: 25px; color: #6c757d; font-size: 14px;">
          A detailed PDF report is attached to this email. You can also select a vendor directly using the buttons above or from the portal.
        </p>
      </div>

      <div style="text-align: center; padding: 20px; color: #6c757d; font-size: 12px; border: 1px solid #e9ecef; border-top: none; border-radius: 0 0 10px 10px;">
        <p>This is an automated message from Accordo AI</p>
      </div>
    </body>
    </html>
  `;
}

/**
 * Generate comparison email plain text
 */
function generateComparisonEmailPlainText(data: {
  recipientName: string;
  requisitionTitle: string;
  projectName: string;
  rfqId: string;
  topBids: TopBidInfo[];
  totalVendors: number;
  completedVendors: number;
  triggerMessage: string;
  portalLink: string;
}): string {
  const {
    recipientName,
    requisitionTitle,
    projectName,
    rfqId,
    topBids,
    totalVendors,
    completedVendors,
    triggerMessage,
    portalLink,
  } = data;

  const bidsList = topBids
    .map(
      (bid) =>
        `#${bid.rank} - ${bid.vendorName}: $${bid.finalPrice.toLocaleString()} (${bid.paymentTerms || "N/A"})`,
    )
    .join("\n");

  return `
BID COMPARISON REPORT

${triggerMessage}

Dear ${recipientName},

The vendor negotiations for "${requisitionTitle}" are ready for your review.

Project: ${projectName}
RFQ ID: ${rfqId}
Vendors Invited: ${totalVendors}
Completed Negotiations: ${completedVendors}

TOP BIDS:
${bidsList}

View the full report: ${portalLink}

A detailed PDF report is attached to this email.

This is an automated message from Accordo AI.
  `;
}
