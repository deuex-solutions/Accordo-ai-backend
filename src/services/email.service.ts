import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import env from '../config/env.js';
import logger from '../config/logger.js';
import models from '../models/index.js';
import type { Contract } from '../models/contract.js';
import type { Requisition } from '../models/requisition.js';
import type { VendorCompany } from '../models/vendorCompany.js';
import type { Product } from '../models/product.js';
import type { EmailType, EmailStatus, EmailMetadata } from '../models/emailLog.js';
import { formatCurrency, type SupportedCurrency } from './currency.service.js';

const { smtp } = env;

// Approval level display label mapping
const APPROVAL_LEVEL_LABELS: Record<string, string> = {
  'L1': 'Procurement Manager',
  'L2': 'HOD',
  'L3': 'CFO',
  'NONE': 'None',
};

/**
 * Convert approval level code to display label
 * @param level - Approval level code (L1, L2, L3, NONE)
 * @returns Display label (Procurement Manager, HOD, CFO, None)
 */
const getApprovalLevelLabel = (level: string): string => {
  return APPROVAL_LEVEL_LABELS[level] || level;
};

// Log the email service initialization
logger.info('Email service initialized with AWS SES', {
  smtpHost: smtp.host || 'not configured',
  smtpPort: smtp.port,
  smtpUser: smtp.user ? '***configured***' : 'not configured',
});

/**
 * Build nodemailer transporter for AWS SES
 */
const buildNodemailerTransporter = (): Transporter => {
  if (!smtp.host || !smtp.user) {
    throw new Error('AWS SES SMTP configuration missing. Please configure SMTP_HOST, SMTP_USER, and SMTP_PASS in .env');
  }
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port || 587,
    secure: smtp.port === 465, // true for 465, false for other ports
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
  });
};

/**
 * Generate HTML email template for vendor attached
 */
const generateVendorAttachedEmailHTML = (
  vendorName: string,
  requisitionData: {
    title: string;
    projectName: string;
    dueDate?: Date;
    products: Array<{ name: string; quantity: number; targetPrice: number }>;
  },
  portalLink: string,
  chatbotLink?: string
): string => {
  const productsHTML = requisitionData.products
    .map(
      (p) => `
    <tr>
      <td style="padding: 8px; border: 1px solid #ddd;">${p.name}</td>
      <td style="padding: 8px; border: 1px solid #ddd;">${p.quantity}</td>
      <td style="padding: 8px; border: 1px solid #ddd;">$${p.targetPrice.toFixed(2)}</td>
    </tr>
  `
    )
    .join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>New Requisition Assignment</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px;">
        <h1 style="color: #0066cc; margin-top: 0;">New Requisition Assignment</h1>
        <p>Dear ${vendorName},</p>
        <p>You have been assigned to a new requisition:</p>

        <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h2 style="color: #333; margin-top: 0;">Requisition Details</h2>
          <p><strong>Project:</strong> ${requisitionData.projectName}</p>
          <p><strong>Title:</strong> ${requisitionData.title}</p>
          ${requisitionData.dueDate ? `<p><strong>Due Date:</strong> ${requisitionData.dueDate.toLocaleDateString()}</p>` : ''}

          <h3 style="color: #333; margin-top: 20px;">Products Required</h3>
          <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
            <thead>
              <tr style="background-color: #f8f9fa;">
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Product</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Quantity</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Target Price</th>
              </tr>
            </thead>
            <tbody>
              ${productsHTML}
            </tbody>
          </table>
        </div>

        <div style="margin: 30px 0;">
          <a href="${portalLink}" style="display: inline-block; background-color: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">View in Vendor Portal</a>
          ${chatbotLink ? `<a href="${chatbotLink}" style="display: inline-block; background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; margin-left: 10px;">Start Negotiation</a>` : ''}
        </div>

        <p style="color: #666; font-size: 14px; margin-top: 30px;">
          Please review the requisition and respond at your earliest convenience.
        </p>
      </div>
    </body>
    </html>
  `;
};

/**
 * Generate plain text email for vendor attached
 */
const generateVendorAttachedEmailText = (
  vendorName: string,
  requisitionData: {
    title: string;
    projectName: string;
    dueDate?: Date;
    products: Array<{ name: string; quantity: number; targetPrice: number }>;
  },
  portalLink: string,
  chatbotLink?: string
): string => {
  const productsText = requisitionData.products
    .map((p) => `  - ${p.name}: Qty ${p.quantity}, Target Price $${p.targetPrice.toFixed(2)}`)
    .join('\n');

  return `
New Requisition Assignment

Dear ${vendorName},

You have been assigned to a new requisition:

Requisition Details:
- Project: ${requisitionData.projectName}
- Title: ${requisitionData.title}
${requisitionData.dueDate ? `- Due Date: ${requisitionData.dueDate.toLocaleDateString()}` : ''}

Products Required:
${productsText}

View in Vendor Portal: ${portalLink}
${chatbotLink ? `Start Negotiation: ${chatbotLink}` : ''}

Please review the requisition and respond at your earliest convenience.
  `;
};

/**
 * Generate status change email HTML
 */
const generateStatusChangeEmailHTML = (
  vendorName: string,
  requisitionTitle: string,
  oldStatus: string,
  newStatus: string,
  portalLink: string
): string => {
  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      Created: '#6c757d',
      Opened: '#0066cc',
      Accepted: '#28a745',
      Rejected: '#dc3545',
      Expired: '#ffc107',
      Completed: '#17a2b8',
      Verified: '#20c997',
    };
    const color = colors[status] || '#6c757d';
    return `<span style="display: inline-block; padding: 4px 12px; background-color: ${color}; color: white; border-radius: 3px; font-size: 12px; font-weight: bold;">${status}</span>`;
  };

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Contract Status Update</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px;">
        <h1 style="color: #0066cc; margin-top: 0;">Contract Status Update</h1>
        <p>Dear ${vendorName},</p>
        <p>The status of your contract has been updated.</p>

        <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p><strong>Requisition:</strong> ${requisitionTitle}</p>
          <p><strong>Status Change:</strong></p>
          <div style="margin: 15px 0;">
            ${statusBadge(oldStatus)}
            <span style="margin: 0 10px;">→</span>
            ${statusBadge(newStatus)}
          </div>
        </div>

        <div style="margin: 30px 0;">
          <a href="${portalLink}" style="display: inline-block; background-color: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">View in Vendor Portal</a>
        </div>

        <p style="color: #666; font-size: 14px; margin-top: 30px;">
          Thank you for your continued partnership.
        </p>
      </div>
    </body>
    </html>
  `;
};

/**
 * Generate status change email plain text
 */
const generateStatusChangeEmailText = (
  vendorName: string,
  requisitionTitle: string,
  oldStatus: string,
  newStatus: string,
  portalLink: string
): string => {
  return `
Contract Status Update

Dear ${vendorName},

The status of your contract has been updated.

Requisition: ${requisitionTitle}
Status Change: ${oldStatus} → ${newStatus}

View in Vendor Portal: ${portalLink}

Thank you for your continued partnership.
  `;
};

/**
 * Unified email options interface
 */
interface EmailAttachment {
  filename: string;
  content?: Buffer;
  path?: string;
  contentType?: string;
}

interface EmailOptions {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
}

/**
 * Send email using AWS SES (nodemailer) - internal function
 */
const sendEmailInternal = async (mailOptions: EmailOptions): Promise<{ messageId: string }> => {
  const transporter = buildNodemailerTransporter();
  const info = await transporter.sendMail(mailOptions);
  return { messageId: info.messageId };
};

/**
 * Send email with retry logic using AWS SES
 */
const sendEmailWithRetry = async (
  mailOptions: EmailOptions,
  maxRetries = 3
): Promise<{ messageId: string }> => {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const info = await sendEmailInternal(mailOptions);

      logger.info('Email sent successfully via AWS SES', {
        to: mailOptions.to,
        subject: mailOptions.subject,
        messageId: info.messageId,
        attempt,
      });
      return info;
    } catch (error) {
      lastError = error as Error;
      logger.warn(`Email send attempt ${attempt} failed`, {
        to: mailOptions.to,
        subject: mailOptions.subject,
        error: (error as Error).message,
      });
      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s
        await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
      }
    }
  }

  throw lastError;
};

/**
 * Log email to database
 */
const logEmail = async (
  recipientEmail: string,
  recipientId: number | null,
  subject: string,
  emailType: EmailType,
  status: EmailStatus,
  contractId?: number,
  requisitionId?: number,
  metadata?: EmailMetadata,
  errorMessage?: string,
  messageId?: string,
  retryCount = 0
): Promise<void> => {
  try {
    await models.EmailLog.create({
      recipientEmail,
      recipientId,
      subject,
      emailType,
      status,
      contractId,
      requisitionId,
      metadata,
      errorMessage,
      messageId,
      retryCount,
    });
  } catch (error) {
    logger.error('Failed to log email', { error: (error as Error).message });
  }
};

/**
 * Send vendor attached email
 * Note: Requires Contract to be loaded with vendor User association
 */
export const sendVendorAttachedEmail = async (
  contract: Contract & { Vendor?: any },
  requisition: Requisition & { Project?: any; Products?: any[] },
  chatbotDealId?: string
): Promise<void> => {
  try {
    const vendor = contract.Vendor;
    if (!vendor || !vendor.email) {
      throw new Error('Vendor email not available');
    }

    const vendorName = vendor.name || 'Vendor';
    const requisitionData = {
      title: (requisition as any).title || 'Untitled Requisition',
      projectName: requisition.Project?.name || 'Unknown Project',
      dueDate: (requisition as any).dueDate || undefined,
      products: (requisition.Products || []).map((p: any) => ({
        name: p.name || 'Unknown Product',
        quantity: p.quantity || 0,
        targetPrice: p.targetPrice || 0,
      })),
    };

    const portalLink = `${env.vendorPortalUrl}/contracts/${contract.uniqueToken}`;
    // Build hierarchical chatbot URL: /chatbot/requisitions/{rfqId}/vendors/{vendorId}/deals/{dealId}
    const chatbotLink = chatbotDealId && contract.vendorId && (requisition as any).id
      ? `${env.chatbotFrontendUrl}/chatbot/requisitions/${(requisition as any).id}/vendors/${contract.vendorId}/deals/${chatbotDealId}`
      : undefined;

    const mailOptions: EmailOptions = {
      from: smtp.from || 'noreply@accordo.ai',
      to: vendor.email,
      subject: `New Requisition Assignment: ${requisitionData.title}`,
      html: generateVendorAttachedEmailHTML(vendorName, requisitionData, portalLink, chatbotLink),
      text: generateVendorAttachedEmailText(vendorName, requisitionData, portalLink, chatbotLink),
    };

    const info = await sendEmailWithRetry(mailOptions);

    await logEmail(
      vendor.email,
      contract.vendorId || null,
      mailOptions.subject,
      'vendor_attached',
      'sent',
      contract.id,
      (requisition as any).id,
      {
        projectName: requisitionData.projectName,
        requisitionTitle: requisitionData.title,
        chatbotDealId,
      },
      undefined,
      info.messageId,
      0
    );
  } catch (error) {
    logger.error('Failed to send vendor attached email', {
      contractId: contract.id,
      vendorEmail: contract.Vendor?.email,
      error: (error as Error).message,
    });

    await logEmail(
      contract.Vendor?.email || 'unknown',
      contract.vendorId || null,
      `New Requisition Assignment: ${(requisition as any).title}`,
      'vendor_attached',
      'failed',
      contract.id,
      (requisition as any).id,
      {
        projectName: (requisition as any).Project?.name,
        requisitionTitle: (requisition as any).title,
      },
      (error as Error).message,
      undefined,
      2
    );

    throw error;
  }
};

/**
 * Send status change email
 * Note: Requires Contract to be loaded with vendor User association
 */
export const sendStatusChangeEmail = async (
  contract: Contract & { Vendor?: any },
  requisition: Requisition,
  oldStatus: string,
  newStatus: string
): Promise<void> => {
  try {
    const vendor = contract.Vendor;
    if (!vendor || !vendor.email) {
      throw new Error('Vendor email not available');
    }

    const vendorName = vendor.name || 'Vendor';
    const requisitionTitle = (requisition as any).title || 'Untitled Requisition';
    const portalLink = `${env.vendorPortalUrl}/contracts/${contract.uniqueToken}`;

    const mailOptions: EmailOptions = {
      from: smtp.from || 'noreply@accordo.ai',
      to: vendor.email,
      subject: `Contract Status Update: ${requisitionTitle}`,
      html: generateStatusChangeEmailHTML(vendorName, requisitionTitle, oldStatus, newStatus, portalLink),
      text: generateStatusChangeEmailText(vendorName, requisitionTitle, oldStatus, newStatus, portalLink),
    };

    const info = await sendEmailWithRetry(mailOptions);

    await logEmail(
      vendor.email,
      contract.vendorId || null,
      mailOptions.subject,
      'status_change',
      'sent',
      contract.id,
      (requisition as any).id,
      {
        oldStatus,
        newStatus,
        requisitionTitle,
      },
      undefined,
      info.messageId,
      0
    );
  } catch (error) {
    logger.error('Failed to send status change email', {
      contractId: contract.id,
      vendorEmail: contract.Vendor?.email,
      error: (error as Error).message,
    });

    await logEmail(
      contract.Vendor?.email || 'unknown',
      contract.vendorId || null,
      `Contract Status Update: ${(requisition as any).title}`,
      'status_change',
      'failed',
      contract.id,
      (requisition as any).id,
      {
        oldStatus,
        newStatus,
        requisitionTitle: (requisition as any).title,
      },
      (error as Error).message,
      undefined,
      2
    );

    throw error;
  }
};

/**
 * Email input options for object-based signature
 */
interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
}

/**
 * Generic send email function - exported for use by other modules
 * Supports both positional arguments and object-based input
 */
export async function sendEmail(options: SendEmailInput): Promise<{ messageId: string }>;
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text?: string,
  attachments?: EmailAttachment[]
): Promise<{ messageId: string }>;
export async function sendEmail(
  toOrOptions: string | SendEmailInput,
  subject?: string,
  html?: string,
  text?: string,
  attachments?: EmailAttachment[]
): Promise<{ messageId: string }> {
  let mailOptions: EmailOptions;

  if (typeof toOrOptions === 'object') {
    // Object-based signature
    mailOptions = {
      from: smtp.from || 'noreply@accordo.ai',
      to: toOrOptions.to,
      subject: toOrOptions.subject,
      html: toOrOptions.html,
      text: toOrOptions.text || '',
      attachments: toOrOptions.attachments,
    };
  } else {
    // Positional arguments signature
    mailOptions = {
      from: smtp.from || 'noreply@accordo.ai',
      to: toOrOptions,
      subject: subject!,
      html: html!,
      text: text || '',
      attachments,
    };
  }

  return sendEmailWithRetry(mailOptions);
}

/**
 * Log email to database - exported for use by other modules
 */
export { logEmail };

// ==========================================
// APPROVAL EMAIL TEMPLATES AND FUNCTIONS
// ==========================================

/**
 * Generate approval pending email HTML
 */
const generateApprovalPendingEmailHTML = (
  approverName: string,
  requisitionData: {
    title: string;
    projectName: string;
    submittedBy: string;
    amount: number;
    approvalLevel: string;
    dueDate?: Date;
    priority: string;
  },
  approvalLink: string
): string => {
  const priorityColors: Record<string, string> = {
    LOW: '#6c757d',
    MEDIUM: '#0066cc',
    HIGH: '#ffc107',
    URGENT: '#dc3545',
  };
  const priorityColor = priorityColors[requisitionData.priority] || '#6c757d';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Approval Required</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px;">
        <h1 style="color: #0066cc; margin-top: 0;">Approval Required - ${getApprovalLevelLabel(requisitionData.approvalLevel)}</h1>
        <p>Dear ${approverName},</p>
        <p>A requisition requires your approval:</p>

        <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h2 style="color: #333; margin-top: 0;">Requisition Details</h2>
          <p><strong>Title:</strong> ${requisitionData.title}</p>
          <p><strong>Project:</strong> ${requisitionData.projectName}</p>
          <p><strong>Submitted By:</strong> ${requisitionData.submittedBy}</p>
          <p><strong>Amount:</strong> $${requisitionData.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          <p><strong>Approval Level:</strong> <span style="background-color: #0066cc; color: white; padding: 2px 8px; border-radius: 3px;">${getApprovalLevelLabel(requisitionData.approvalLevel)}</span></p>
          <p><strong>Priority:</strong> <span style="background-color: ${priorityColor}; color: white; padding: 2px 8px; border-radius: 3px;">${requisitionData.priority}</span></p>
          ${requisitionData.dueDate ? `<p><strong>Due Date:</strong> ${requisitionData.dueDate.toLocaleDateString()}</p>` : ''}
        </div>

        <div style="margin: 30px 0; text-align: center;">
          <a href="${approvalLink}" style="display: inline-block; background-color: #28a745; color: white; padding: 14px 32px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">Review & Approve</a>
        </div>

        <p style="color: #666; font-size: 14px; margin-top: 30px;">
          Please review the requisition and take action at your earliest convenience.
        </p>
      </div>
    </body>
    </html>
  `;
};

/**
 * Generate approval pending email plain text
 */
const generateApprovalPendingEmailText = (
  approverName: string,
  requisitionData: {
    title: string;
    projectName: string;
    submittedBy: string;
    amount: number;
    approvalLevel: string;
    dueDate?: Date;
    priority: string;
  },
  approvalLink: string
): string => {
  return `
Approval Required - ${getApprovalLevelLabel(requisitionData.approvalLevel)}

Dear ${approverName},

A requisition requires your approval:

Requisition Details:
- Title: ${requisitionData.title}
- Project: ${requisitionData.projectName}
- Submitted By: ${requisitionData.submittedBy}
- Amount: $${requisitionData.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
- Approval Level: ${getApprovalLevelLabel(requisitionData.approvalLevel)}
- Priority: ${requisitionData.priority}
${requisitionData.dueDate ? `- Due Date: ${requisitionData.dueDate.toLocaleDateString()}` : ''}

Review & Approve: ${approvalLink}

Please review the requisition and take action at your earliest convenience.
  `;
};

/**
 * Generate approval approved email HTML
 */
const generateApprovalApprovedEmailHTML = (
  recipientName: string,
  requisitionData: {
    title: string;
    projectName: string;
    amount: number;
    approvalLevel: string;
    approvedBy: string;
    nextLevel?: string;
  },
  portalLink: string
): string => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Requisition Approved</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px;">
        <h1 style="color: #28a745; margin-top: 0;">Requisition Approved - ${getApprovalLevelLabel(requisitionData.approvalLevel)}</h1>
        <p>Dear ${recipientName},</p>
        <p>Good news! A requisition has been approved.</p>

        <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h2 style="color: #333; margin-top: 0;">Approval Details</h2>
          <p><strong>Title:</strong> ${requisitionData.title}</p>
          <p><strong>Project:</strong> ${requisitionData.projectName}</p>
          <p><strong>Amount:</strong> $${requisitionData.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          <p><strong>Approved By:</strong> ${requisitionData.approvedBy}</p>
          <p><strong>Approval Level:</strong> <span style="background-color: #28a745; color: white; padding: 2px 8px; border-radius: 3px;">${getApprovalLevelLabel(requisitionData.approvalLevel)} APPROVED</span></p>
          ${requisitionData.nextLevel ? `<p><strong>Next Step:</strong> Pending ${getApprovalLevelLabel(requisitionData.nextLevel)} Approval</p>` : '<p><strong>Status:</strong> <span style="background-color: #28a745; color: white; padding: 2px 8px; border-radius: 3px;">FULLY APPROVED</span></p>'}
        </div>

        <div style="margin: 30px 0;">
          <a href="${portalLink}" style="display: inline-block; background-color: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">View Requisition</a>
        </div>
      </div>
    </body>
    </html>
  `;
};

/**
 * Generate approval approved email plain text
 */
const generateApprovalApprovedEmailText = (
  recipientName: string,
  requisitionData: {
    title: string;
    projectName: string;
    amount: number;
    approvalLevel: string;
    approvedBy: string;
    nextLevel?: string;
  },
  portalLink: string
): string => {
  return `
Requisition Approved - ${getApprovalLevelLabel(requisitionData.approvalLevel)}

Dear ${recipientName},

Good news! A requisition has been approved.

Approval Details:
- Title: ${requisitionData.title}
- Project: ${requisitionData.projectName}
- Amount: $${requisitionData.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
- Approved By: ${requisitionData.approvedBy}
- Approval Level: ${getApprovalLevelLabel(requisitionData.approvalLevel)} APPROVED
${requisitionData.nextLevel ? `- Next Step: Pending ${getApprovalLevelLabel(requisitionData.nextLevel)} Approval` : '- Status: FULLY APPROVED'}

View Requisition: ${portalLink}
  `;
};

/**
 * Generate approval rejected email HTML
 */
const generateApprovalRejectedEmailHTML = (
  recipientName: string,
  requisitionData: {
    title: string;
    projectName: string;
    amount: number;
    approvalLevel: string;
    rejectedBy: string;
    reason: string;
  },
  portalLink: string
): string => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Requisition Rejected</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px;">
        <h1 style="color: #dc3545; margin-top: 0;">Requisition Rejected</h1>
        <p>Dear ${recipientName},</p>
        <p>Unfortunately, a requisition has been rejected.</p>

        <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h2 style="color: #333; margin-top: 0;">Rejection Details</h2>
          <p><strong>Title:</strong> ${requisitionData.title}</p>
          <p><strong>Project:</strong> ${requisitionData.projectName}</p>
          <p><strong>Amount:</strong> $${requisitionData.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          <p><strong>Rejected By:</strong> ${requisitionData.rejectedBy}</p>
          <p><strong>Approval Level:</strong> <span style="background-color: #dc3545; color: white; padding: 2px 8px; border-radius: 3px;">${getApprovalLevelLabel(requisitionData.approvalLevel)} REJECTED</span></p>

          <div style="background-color: #f8d7da; border: 1px solid #f5c6cb; border-radius: 5px; padding: 15px; margin-top: 15px;">
            <h3 style="color: #721c24; margin-top: 0;">Rejection Reason:</h3>
            <p style="color: #721c24; margin-bottom: 0;">${requisitionData.reason}</p>
          </div>
        </div>

        <div style="margin: 30px 0;">
          <a href="${portalLink}" style="display: inline-block; background-color: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">View Requisition</a>
        </div>

        <p style="color: #666; font-size: 14px; margin-top: 30px;">
          You may revise and resubmit the requisition after addressing the concerns mentioned above.
        </p>
      </div>
    </body>
    </html>
  `;
};

/**
 * Generate approval rejected email plain text
 */
const generateApprovalRejectedEmailText = (
  recipientName: string,
  requisitionData: {
    title: string;
    projectName: string;
    amount: number;
    approvalLevel: string;
    rejectedBy: string;
    reason: string;
  },
  portalLink: string
): string => {
  return `
Requisition Rejected

Dear ${recipientName},

Unfortunately, a requisition has been rejected.

Rejection Details:
- Title: ${requisitionData.title}
- Project: ${requisitionData.projectName}
- Amount: $${requisitionData.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
- Rejected By: ${requisitionData.rejectedBy}
- Approval Level: ${getApprovalLevelLabel(requisitionData.approvalLevel)} REJECTED

Rejection Reason:
${requisitionData.reason}

View Requisition: ${portalLink}

You may revise and resubmit the requisition after addressing the concerns mentioned above.
  `;
};

/**
 * Send approval pending email to approver
 */
export const sendApprovalPendingEmail = async (
  approverEmail: string,
  approverName: string,
  approverId: number,
  requisitionData: {
    id: number;
    title: string;
    projectName: string;
    submittedBy: string;
    amount: number;
    approvalLevel: string;
    dueDate?: Date;
    priority: string;
  },
  approvalId: string
): Promise<void> => {
  try {
    const approvalLink = `${env.vendorPortalUrl}/approvals/${approvalId}`;

    const mailOptions: EmailOptions = {
      from: smtp.from || 'noreply@accordo.ai',
      to: approverEmail,
      subject: `[${requisitionData.priority}] Approval Required: ${requisitionData.title}`,
      html: generateApprovalPendingEmailHTML(approverName, requisitionData, approvalLink),
      text: generateApprovalPendingEmailText(approverName, requisitionData, approvalLink),
    };

    const info = await sendEmailWithRetry(mailOptions);

    await logEmail(
      approverEmail,
      approverId,
      mailOptions.subject,
      'other', // Using 'other' for approval emails
      'sent',
      undefined,
      requisitionData.id,
      {
        emailSubType: 'approval_pending',
        approvalLevel: requisitionData.approvalLevel,
        approvalId,
        amount: requisitionData.amount,
        priority: requisitionData.priority,
      },
      undefined,
      info.messageId,
      0
    );
  } catch (error) {
    logger.error('Failed to send approval pending email', {
      approverEmail,
      requisitionId: requisitionData.id,
      error: (error as Error).message,
    });
    throw error;
  }
};

/**
 * Send approval approved email
 */
export const sendApprovalApprovedEmail = async (
  recipientEmail: string,
  recipientName: string,
  recipientId: number,
  requisitionData: {
    id: number;
    title: string;
    projectName: string;
    amount: number;
    approvalLevel: string;
    approvedBy: string;
    nextLevel?: string;
  }
): Promise<void> => {
  try {
    const portalLink = `${env.vendorPortalUrl}/requisitions/${requisitionData.id}`;

    const mailOptions: EmailOptions = {
      from: smtp.from || 'noreply@accordo.ai',
      to: recipientEmail,
      subject: `Requisition Approved (${requisitionData.approvalLevel}): ${requisitionData.title}`,
      html: generateApprovalApprovedEmailHTML(recipientName, requisitionData, portalLink),
      text: generateApprovalApprovedEmailText(recipientName, requisitionData, portalLink),
    };

    const info = await sendEmailWithRetry(mailOptions);

    await logEmail(
      recipientEmail,
      recipientId,
      mailOptions.subject,
      'other',
      'sent',
      undefined,
      requisitionData.id,
      {
        emailSubType: 'approval_approved',
        approvalLevel: requisitionData.approvalLevel,
        approvedBy: requisitionData.approvedBy,
        nextLevel: requisitionData.nextLevel,
      },
      undefined,
      info.messageId,
      0
    );
  } catch (error) {
    logger.error('Failed to send approval approved email', {
      recipientEmail,
      requisitionId: requisitionData.id,
      error: (error as Error).message,
    });
    throw error;
  }
};

/**
 * Send approval rejected email
 */
export const sendApprovalRejectedEmail = async (
  recipientEmail: string,
  recipientName: string,
  recipientId: number,
  requisitionData: {
    id: number;
    title: string;
    projectName: string;
    amount: number;
    approvalLevel: string;
    rejectedBy: string;
    reason: string;
  }
): Promise<void> => {
  try {
    const portalLink = `${env.vendorPortalUrl}/requisitions/${requisitionData.id}`;

    const mailOptions: EmailOptions = {
      from: smtp.from || 'noreply@accordo.ai',
      to: recipientEmail,
      subject: `Requisition Rejected (${requisitionData.approvalLevel}): ${requisitionData.title}`,
      html: generateApprovalRejectedEmailHTML(recipientName, requisitionData, portalLink),
      text: generateApprovalRejectedEmailText(recipientName, requisitionData, portalLink),
    };

    const info = await sendEmailWithRetry(mailOptions);

    await logEmail(
      recipientEmail,
      recipientId,
      mailOptions.subject,
      'other',
      'sent',
      undefined,
      requisitionData.id,
      {
        emailSubType: 'approval_rejected',
        approvalLevel: requisitionData.approvalLevel,
        rejectedBy: requisitionData.rejectedBy,
        reason: requisitionData.reason,
      },
      undefined,
      info.messageId,
      0
    );
  } catch (error) {
    logger.error('Failed to send approval rejected email', {
      recipientEmail,
      requisitionId: requisitionData.id,
      error: (error as Error).message,
    });
    throw error;
  }
};

// ==========================================
// DEAL CREATED EMAIL (Chatbot Negotiation)
// ==========================================

/**
 * Input data for deal created email
 */
interface DealCreatedEmailData {
  dealId: string;
  dealTitle: string;
  requisitionId: number;
  rfqNumber: string;
  requisitionTitle: string;
  projectName: string;
  vendorId: number;
  vendorName: string;
  vendorEmail: string;
  negotiationDeadline?: Date;
  products: Array<{
    name: string;
    quantity: number;
    targetPrice: number;
    unit?: string;
  }>;
  priceConfig?: {
    targetUnitPrice: number;
    maxAcceptablePrice: number;
  };
  paymentTerms?: {
    minDays: number;
    maxDays: number;
  };
  deliveryDate?: string;
}

/**
 * Generate HTML email for deal created notification
 */
const generateDealCreatedEmailHTML = (
  data: DealCreatedEmailData,
  chatbotLink: string
): string => {
  const productsHTML = data.products
    .map(
      (p) => `
    <tr>
      <td style="padding: 12px; border: 1px solid #e5e7eb;">${p.name}</td>
      <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: center;">${p.quantity}${p.unit ? ` ${p.unit}` : ''}</td>
      <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right;">$${p.targetPrice.toFixed(2)}</td>
    </tr>
  `
    )
    .join('');

  const totalValue = data.products.reduce((sum, p) => sum + p.quantity * p.targetPrice, 0);

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>New Negotiation Deal Created</title>
    </head>
    <body style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 650px; margin: 0 auto; padding: 20px; background-color: #f3f4f6;">
      <div style="background-color: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 600;">New Negotiation Invitation</h1>
          <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 14px;">You've been invited to negotiate on a new deal</p>
        </div>

        <!-- Content -->
        <div style="padding: 30px;">
          <p style="font-size: 16px; margin-bottom: 20px;">Dear <strong>${data.vendorName}</strong>,</p>

          <p style="margin-bottom: 25px;">You have been invited to participate in a negotiation for the following requisition. Please review the details below and click the button to start the negotiation process.</p>

          <!-- Deal Summary Card -->
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 25px;">
            <h2 style="color: #1e40af; margin: 0 0 15px 0; font-size: 18px; font-weight: 600;">Deal Summary</h2>
            <table style="width: 100%;">
              <tr>
                <td style="padding: 8px 0; color: #64748b; width: 140px;">Deal Title:</td>
                <td style="padding: 8px 0; font-weight: 500;">${data.dealTitle}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">RFQ Number:</td>
                <td style="padding: 8px 0; font-weight: 500;">${data.rfqNumber}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Project:</td>
                <td style="padding: 8px 0; font-weight: 500;">${data.projectName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Estimated Value:</td>
                <td style="padding: 8px 0; font-weight: 500; color: #059669;">$${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
              </tr>
              ${data.deliveryDate ? `
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Delivery By:</td>
                <td style="padding: 8px 0; font-weight: 500;">${new Date(data.deliveryDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
              </tr>
              ` : ''}
              ${data.negotiationDeadline ? `
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Negotiation Deadline:</td>
                <td style="padding: 8px 0; font-weight: 500; color: #dc2626;">${new Date(data.negotiationDeadline).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
              </tr>
              ` : ''}
            </table>
          </div>

          <!-- Products Table -->
          <h3 style="color: #374151; margin: 0 0 15px 0; font-size: 16px; font-weight: 600;">Products Required</h3>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
            <thead>
              <tr style="background-color: #f1f5f9;">
                <th style="padding: 12px; border: 1px solid #e5e7eb; text-align: left; font-weight: 600; color: #475569;">Product</th>
                <th style="padding: 12px; border: 1px solid #e5e7eb; text-align: center; font-weight: 600; color: #475569;">Quantity</th>
                <th style="padding: 12px; border: 1px solid #e5e7eb; text-align: right; font-weight: 600; color: #475569;">Target Price</th>
              </tr>
            </thead>
            <tbody>
              ${productsHTML}
            </tbody>
            <tfoot>
              <tr style="background-color: #f8fafc;">
                <td colspan="2" style="padding: 12px; border: 1px solid #e5e7eb; text-align: right; font-weight: 600;">Total Estimated Value:</td>
                <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right; font-weight: 600; color: #059669;">$${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
              </tr>
            </tfoot>
          </table>

          ${data.paymentTerms ? `
          <!-- Payment Terms -->
          <div style="background-color: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 15px; margin-bottom: 25px;">
            <p style="margin: 0; color: #92400e; font-size: 14px;">
              <strong>Payment Terms:</strong> Preferred ${data.paymentTerms.minDays}-${data.paymentTerms.maxDays} days
            </p>
          </div>
          ` : ''}

          <!-- CTA Button -->
          <div style="text-align: center; margin: 30px 0;">
            <a href="${chatbotLink}" style="display: inline-block; background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: white; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 14px rgba(37, 99, 235, 0.4);">Start Negotiation</a>
          </div>

          <p style="color: #64748b; font-size: 14px; margin-top: 25px; text-align: center;">
            Click the button above to access the negotiation platform and submit your offer.
          </p>

          ${data.negotiationDeadline ? `
          <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 15px; margin-top: 20px; text-align: center;">
            <p style="margin: 0; color: #991b1b; font-size: 14px;">
              <strong>Important:</strong> This negotiation link will expire on ${new Date(data.negotiationDeadline).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          ` : ''}
        </div>

        <!-- Footer -->
        <div style="background-color: #f8fafc; padding: 20px 30px; border-top: 1px solid #e2e8f0;">
          <p style="color: #64748b; font-size: 12px; margin: 0; text-align: center;">
            This email was sent by Accordo AI Procurement Platform.<br>
            If you have questions, please contact your procurement representative.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
};

/**
 * Generate plain text email for deal created notification
 */
const generateDealCreatedEmailText = (
  data: DealCreatedEmailData,
  chatbotLink: string
): string => {
  const productsText = data.products
    .map((p) => `  - ${p.name}: Qty ${p.quantity}, Target Price $${p.targetPrice.toFixed(2)}`)
    .join('\n');

  const totalValue = data.products.reduce((sum, p) => sum + p.quantity * p.targetPrice, 0);

  return `
NEW NEGOTIATION INVITATION
===========================

Dear ${data.vendorName},

You have been invited to participate in a negotiation for the following requisition.

DEAL SUMMARY
------------
Deal Title: ${data.dealTitle}
RFQ Number: ${data.rfqNumber}
Project: ${data.projectName}
Estimated Value: $${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
${data.deliveryDate ? `Delivery By: ${new Date(data.deliveryDate).toLocaleDateString()}` : ''}
${data.negotiationDeadline ? `Negotiation Deadline: ${new Date(data.negotiationDeadline).toLocaleDateString()}` : ''}

PRODUCTS REQUIRED
-----------------
${productsText}

Total Estimated Value: $${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}

${data.paymentTerms ? `Payment Terms: Preferred ${data.paymentTerms.minDays}-${data.paymentTerms.maxDays} days` : ''}

START NEGOTIATION
-----------------
Click the link below to access the negotiation platform and submit your offer:
${chatbotLink}

${data.negotiationDeadline ? `IMPORTANT: This negotiation link will expire on ${new Date(data.negotiationDeadline).toLocaleDateString()}` : ''}

---
This email was sent by Accordo AI Procurement Platform.
If you have questions, please contact your procurement representative.
  `;
};

/**
 * Send deal created email to vendor
 * Called when a new chatbot deal is created from the wizard
 */
export const sendDealCreatedEmail = async (
  data: DealCreatedEmailData
): Promise<{ success: boolean; messageId?: string; error?: string }> => {
  try {
    // Build the new hierarchical chatbot URL
    const chatbotLink = `${env.chatbotFrontendUrl}/chatbot/requisitions/${data.requisitionId}/vendors/${data.vendorId}/deals/${data.dealId}`;

    const mailOptions: EmailOptions = {
      from: smtp.from || 'noreply@accordo.ai',
      to: data.vendorEmail,
      subject: `Negotiation Invitation: ${data.dealTitle} (${data.rfqNumber})`,
      html: generateDealCreatedEmailHTML(data, chatbotLink),
      text: generateDealCreatedEmailText(data, chatbotLink),
    };

    const info = await sendEmailWithRetry(mailOptions);

    await logEmail(
      data.vendorEmail,
      data.vendorId,
      mailOptions.subject,
      'other',
      'sent',
      undefined,
      data.requisitionId,
      {
        emailSubType: 'deal_created',
        dealId: data.dealId,
        dealTitle: data.dealTitle,
        rfqNumber: data.rfqNumber,
        chatbotLink,
      },
      undefined,
      info.messageId,
      0
    );

    logger.info('Deal created email sent successfully', {
      dealId: data.dealId,
      vendorEmail: data.vendorEmail,
      requisitionId: data.requisitionId,
      messageId: info.messageId,
    });

    return { success: true, messageId: info.messageId };
  } catch (error) {
    const errorMessage = (error as Error).message;

    logger.error('Failed to send deal created email', {
      dealId: data.dealId,
      vendorEmail: data.vendorEmail,
      requisitionId: data.requisitionId,
      error: errorMessage,
    });

    await logEmail(
      data.vendorEmail,
      data.vendorId,
      `Negotiation Invitation: ${data.dealTitle}`,
      'other',
      'failed',
      undefined,
      data.requisitionId,
      {
        emailSubType: 'deal_created',
        dealId: data.dealId,
        dealTitle: data.dealTitle,
      },
      errorMessage,
      undefined,
      2
    );

    // Return error instead of throwing - deal should still be created even if email fails
    return { success: false, error: errorMessage };
  }
};

// ==========================================
// CONTINUED NEGOTIATION EMAIL (Subsequent deals for existing vendor)
// ==========================================

/**
 * Input data for continued negotiation email
 * Used when creating additional deals for a vendor who already has deals on this requisition
 */
interface ContinuedNegotiationEmailData {
  dealId: string;
  dealTitle: string;
  requisitionId: number;
  rfqNumber: string;
  requisitionTitle: string;
  projectName: string;
  vendorId: number;
  vendorName: string;
  vendorEmail: string;
  contractUniqueToken: string;  // Token for /vendor-chat/{token} link
  negotiationDeadline?: Date;
  previousDealsCount: number;  // Number of previous deals/negotiations
  products: Array<{
    name: string;
    quantity: number;
    targetPrice: number;
    unit?: string;
  }>;
  paymentTerms?: {
    minDays: number;
    maxDays: number;
  };
  deliveryDate?: string;
  useVendorContractLink?: boolean;  // When true, use /vendor-contract/ link instead of /vendor-chat/
}

/**
 * Generate HTML email for continued negotiation
 * Used for subsequent deals when vendor already has deals on requisition
 */
const generateContinuedNegotiationEmailHTML = (
  data: ContinuedNegotiationEmailData,
  vendorChatLink: string
): string => {
  const productsHTML = data.products
    .map(
      (p) => `
    <tr>
      <td style="padding: 12px; border: 1px solid #e5e7eb;">${p.name}</td>
      <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: center;">${p.quantity}${p.unit ? ` ${p.unit}` : ''}</td>
      <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right;">$${p.targetPrice.toFixed(2)}</td>
    </tr>
  `
    )
    .join('');

  const totalValue = data.products.reduce((sum, p) => sum + p.quantity * p.targetPrice, 0);

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Continue Negotiation</title>
    </head>
    <body style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 650px; margin: 0 auto; padding: 20px; background-color: #f3f4f6;">
      <div style="background-color: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #059669 0%, #047857 100%); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 600;">Continue Negotiation</h1>
          <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 14px;">A new negotiation round has been initiated</p>
        </div>

        <!-- Content -->
        <div style="padding: 30px;">
          <p style="font-size: 16px; margin-bottom: 20px;">Dear <strong>${data.vendorName}</strong>,</p>

          <div style="background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
            <p style="margin: 0; color: #065f46; font-size: 14px;">
              <strong>Building on our previous conversations:</strong> You have had ${data.previousDealsCount} previous negotiation${data.previousDealsCount > 1 ? 's' : ''} for this requisition. We're initiating a new round to continue our partnership.
            </p>
          </div>

          <p style="margin-bottom: 25px;">We would like to continue negotiating for the following requisition. Please review the updated details below and click the button to proceed with the negotiation.</p>

          <!-- Deal Summary Card -->
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 25px;">
            <h2 style="color: #059669; margin: 0 0 15px 0; font-size: 18px; font-weight: 600;">Negotiation Details</h2>
            <table style="width: 100%;">
              <tr>
                <td style="padding: 8px 0; color: #64748b; width: 140px;">Deal Title:</td>
                <td style="padding: 8px 0; font-weight: 500;">${data.dealTitle}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">RFQ Number:</td>
                <td style="padding: 8px 0; font-weight: 500;">${data.rfqNumber}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Project:</td>
                <td style="padding: 8px 0; font-weight: 500;">${data.projectName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Estimated Value:</td>
                <td style="padding: 8px 0; font-weight: 500; color: #059669;">$${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
              </tr>
              ${data.deliveryDate ? `
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Delivery By:</td>
                <td style="padding: 8px 0; font-weight: 500;">${new Date(data.deliveryDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
              </tr>
              ` : ''}
              ${data.negotiationDeadline ? `
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Negotiation Deadline:</td>
                <td style="padding: 8px 0; font-weight: 500; color: #dc2626;">${new Date(data.negotiationDeadline).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
              </tr>
              ` : ''}
            </table>
          </div>

          <!-- Products Table -->
          <h3 style="color: #374151; margin: 0 0 15px 0; font-size: 16px; font-weight: 600;">Products Required</h3>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
            <thead>
              <tr style="background-color: #f1f5f9;">
                <th style="padding: 12px; border: 1px solid #e5e7eb; text-align: left; font-weight: 600; color: #475569;">Product</th>
                <th style="padding: 12px; border: 1px solid #e5e7eb; text-align: center; font-weight: 600; color: #475569;">Quantity</th>
                <th style="padding: 12px; border: 1px solid #e5e7eb; text-align: right; font-weight: 600; color: #475569;">Target Price</th>
              </tr>
            </thead>
            <tbody>
              ${productsHTML}
            </tbody>
            <tfoot>
              <tr style="background-color: #f8fafc;">
                <td colspan="2" style="padding: 12px; border: 1px solid #e5e7eb; text-align: right; font-weight: 600;">Total Estimated Value:</td>
                <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right; font-weight: 600; color: #059669;">$${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
              </tr>
            </tfoot>
          </table>

          ${data.paymentTerms ? `
          <!-- Payment Terms -->
          <div style="background-color: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 15px; margin-bottom: 25px;">
            <p style="margin: 0; color: #92400e; font-size: 14px;">
              <strong>Payment Terms:</strong> Preferred ${data.paymentTerms.minDays}-${data.paymentTerms.maxDays} days
            </p>
          </div>
          ` : ''}

          <!-- CTA Button -->
          <div style="text-align: center; margin: 30px 0;">
            <a href="${vendorChatLink}" style="display: inline-block; background: linear-gradient(135deg, #059669 0%, #047857 100%); color: white; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 14px rgba(5, 150, 105, 0.4);">Continue Negotiation</a>
          </div>

          <p style="color: #64748b; font-size: 14px; margin-top: 25px; text-align: center;">
            Click the button above to access the negotiation platform and submit your updated offer.
          </p>

          ${data.negotiationDeadline ? `
          <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 15px; margin-top: 20px; text-align: center;">
            <p style="margin: 0; color: #991b1b; font-size: 14px;">
              <strong>Important:</strong> This negotiation link will expire on ${new Date(data.negotiationDeadline).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          ` : ''}
        </div>

        <!-- Footer -->
        <div style="background-color: #f8fafc; padding: 20px 30px; border-top: 1px solid #e2e8f0;">
          <p style="color: #64748b; font-size: 12px; margin: 0; text-align: center;">
            This email was sent by Accordo AI Procurement Platform.<br>
            If you have questions, please contact your procurement representative.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
};

/**
 * Generate plain text email for continued negotiation
 */
const generateContinuedNegotiationEmailText = (
  data: ContinuedNegotiationEmailData,
  vendorChatLink: string
): string => {
  const productsText = data.products
    .map((p) => `  - ${p.name}: Qty ${p.quantity}, Target Price $${p.targetPrice.toFixed(2)}`)
    .join('\n');

  const totalValue = data.products.reduce((sum, p) => sum + p.quantity * p.targetPrice, 0);

  return `
CONTINUE NEGOTIATION
====================

Dear ${data.vendorName},

Building on our previous ${data.previousDealsCount} negotiation${data.previousDealsCount > 1 ? 's' : ''}, we would like to continue our partnership by initiating a new negotiation round.

Please review the updated details below and proceed with the negotiation.

NEGOTIATION DETAILS
-------------------
Deal Title: ${data.dealTitle}
RFQ Number: ${data.rfqNumber}
Project: ${data.projectName}
Estimated Value: $${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
${data.deliveryDate ? `Delivery By: ${new Date(data.deliveryDate).toLocaleDateString()}` : ''}
${data.negotiationDeadline ? `Negotiation Deadline: ${new Date(data.negotiationDeadline).toLocaleDateString()}` : ''}

PRODUCTS REQUIRED
-----------------
${productsText}

Total Estimated Value: $${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}

${data.paymentTerms ? `Payment Terms: Preferred ${data.paymentTerms.minDays}-${data.paymentTerms.maxDays} days` : ''}

CONTINUE NEGOTIATION
--------------------
Click the link below to access the negotiation platform and submit your updated offer:
${vendorChatLink}

${data.negotiationDeadline ? `IMPORTANT: This negotiation link will expire on ${new Date(data.negotiationDeadline).toLocaleDateString()}` : ''}

---
This email was sent by Accordo AI Procurement Platform.
If you have questions, please contact your procurement representative.
  `;
};

/**
 * Send continued negotiation email to vendor
 * Called when creating additional deals for a vendor who already has deals on this requisition
 * Uses /vendor-chat/{token} link instead of /vendor-contract/{token}
 */
export const sendContinuedNegotiationEmail = async (
  data: ContinuedNegotiationEmailData
): Promise<{ success: boolean; messageId?: string; error?: string }> => {
  try {
    // Build the vendor link using the contract's unique token
    // For re-negotiation, use /vendor-contract/ so vendor can submit a fresh quote
    const vendorChatLink = data.useVendorContractLink
      ? `${env.chatbotFrontendUrl}/vendor-contract/${data.contractUniqueToken}`
      : `${env.chatbotFrontendUrl}/vendor-chat/${data.contractUniqueToken}`;

    const mailOptions: EmailOptions = {
      from: smtp.from || 'noreply@accordo.ai',
      to: data.vendorEmail,
      subject: `Continue Negotiation: ${data.dealTitle} (${data.rfqNumber})`,
      html: generateContinuedNegotiationEmailHTML(data, vendorChatLink),
      text: generateContinuedNegotiationEmailText(data, vendorChatLink),
    };

    const info = await sendEmailWithRetry(mailOptions);

    await logEmail(
      data.vendorEmail,
      data.vendorId,
      mailOptions.subject,
      'other',
      'sent',
      undefined,
      data.requisitionId,
      {
        emailSubType: 'continued_negotiation',
        dealId: data.dealId,
        dealTitle: data.dealTitle,
        rfqNumber: data.rfqNumber,
        vendorChatLink,
        previousDealsCount: data.previousDealsCount,
      },
      undefined,
      info.messageId,
      0
    );

    logger.info('Continued negotiation email sent successfully', {
      dealId: data.dealId,
      vendorEmail: data.vendorEmail,
      requisitionId: data.requisitionId,
      previousDealsCount: data.previousDealsCount,
      messageId: info.messageId,
    });

    return { success: true, messageId: info.messageId };
  } catch (error) {
    const errorMessage = (error as Error).message;

    logger.error('Failed to send continued negotiation email', {
      dealId: data.dealId,
      vendorEmail: data.vendorEmail,
      requisitionId: data.requisitionId,
      error: errorMessage,
    });

    await logEmail(
      data.vendorEmail,
      data.vendorId,
      `Continue Negotiation: ${data.dealTitle}`,
      'other',
      'failed',
      undefined,
      data.requisitionId,
      {
        emailSubType: 'continued_negotiation',
        dealId: data.dealId,
        dealTitle: data.dealTitle,
        previousDealsCount: data.previousDealsCount,
      },
      errorMessage,
      undefined,
      2
    );

    // Return error instead of throwing - deal should still be created even if email fails
    return { success: false, error: errorMessage };
  }
};

// ==========================================
// PM NOTIFICATION EMAIL (Deal Status Change)
// ==========================================

/**
 * Input data for PM notification email when deal status changes
 */
interface PmNotificationEmailData {
  dealId: string;
  dealTitle: string;
  requisitionId: number;
  rfqNumber: string;
  vendorName: string;
  vendorCompanyName?: string;
  pmEmail: string;
  pmName: string;
  pmUserId: number;
  newStatus: 'ACCEPTED' | 'WALKED_AWAY' | 'ESCALATED';
  utility?: number;
  vendorOffer?: {
    price?: number | null;
    paymentTerms?: string | null;
  };
  reasoning?: string[];
}

/**
 * Generate HTML email for PM notification when deal status changes
 */
const generatePmNotificationEmailHTML = (
  data: PmNotificationEmailData,
  dashboardLink: string
): string => {
  const statusConfig: Record<string, { color: string; icon: string; title: string; description: string }> = {
    ACCEPTED: {
      color: '#059669',
      icon: '✓',
      title: 'Deal Accepted',
      description: 'The negotiation has concluded successfully. The vendor\'s offer meets your acceptance criteria.',
    },
    WALKED_AWAY: {
      color: '#dc2626',
      icon: '✗',
      title: 'Deal Walked Away',
      description: 'The negotiation could not reach acceptable terms. The vendor\'s offer fell below your minimum thresholds.',
    },
    ESCALATED: {
      color: '#f59e0b',
      icon: '!',
      title: 'Deal Escalated',
      description: 'The negotiation requires management review. The offer is in the escalation zone and needs human decision.',
    },
  };

  const config = statusConfig[data.newStatus];

  const offerHTML = data.vendorOffer ? `
    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin: 15px 0;">
      <h3 style="color: #374151; margin: 0 0 10px 0; font-size: 14px; font-weight: 600;">Final Vendor Offer</h3>
      ${data.vendorOffer.price ? `<p style="margin: 5px 0; color: #64748b;">Price: <strong style="color: #1f2937;">$${data.vendorOffer.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong></p>` : ''}
      ${data.vendorOffer.paymentTerms ? `<p style="margin: 5px 0; color: #64748b;">Payment Terms: <strong style="color: #1f2937;">${data.vendorOffer.paymentTerms}</strong></p>` : ''}
      ${data.utility !== undefined ? `<p style="margin: 5px 0; color: #64748b;">Utility Score: <strong style="color: #1f2937;">${(data.utility * 100).toFixed(1)}%</strong></p>` : ''}
    </div>
  ` : '';

  const reasoningHTML = data.reasoning && data.reasoning.length > 0 ? `
    <div style="background-color: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; padding: 15px; margin: 15px 0;">
      <h3 style="color: #92400e; margin: 0 0 10px 0; font-size: 14px; font-weight: 600;">AI Decision Reasoning</h3>
      <ul style="margin: 0; padding-left: 20px; color: #78350f;">
        ${data.reasoning.map(r => `<li style="margin: 5px 0;">${r}</li>`).join('')}
      </ul>
    </div>
  ` : '';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Negotiation ${config.title}</title>
    </head>
    <body style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 650px; margin: 0 auto; padding: 20px; background-color: #f3f4f6;">
      <div style="background-color: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
        <!-- Header -->
        <div style="background-color: ${config.color}; padding: 30px; text-align: center;">
          <div style="width: 60px; height: 60px; background-color: rgba(255,255,255,0.2); border-radius: 50%; margin: 0 auto 15px; display: flex; align-items: center; justify-content: center;">
            <span style="color: white; font-size: 32px; font-weight: bold;">${config.icon}</span>
          </div>
          <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 600;">${config.title}</h1>
        </div>

        <!-- Content -->
        <div style="padding: 30px;">
          <p style="font-size: 16px; margin-bottom: 20px;">Dear <strong>${data.pmName}</strong>,</p>

          <p style="margin-bottom: 20px;">${config.description}</p>

          <!-- Deal Summary Card -->
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
            <h2 style="color: #1e40af; margin: 0 0 15px 0; font-size: 18px; font-weight: 600;">Deal Details</h2>
            <table style="width: 100%;">
              <tr>
                <td style="padding: 8px 0; color: #64748b; width: 140px;">Deal Title:</td>
                <td style="padding: 8px 0; font-weight: 500;">${data.dealTitle}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">RFQ Number:</td>
                <td style="padding: 8px 0; font-weight: 500;">${data.rfqNumber}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Vendor:</td>
                <td style="padding: 8px 0; font-weight: 500;">${data.vendorCompanyName || data.vendorName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Status:</td>
                <td style="padding: 8px 0;">
                  <span style="display: inline-block; padding: 4px 12px; background-color: ${config.color}; color: white; border-radius: 4px; font-weight: 600; font-size: 12px;">${data.newStatus.replace('_', ' ')}</span>
                </td>
              </tr>
            </table>
          </div>

          ${offerHTML}
          ${reasoningHTML}

          <!-- CTA Button -->
          <div style="text-align: center; margin: 30px 0;">
            <a href="${dashboardLink}" style="display: inline-block; background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: white; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 14px rgba(37, 99, 235, 0.4);">View Deal Details</a>
          </div>

          ${data.newStatus === 'ESCALATED' ? `
          <div style="background-color: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 15px; margin-top: 20px; text-align: center;">
            <p style="margin: 0; color: #92400e; font-size: 14px;">
              <strong>Action Required:</strong> Please review this deal and make a final decision.
            </p>
          </div>
          ` : ''}
        </div>

        <!-- Footer -->
        <div style="background-color: #f8fafc; padding: 20px 30px; border-top: 1px solid #e2e8f0;">
          <p style="color: #64748b; font-size: 12px; margin: 0; text-align: center;">
            This is an automated notification from Accordo AI Procurement Platform.<br>
            Deal ID: ${data.dealId}
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
};

/**
 * Generate plain text email for PM notification
 */
const generatePmNotificationEmailText = (
  data: PmNotificationEmailData,
  dashboardLink: string
): string => {
  const statusMessages: Record<string, string> = {
    ACCEPTED: 'The negotiation has concluded successfully. The vendor\'s offer meets your acceptance criteria.',
    WALKED_AWAY: 'The negotiation could not reach acceptable terms. The vendor\'s offer fell below your minimum thresholds.',
    ESCALATED: 'The negotiation requires management review. The offer is in the escalation zone and needs human decision.',
  };

  const offerText = data.vendorOffer ? `
Final Vendor Offer:
${data.vendorOffer.price ? `- Price: $${data.vendorOffer.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : ''}
${data.vendorOffer.paymentTerms ? `- Payment Terms: ${data.vendorOffer.paymentTerms}` : ''}
${data.utility !== undefined ? `- Utility Score: ${(data.utility * 100).toFixed(1)}%` : ''}
` : '';

  const reasoningText = data.reasoning && data.reasoning.length > 0 ? `
AI Decision Reasoning:
${data.reasoning.map(r => `- ${r}`).join('\n')}
` : '';

  return `
NEGOTIATION STATUS UPDATE: ${data.newStatus.replace('_', ' ')}
${'='.repeat(50)}

Dear ${data.pmName},

${statusMessages[data.newStatus]}

DEAL DETAILS
------------
Deal Title: ${data.dealTitle}
RFQ Number: ${data.rfqNumber}
Vendor: ${data.vendorCompanyName || data.vendorName}
Status: ${data.newStatus.replace('_', ' ')}

${offerText}
${reasoningText}

VIEW DEAL
---------
${dashboardLink}

${data.newStatus === 'ESCALATED' ? 'ACTION REQUIRED: Please review this deal and make a final decision.\n' : ''}
---
This is an automated notification from Accordo AI Procurement Platform.
Deal ID: ${data.dealId}
  `;
};

/**
 * Send PM notification email when deal status changes to ACCEPTED, WALKED_AWAY, or ESCALATED
 */
export const sendPmDealStatusNotificationEmail = async (
  data: PmNotificationEmailData
): Promise<{ success: boolean; messageId?: string; error?: string }> => {
  try {
    // Build the dashboard link
    const dashboardLink = `${env.chatbotFrontendUrl}/chatbot/requisitions/${data.requisitionId}/vendors/${data.pmUserId}/deals/${data.dealId}`;

    const subjectPrefix: Record<string, string> = {
      ACCEPTED: '[DEAL ACCEPTED]',
      WALKED_AWAY: '[DEAL WALKED AWAY]',
      ESCALATED: '[ACTION REQUIRED - ESCALATED]',
    };

    const mailOptions: EmailOptions = {
      from: smtp.from || 'noreply@accordo.ai',
      to: data.pmEmail,
      subject: `${subjectPrefix[data.newStatus]} ${data.dealTitle} (${data.rfqNumber})`,
      html: generatePmNotificationEmailHTML(data, dashboardLink),
      text: generatePmNotificationEmailText(data, dashboardLink),
    };

    const info = await sendEmailWithRetry(mailOptions);

    await logEmail(
      data.pmEmail,
      data.pmUserId,
      mailOptions.subject,
      'other',
      'sent',
      undefined,
      data.requisitionId,
      {
        emailSubType: 'pm_deal_status_notification',
        dealId: data.dealId,
        dealTitle: data.dealTitle,
        rfqNumber: data.rfqNumber,
        newStatus: data.newStatus,
        vendorName: data.vendorName,
        utility: data.utility,
      },
      undefined,
      info.messageId,
      0
    );

    logger.info('PM deal status notification email sent successfully', {
      dealId: data.dealId,
      pmEmail: data.pmEmail,
      newStatus: data.newStatus,
      requisitionId: data.requisitionId,
      messageId: info.messageId,
    });

    return { success: true, messageId: info.messageId };
  } catch (error) {
    const errorMessage = (error as Error).message;

    logger.error('Failed to send PM deal status notification email', {
      dealId: data.dealId,
      pmEmail: data.pmEmail,
      newStatus: data.newStatus,
      requisitionId: data.requisitionId,
      error: errorMessage,
    });

    await logEmail(
      data.pmEmail,
      data.pmUserId,
      `Deal Status: ${data.dealTitle}`,
      'other',
      'failed',
      undefined,
      data.requisitionId,
      {
        emailSubType: 'pm_deal_status_notification',
        dealId: data.dealId,
        dealTitle: data.dealTitle,
        newStatus: data.newStatus,
      },
      errorMessage,
      undefined,
      2
    );

    // Return error instead of throwing - notification failure shouldn't break the flow
    return { success: false, error: errorMessage };
  }
};

/**
 * Send deal summary PDF via email
 */
export interface SendDealSummaryPDFEmailData {
  to: string;
  dealTitle: string;
  vendorName: string;
  rfqId: number;
  pdfBuffer: Buffer;
  filename: string;
}

export const sendDealSummaryPDFEmail = async (
  data: SendDealSummaryPDFEmailData
): Promise<{ success: boolean; messageId?: string; error?: string }> => {
  const subject = `Deal Summary Report - ${data.vendorName} (RFQ-${data.rfqId})`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #0066cc; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { padding: 30px; background: #f9f9f9; border-radius: 0 0 8px 8px; }
        .highlight { background: #e8f4fc; padding: 15px; border-radius: 8px; margin: 20px 0; }
        .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📄 Deal Summary Report</h1>
        </div>
        <div class="content">
          <p>Hello,</p>

          <p>Please find attached the Deal Summary Report for:</p>

          <div class="highlight">
            <strong>Deal:</strong> ${data.dealTitle}<br>
            <strong>Vendor:</strong> ${data.vendorName}<br>
            <strong>RFQ ID:</strong> ${data.rfqId}
          </div>

          <p>This report includes:</p>
          <ul>
            <li>Deal Overview and Final Offer</li>
            <li>Negotiation Analytics and Charts</li>
            <li>Round-by-Round Timeline</li>
            <li>Complete Chat Transcript</li>
          </ul>

          <p>The PDF is attached to this email.</p>

          <div class="footer">
            <p>Generated by Accordo AI<br>
            <em>Confidential - For Internal Use Only</em></p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    const transporter = buildNodemailerTransporter();

    const info = await transporter.sendMail({
      from: `"Accordo AI" <${smtp.user}>`,
      to: data.to,
      subject,
      html,
      attachments: [
        {
          filename: data.filename,
          content: data.pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    });

    logger.info('Deal Summary PDF email sent successfully', {
      to: data.to,
      rfqId: data.rfqId,
      vendorName: data.vendorName,
      messageId: info.messageId,
    });

    return { success: true, messageId: info.messageId };
  } catch (error) {
    const errorMessage = (error as Error).message;

    logger.error('Failed to send Deal Summary PDF email', {
      to: data.to,
      rfqId: data.rfqId,
      vendorName: data.vendorName,
      error: errorMessage,
    });

    return { success: false, error: errorMessage };
  }
};

// ==========================================
// VENDOR QUOTE NOTIFICATION TO PM
// ==========================================

/**
 * Quote details for PM notification
 */
interface VendorQuoteDetails {
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

/**
 * Generate PM quote notification email HTML
 */
const generatePMQuoteNotificationEmailHTML = (
  pmName: string,
  vendorName: string,
  requisitionData: {
    title: string;
    rfqNumber: string;
    projectName: string;
  },
  quoteDetails: VendorQuoteDetails,
  portalLink: string,
  chatLink: string,
  currency: SupportedCurrency = 'USD'
): string => {
  let totalQuantity = 0;
  let grandTotal = 0;
  const productsHTML = quoteDetails.products
    .map((p) => {
      const unitPrice = typeof p.quotedPrice === 'number' ? p.quotedPrice : parseFloat(p.quotedPrice as string) || 0;
      const quantity = Number(p.quantity) || 0;
      const lineTotal = unitPrice * quantity;
      totalQuantity += quantity;
      grandTotal += lineTotal;
      return `
      <tr>
        <td style="padding: 8px; border: 1px solid #ddd;">${p.productName}</td>
        <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${quantity}</td>
        <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${formatCurrency(unitPrice, currency)}</td>
        <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${formatCurrency(lineTotal, currency)}</td>
        <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${p.deliveryDate || 'Not specified'}</td>
      </tr>
    `;
    })
    .join('');

  const totalsRowHTML = `
    <tr style="background-color: #f1f5f9; font-weight: bold;">
      <td style="padding: 8px; border: 1px solid #ddd;">Total</td>
      <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${totalQuantity}</td>
      <td style="padding: 8px; border: 1px solid #ddd; text-align: right; color: #6b7280;">—</td>
      <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${formatCurrency(grandTotal, currency)}</td>
      <td style="padding: 8px; border: 1px solid #ddd; text-align: center; color: #6b7280;">—</td>
    </tr>
  `;

  const terms = quoteDetails.additionalTerms;
  let paymentTermsText = 'Not specified';
  if (terms?.paymentTerms === 'net_payment') {
    paymentTermsText = `Net ${terms.netPaymentDay || 30} days`;
  } else if (terms?.paymentTerms === 'pre_post_payment') {
    paymentTermsText = `Pre: ${terms.prePaymentPercentage || 0}% / Post: ${terms.postPaymentPercentage || 0}%`;
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Vendor Quote Received</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px;">
        <h1 style="color: #28a745; margin-top: 0;">New Vendor Quote Received</h1>
        <p>Dear ${pmName},</p>
        <p><strong>${vendorName}</strong> has submitted a quotation for your requisition.</p>

        <div style="background-color: white; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h2 style="color: #333; margin-top: 0;">Requisition Details</h2>
          <p><strong>RFQ Number:</strong> ${requisitionData.rfqNumber}</p>
          <p><strong>Title:</strong> ${requisitionData.title}</p>
          <p><strong>Project:</strong> ${requisitionData.projectName}</p>

          <h3 style="color: #333; margin-top: 20px;">Quoted Products</h3>
          <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
            <thead>
              <tr style="background-color: #f8f9fa;">
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Product</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: center;">Quantity</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: right;">Quoted Price Per Unit</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: right;">Line Total</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: center;">Delivery Date</th>
              </tr>
            </thead>
            <tbody>
              ${productsHTML}
            </tbody>
            <tfoot>
              ${totalsRowHTML}
            </tfoot>
          </table>

          <h3 style="color: #333; margin-top: 20px;">Payment Terms</h3>
          <p>${paymentTermsText}</p>
          ${terms?.additionalNotes ? `<p><strong>Additional Notes:</strong> ${terms.additionalNotes}</p>` : ''}
        </div>

        <div style="margin: 30px 0; text-align: center;">
          <a href="${chatLink}" style="display: inline-block; background-color: #28a745; color: white; padding: 14px 28px; text-decoration: none; border-radius: 5px; font-weight: bold; margin-right: 10px;">Start Negotiation</a>
          <a href="${portalLink}" style="display: inline-block; background-color: #0066cc; color: white; padding: 14px 28px; text-decoration: none; border-radius: 5px; font-weight: bold;">View Details</a>
        </div>

        <p style="color: #666; font-size: 14px; margin-top: 30px;">
          The vendor is now ready to begin negotiation. Click "Start Negotiation" to review their offer and respond.
        </p>
      </div>
    </body>
    </html>
  `;
};

/**
 * Generate PM quote notification email plain text
 */
const generatePMQuoteNotificationEmailText = (
  pmName: string,
  vendorName: string,
  requisitionData: {
    title: string;
    rfqNumber: string;
    projectName: string;
  },
  quoteDetails: VendorQuoteDetails,
  portalLink: string,
  chatLink: string,
  currency: SupportedCurrency = 'USD'
): string => {
  let totalQuantity = 0;
  let grandTotal = 0;
  const productsText = quoteDetails.products
    .map((p) => {
      const unitPrice = typeof p.quotedPrice === 'number' ? p.quotedPrice : parseFloat(p.quotedPrice as string) || 0;
      const quantity = Number(p.quantity) || 0;
      const lineTotal = unitPrice * quantity;
      totalQuantity += quantity;
      grandTotal += lineTotal;
      return `  - ${p.productName}: Qty ${quantity}, Unit Price ${formatCurrency(unitPrice, currency)}, Line Total ${formatCurrency(lineTotal, currency)}, Delivery: ${p.deliveryDate || 'Not specified'}`;
    })
    .join('\n');
  const totalsText = `\n  Total: Qty ${totalQuantity}, Grand Total ${formatCurrency(grandTotal, currency)}`;

  const terms = quoteDetails.additionalTerms;
  let paymentTermsText = 'Not specified';
  if (terms?.paymentTerms === 'net_payment') {
    paymentTermsText = `Net ${terms.netPaymentDay || 30} days`;
  } else if (terms?.paymentTerms === 'pre_post_payment') {
    paymentTermsText = `Pre: ${terms.prePaymentPercentage || 0}% / Post: ${terms.postPaymentPercentage || 0}%`;
  }

  return `
New Vendor Quote Received

Dear ${pmName},

${vendorName} has submitted a quotation for your requisition.

Requisition Details:
- RFQ Number: ${requisitionData.rfqNumber}
- Title: ${requisitionData.title}
- Project: ${requisitionData.projectName}

Quoted Products:
${productsText}
${totalsText}

Payment Terms: ${paymentTermsText}
${terms?.additionalNotes ? `Additional Notes: ${terms.additionalNotes}` : ''}

Start Negotiation: ${chatLink}
View Details: ${portalLink}

The vendor is now ready to begin negotiation.
  `;
};

/**
 * Send PM notification when vendor submits a quote
 */
export const sendPMQuoteNotificationEmail = async (
  contract: any,
  quoteDetails: VendorQuoteDetails
): Promise<{ success: boolean; messageId?: string; error?: string }> => {
  try {
    // Get requisition with project
    const requisition = contract.Requisition;
    if (!requisition) {
      throw new Error('Contract has no requisition');
    }

    // Get PM (created by user) from requisition
    const pmUser = requisition.userId
      ? await models.User.findByPk(requisition.userId)
      : null;

    if (!pmUser || !pmUser.email) {
      logger.warn('No PM user found for quote notification', {
        contractId: contract.id,
        requisitionId: requisition.id,
      });
      return { success: false, error: 'No PM user found' };
    }

    const vendorName = contract.Vendor?.name || 'Vendor';
    const pmName = pmUser.name || 'Procurement Manager';

    const requisitionData = {
      title: requisition.title || 'Untitled Requisition',
      rfqNumber: requisition.rfqNumber || `RFQ-${requisition.id}`,
      projectName: requisition.Project?.name || 'Unknown Project',
    };

    // Resolve currency from the requisition (source of truth for all monetary display)
    const currency = (requisition.typeOfCurrency as SupportedCurrency) || 'USD';

    const portalLink = `${env.vendorPortalUrl}/requisition-management`;
    const chatLink = contract.chatbotDealId && requisition.id && contract.vendorId
      ? `${env.chatbotFrontendUrl}/chatbot/requisitions/${requisition.id}/vendors/${contract.vendorId}/deals/${contract.chatbotDealId}`
      : portalLink;

    const mailOptions: EmailOptions = {
      from: smtp.from || 'noreply@accordo.ai',
      to: pmUser.email,
      subject: `New Quote from ${vendorName} - ${requisitionData.title}`,
      html: generatePMQuoteNotificationEmailHTML(
        pmName,
        vendorName,
        requisitionData,
        quoteDetails,
        portalLink,
        chatLink,
        currency
      ),
      text: generatePMQuoteNotificationEmailText(
        pmName,
        vendorName,
        requisitionData,
        quoteDetails,
        portalLink,
        chatLink,
        currency
      ),
    };

    const info = await sendEmailWithRetry(mailOptions);

    await logEmail(
      pmUser.email,
      pmUser.id,
      mailOptions.subject,
      'other',
      'sent',
      contract.id,
      requisition.id,
      {
        emailSubType: 'pm_quote_notification',
        vendorId: contract.vendorId,
        vendorName,
        quoteProducts: quoteDetails.products.length,
      },
      undefined,
      info.messageId,
      0
    );

    logger.info('PM quote notification email sent successfully', {
      contractId: contract.id,
      requisitionId: requisition.id,
      vendorName,
      pmEmail: pmUser.email,
      messageId: info.messageId,
    });

    return { success: true, messageId: info.messageId };
  } catch (error) {
    const errorMessage = (error as Error).message;

    logger.error('Failed to send PM quote notification email', {
      contractId: contract?.id,
      error: errorMessage,
    });

    return { success: false, error: errorMessage };
  }
};

// ==========================================
// REQUISITION UPDATED EMAIL (Vendor Notification)
// ==========================================

/**
 * Diff types for requisition updates
 */
interface FieldChange {
  field: string;
  label: string;
  oldValue: any;
  newValue: any;
}

interface ProductChange {
  productId: number;
  productName: string;
  changes: FieldChange[];
  isNew?: boolean;
  isRemoved?: boolean;
}

interface RequisitionDiff {
  requisitionChanges: FieldChange[];
  productChanges: ProductChange[];
  hasChanges: boolean;
}

/**
 * Generate HTML email for requisition updated notification
 */
const generateRequisitionUpdatedEmailHTML = (
  vendorName: string,
  requisitionData: {
    title: string;
    rfqNumber: string;
    projectName: string;
  },
  changes: RequisitionDiff,
  chatbotLink?: string
): string => {
  // Build requisition changes table
  let requisitionChangesHTML = '';
  if (changes.requisitionChanges.length > 0) {
    requisitionChangesHTML = `
      <h3 style="color: #374151; margin: 20px 0 10px 0; font-size: 16px; font-weight: 600;">Requisition Changes</h3>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <thead>
          <tr style="background-color: #f1f5f9;">
            <th style="padding: 10px; border: 1px solid #e5e7eb; text-align: left; font-weight: 600; color: #475569;">Field</th>
            <th style="padding: 10px; border: 1px solid #e5e7eb; text-align: left; font-weight: 600; color: #475569;">Previous Value</th>
            <th style="padding: 10px; border: 1px solid #e5e7eb; text-align: left; font-weight: 600; color: #475569;">New Value</th>
          </tr>
        </thead>
        <tbody>
          ${changes.requisitionChanges.map(change => `
            <tr>
              <td style="padding: 10px; border: 1px solid #e5e7eb; font-weight: 500;">${change.label}</td>
              <td style="padding: 10px; border: 1px solid #e5e7eb; color: #dc2626;"><s>${change.oldValue}</s></td>
              <td style="padding: 10px; border: 1px solid #e5e7eb; color: #059669; font-weight: 600;">${change.newValue}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  // Build product changes section
  let productChangesHTML = '';
  if (changes.productChanges.length > 0) {
    const productItems = changes.productChanges.map(pc => {
      if (pc.isNew) {
        return `
          <div style="background-color: #dcfce7; border: 1px solid #86efac; border-radius: 6px; padding: 12px; margin-bottom: 10px;">
            <span style="color: #166534; font-weight: 600;">+ Added:</span> ${pc.productName}
          </div>
        `;
      } else if (pc.isRemoved) {
        return `
          <div style="background-color: #fee2e2; border: 1px solid #fca5a5; border-radius: 6px; padding: 12px; margin-bottom: 10px;">
            <span style="color: #991b1b; font-weight: 600;">- Removed:</span> ${pc.productName}
          </div>
        `;
      } else {
        const changesTable = pc.changes.map(c => `
          <tr>
            <td style="padding: 6px 10px; border-bottom: 1px solid #e5e7eb;">${c.label}</td>
            <td style="padding: 6px 10px; border-bottom: 1px solid #e5e7eb; color: #dc2626;"><s>${c.oldValue}</s></td>
            <td style="padding: 6px 10px; border-bottom: 1px solid #e5e7eb; color: #059669; font-weight: 600;">${c.newValue}</td>
          </tr>
        `).join('');
        return `
          <div style="background-color: #fef3c7; border: 1px solid #fcd34d; border-radius: 6px; padding: 12px; margin-bottom: 10px;">
            <div style="color: #92400e; font-weight: 600; margin-bottom: 8px;">${pc.productName}</div>
            <table style="width: 100%; font-size: 14px;">
              ${changesTable}
            </table>
          </div>
        `;
      }
    }).join('');

    productChangesHTML = `
      <h3 style="color: #374151; margin: 20px 0 10px 0; font-size: 16px; font-weight: 600;">Product Changes</h3>
      ${productItems}
    `;
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Requisition Updated</title>
    </head>
    <body style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 650px; margin: 0 auto; padding: 20px; background-color: #f3f4f6;">
      <div style="background-color: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 600;">Requisition Updated</h1>
          <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 14px;">The terms of your negotiation have been modified</p>
        </div>

        <!-- Content -->
        <div style="padding: 30px;">
          <p style="font-size: 16px; margin-bottom: 20px;">Dear <strong>${vendorName}</strong>,</p>

          <p style="margin-bottom: 20px;">The procurement manager has updated the requisition you are currently negotiating. Please review the changes below and continue your negotiation with the updated terms.</p>

          <!-- Requisition Summary Card -->
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 25px;">
            <h2 style="color: #1e40af; margin: 0 0 15px 0; font-size: 18px; font-weight: 600;">Requisition Details</h2>
            <table style="width: 100%;">
              <tr>
                <td style="padding: 8px 0; color: #64748b; width: 120px;">RFQ Number:</td>
                <td style="padding: 8px 0; font-weight: 500;">${requisitionData.rfqNumber}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Title:</td>
                <td style="padding: 8px 0; font-weight: 500;">${requisitionData.title}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Project:</td>
                <td style="padding: 8px 0; font-weight: 500;">${requisitionData.projectName}</td>
              </tr>
            </table>
          </div>

          <!-- Changes Section -->
          ${requisitionChangesHTML}
          ${productChangesHTML}

          <!-- CTA Button -->
          ${chatbotLink ? `
          <div style="text-align: center; margin: 30px 0;">
            <a href="${chatbotLink}" style="display: inline-block; background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: white; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 14px rgba(37, 99, 235, 0.4);">Continue Negotiation</a>
          </div>
          ` : ''}

          <div style="background-color: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 15px; margin-top: 20px;">
            <p style="margin: 0; color: #92400e; font-size: 14px;">
              <strong>Important:</strong> The negotiation terms have been automatically recalculated based on these changes. Your current negotiation will continue with the updated parameters.
            </p>
          </div>
        </div>

        <!-- Footer -->
        <div style="background-color: #f8fafc; padding: 20px 30px; border-top: 1px solid #e2e8f0;">
          <p style="color: #64748b; font-size: 12px; margin: 0; text-align: center;">
            This email was sent by Accordo AI Procurement Platform.<br>
            If you have questions, please contact your procurement representative.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
};

/**
 * Generate plain text email for requisition updated notification
 */
const generateRequisitionUpdatedEmailText = (
  vendorName: string,
  requisitionData: {
    title: string;
    rfqNumber: string;
    projectName: string;
  },
  changes: RequisitionDiff,
  chatbotLink?: string
): string => {
  let changesText = '';

  if (changes.requisitionChanges.length > 0) {
    changesText += 'REQUISITION CHANGES:\n';
    for (const change of changes.requisitionChanges) {
      changesText += `- ${change.label}: ${change.oldValue} -> ${change.newValue}\n`;
    }
    changesText += '\n';
  }

  if (changes.productChanges.length > 0) {
    changesText += 'PRODUCT CHANGES:\n';
    for (const pc of changes.productChanges) {
      if (pc.isNew) {
        changesText += `+ Added: ${pc.productName}\n`;
      } else if (pc.isRemoved) {
        changesText += `- Removed: ${pc.productName}\n`;
      } else {
        changesText += `${pc.productName}:\n`;
        for (const c of pc.changes) {
          changesText += `  - ${c.label}: ${c.oldValue} -> ${c.newValue}\n`;
        }
      }
    }
  }

  return `
REQUISITION UPDATED
${'='.repeat(50)}

Dear ${vendorName},

The procurement manager has updated the requisition you are currently negotiating.

REQUISITION DETAILS
-------------------
RFQ Number: ${requisitionData.rfqNumber}
Title: ${requisitionData.title}
Project: ${requisitionData.projectName}

${changesText}

${chatbotLink ? `CONTINUE NEGOTIATION: ${chatbotLink}\n` : ''}

IMPORTANT: The negotiation terms have been automatically recalculated based on these changes. Your current negotiation will continue with the updated parameters.

---
This email was sent by Accordo AI Procurement Platform.
If you have questions, please contact your procurement representative.
  `;
};

/**
 * Send requisition updated email to vendor
 * Called when a requisition is edited and has active vendor contracts
 */
export const sendRequisitionUpdatedEmail = async (
  contract: Contract & { Vendor?: any },
  requisition: Requisition & { Project?: any },
  changes: RequisitionDiff
): Promise<{ success: boolean; messageId?: string; error?: string }> => {
  try {
    const vendor = contract.Vendor;
    if (!vendor || !vendor.email) {
      logger.warn('No vendor email for requisition updated notification', {
        contractId: contract.id,
        requisitionId: (requisition as any).id,
      });
      return { success: false, error: 'Vendor email not available' };
    }

    const vendorName = vendor.name || 'Vendor';
    const requisitionData = {
      title: (requisition as any).subject || (requisition as any).title || 'Untitled Requisition',
      rfqNumber: (requisition as any).rfqId || (requisition as any).rfqNumber || `RFQ-${(requisition as any).id}`,
      projectName: requisition.Project?.name || requisition.Project?.projectId || 'Unknown Project',
    };

    // Build chatbot link if deal exists
    const chatbotLink = contract.chatbotDealId && (requisition as any).id && contract.vendorId
      ? `${env.chatbotFrontendUrl}/chatbot/requisitions/${(requisition as any).id}/vendors/${contract.vendorId}/deals/${contract.chatbotDealId}`
      : undefined;

    const mailOptions: EmailOptions = {
      from: smtp.from || 'noreply@accordo.ai',
      to: vendor.email,
      subject: `Requisition Updated: ${requisitionData.title} (${requisitionData.rfqNumber})`,
      html: generateRequisitionUpdatedEmailHTML(vendorName, requisitionData, changes, chatbotLink),
      text: generateRequisitionUpdatedEmailText(vendorName, requisitionData, changes, chatbotLink),
    };

    const info = await sendEmailWithRetry(mailOptions);

    // Count total changes for metadata
    const changesCount = changes.requisitionChanges.length + changes.productChanges.length;

    await logEmail(
      vendor.email,
      contract.vendorId || null,
      mailOptions.subject,
      'other',
      'sent',
      contract.id,
      (requisition as any).id,
      {
        emailSubType: 'requisition_updated',
        changesCount,
        requisitionChanges: changes.requisitionChanges.length,
        productChanges: changes.productChanges.length,
        chatbotDealId: contract.chatbotDealId,
      },
      undefined,
      info.messageId,
      0
    );

    logger.info('Requisition updated email sent successfully', {
      contractId: contract.id,
      requisitionId: (requisition as any).id,
      vendorEmail: vendor.email,
      changesCount,
      messageId: info.messageId,
    });

    return { success: true, messageId: info.messageId };
  } catch (error) {
    const errorMessage = (error as Error).message;

    logger.error('Failed to send requisition updated email', {
      contractId: contract.id,
      requisitionId: (requisition as any).id,
      vendorEmail: contract.Vendor?.email,
      error: errorMessage,
    });

    await logEmail(
      contract.Vendor?.email || 'unknown',
      contract.vendorId || null,
      `Requisition Updated: ${(requisition as any).subject || (requisition as any).title}`,
      'other',
      'failed',
      contract.id,
      (requisition as any).id,
      {
        emailSubType: 'requisition_updated',
      },
      errorMessage,
      undefined,
      2
    );

    return { success: false, error: errorMessage };
  }
};