import { Router, type Request, type Response, type NextFunction } from 'express';
import Joi from 'joi';
import PDFDocument from 'pdfkit';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import {
  getRequisitionsForBidAnalysis,
  getRequisitionBidDetail,
  getActionHistory,
  rejectBid,
  restoreBid,
  selectBidForAnalysis,
  logViewAction,
  logExportAction,
  getNegotiationHistory,
} from './bid-analysis.service.js';
import { CustomError } from '../../utils/custom-error.js';
import type { TopBidInfo, VendorNegotiationSummary } from './bid-analysis.types.js';
import { chatCompletion } from '../../services/llm.service.js';

const router = Router();

// ============================================================================
// Joi Validation Schemas
// ============================================================================

export const getRequisitionsSchema = Joi.object({
  search: Joi.string().allow('').optional(),
  status: Joi.string().valid('ready', 'awaiting', 'awarded', 'all').optional().default('all'),
  projectId: Joi.number().integer().positive().optional(),
  dateFrom: Joi.string().isoDate().optional(),
  dateTo: Joi.string().isoDate().optional(),
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
  sortBy: Joi.string().valid('rfqId', 'subject', 'negotiationClosureDate', 'bidsCount', 'lowestPrice').optional().default('negotiationClosureDate'),
  sortOrder: Joi.string().valid('asc', 'desc').optional().default('desc'),
});

export const requisitionIdParamSchema = Joi.object({
  requisitionId: Joi.number().integer().positive().required(),
});

export const bidIdParamSchema = Joi.object({
  requisitionId: Joi.number().integer().positive().required(),
  bidId: Joi.string().uuid().required(),
});

export const selectBidBodySchema = Joi.object({
  remarks: Joi.string().max(1000).allow('').optional(),
});

export const rejectBidBodySchema = Joi.object({
  remarks: Joi.string().max(1000).allow('').optional(),
});

// ============================================================================
// Endpoint Handlers
// ============================================================================

export async function getRequisitions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { error, value } = getRequisitionsSchema.validate(req.query);
    if (error) throw new CustomError(error.details[0].message, 400);

    const userId = req.context?.userId;
    const companyId = req.context?.userType === 'super_admin' ? null : (req.context?.companyId || null);

    if (!userId) throw new CustomError('Authentication required', 401);

    const result = await getRequisitionsForBidAnalysis(userId, companyId, value);
    res.json({ message: 'Requisitions retrieved successfully', data: result });
  } catch (error) { next(error); }
}

export async function getRequisitionDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { error, value } = requisitionIdParamSchema.validate(req.params);
    if (error) throw new CustomError(error.details[0].message, 400);

    const userId = req.context?.userId;
    if (!userId) throw new CustomError('Authentication required', 401);

    const companyId = req.context?.userType === 'super_admin' ? null : (req.context?.companyId || null);
    const result = await getRequisitionBidDetail(value.requisitionId, companyId);
    await logViewAction(value.requisitionId, userId);

    res.json({ message: 'Requisition detail retrieved successfully', data: result });
  } catch (error) { next(error); }
}

export async function getHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { error, value } = requisitionIdParamSchema.validate(req.params);
    if (error) throw new CustomError(error.details[0].message, 400);

    const companyId = req.context?.userType === 'super_admin' ? null : (req.context?.companyId || null);
    const result = await getActionHistory(value.requisitionId, companyId);

    res.json({ message: 'History retrieved successfully', data: result });
  } catch (error) { next(error); }
}

export async function selectBid(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { error: paramsError, value: params } = bidIdParamSchema.validate(req.params);
    if (paramsError) throw new CustomError(paramsError.details[0].message, 400);

    const { error: bodyError, value: body } = selectBidBodySchema.validate(req.body);
    if (bodyError) throw new CustomError(bodyError.details[0].message, 400);

    const userId = req.context?.userId;
    if (!userId) throw new CustomError('Authentication required', 401);

    const result = await selectBidForAnalysis(params.requisitionId, params.bidId, userId, body.remarks);
    res.json({ message: 'Vendor selected successfully', data: result });
  } catch (error) { next(error); }
}

export async function rejectBidHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { error: paramsError, value: params } = bidIdParamSchema.validate(req.params);
    if (paramsError) throw new CustomError(paramsError.details[0].message, 400);

    const { error: bodyError, value: body } = rejectBidBodySchema.validate(req.body);
    if (bodyError) throw new CustomError(bodyError.details[0].message, 400);

    const userId = req.context?.userId;
    if (!userId) throw new CustomError('Authentication required', 401);

    const result = await rejectBid(params.requisitionId, params.bidId, userId, body.remarks);
    res.json({ message: 'Bid rejected successfully', data: result });
  } catch (error) { next(error); }
}

export async function restoreBidHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { error, value } = bidIdParamSchema.validate(req.params);
    if (error) throw new CustomError(error.details[0].message, 400);

    const userId = req.context?.userId;
    if (!userId) throw new CustomError('Authentication required', 401);

    const result = await restoreBid(value.requisitionId, value.bidId, userId);
    res.json({ message: 'Bid restored successfully', data: result });
  } catch (error) { next(error); }
}

export async function exportPdfHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { error, value } = requisitionIdParamSchema.validate(req.params);
    if (error) throw new CustomError(error.details[0].message, 400);

    const userId = req.context?.userId;
    if (!userId) throw new CustomError('Authentication required', 401);

    await logExportAction(value.requisitionId, userId);
    res.json({ message: 'Export logged successfully', data: { success: true } });
  } catch (error) { next(error); }
}

export async function downloadPdfHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { error, value } = requisitionIdParamSchema.validate(req.params);
    if (error) throw new CustomError(error.details[0].message, 400);

    const userId = req.context?.userId;
    if (!userId) throw new CustomError('Authentication required', 401);

    const detail = await getRequisitionBidDetail(value.requisitionId);
    const negotiationHistory = await getNegotiationHistory(value.requisitionId);
    await logExportAction(value.requisitionId, userId);

    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 40,
      autoFirstPage: true,
      info: {
        Title: `Bid Comparison - ${detail.requisition.rfqId}`,
        Author: 'Accordo AI',
        Subject: 'Vendor Bid Comparison Report',
      },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="bid-comparison-${detail.requisition.rfqId}.pdf"`);
    doc.pipe(res);

    const colors = {
      primary: '#1a56db',
      primaryLight: '#3b82f6',
      primaryDark: '#1e40af',
      success: '#059669',
      successLight: '#10b981',
      warning: '#d97706',
      warningLight: '#f59e0b',
      danger: '#dc2626',
      text: '#1f2937',
      textLight: '#6b7280',
      border: '#e5e7eb',
      background: '#f9fafb',
      white: '#ffffff',
    };

    const pageWidth = 841.89;
    const pageHeight = 595.28;
    const margin = 40;
    const contentWidth = pageWidth - (margin * 2);

    const hasSelectedVendor = !!(detail.selectedBidId && detail.selectedVendorId);
    const hasNegotiationData = negotiationHistory.length > 0;
    let totalPages = 2;
    if (hasSelectedVendor) totalPages++;
    if (hasNegotiationData) totalPages += 3;
    let pageNumber = 0;

    const drawHeader = () => {
      const savedY = doc.y;
      doc.rect(0, 0, pageWidth, 70).fill(colors.primary);
      doc.rect(0, 65, pageWidth, 5).fill(colors.primaryLight);
      doc.fontSize(24).fillColor(colors.white).text('ACCORDO', margin, 20, { lineBreak: false });
      doc.fontSize(10).fillColor(colors.primaryLight).text(' AI', margin + 138, 30, { lineBreak: false });
      doc.fontSize(16).fillColor(colors.white).text('Bid Comparison Report', margin, 45, { lineBreak: false });
      doc.fontSize(10).fillColor(colors.white);
      doc.text(`RFQ: ${detail.requisition.rfqId}`, pageWidth - margin - 150, 25, { width: 150, align: 'right', lineBreak: false });
      doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageWidth - margin - 150, 40, { width: 150, align: 'right', lineBreak: false });
      doc.y = savedY;
    };

    const drawFooter = (pageNum: number, total: number) => {
      const savedY = doc.y;
      const footerY = pageHeight - 30;
      doc.fontSize(8).fillColor(colors.textLight);
      doc.text('Confidential - For Internal Use Only', margin, footerY, { width: contentWidth / 2, lineBreak: false });
      doc.text(`Page ${pageNum} of ${total}`, pageWidth - margin - 100, footerY, { width: 100, align: 'right', lineBreak: false });
      doc.text('Powered by Accordo AI', pageWidth / 2 - 50, footerY, { width: 100, align: 'center', lineBreak: false });
      doc.y = savedY;
    };

    const drawSectionHeader = (title: string, y: number) => {
      const savedY = doc.y;
      doc.rect(margin, y, contentWidth, 28).fill(colors.background);
      doc.rect(margin, y, 4, 28).fill(colors.primary);
      doc.fontSize(12).fillColor(colors.primary).text(title.toUpperCase(), margin + 15, y + 8, { lineBreak: false });
      doc.y = savedY;
      return y + 35;
    };

    // PAGE 1: Executive Summary
    pageNumber++;
    drawHeader();
    let currentY = 85;
    currentY = drawSectionHeader('Requisition Details', currentY);

    const cardWidth = (contentWidth - 30) / 4;
    const cardHeight = 60;

    const drawInfoCard = (x: number, y: number, label: string, cardValue: string, accent: string) => {
      const savedY = doc.y;
      doc.rect(x, y, cardWidth, cardHeight).fill(colors.white);
      doc.rect(x, y, cardWidth, cardHeight).stroke(colors.border);
      doc.rect(x, y, cardWidth, 4).fill(accent);
      doc.fontSize(9).fillColor(colors.textLight).text(label, x + 10, y + 12, { lineBreak: false });
      doc.fontSize(11).fillColor(colors.text).text(cardValue || 'N/A', x + 10, y + 28, { width: cardWidth - 20, ellipsis: true, lineBreak: false });
      doc.y = savedY;
    };

    drawInfoCard(margin, currentY, 'Subject', detail.requisition.subject, colors.primary);
    drawInfoCard(margin + cardWidth + 10, currentY, 'Project', detail.requisition.projectName || 'N/A', colors.primary);
    drawInfoCard(margin + (cardWidth + 10) * 2, currentY, 'Category', detail.requisition.category || 'N/A', colors.primary);
    drawInfoCard(margin + (cardWidth + 10) * 3, currentY, 'Deadline', detail.requisition.negotiationClosureDate ? new Date(detail.requisition.negotiationClosureDate).toLocaleDateString() : 'N/A', colors.warning);

    currentY += cardHeight + 20;
    currentY = drawSectionHeader('Bid Statistics', currentY);

    const statBoxWidth = (contentWidth - 40) / 5;
    const statBoxHeight = 70;

    const drawStatBox = (x: number, y: number, label: string, boxValue: string, subtext: string, color: string) => {
      const savedY = doc.y;
      doc.rect(x, y, statBoxWidth, statBoxHeight).fill(colors.white);
      doc.rect(x, y, statBoxWidth, statBoxHeight).stroke(colors.border);
      doc.fontSize(24).fillColor(color).text(boxValue, x, y + 12, { width: statBoxWidth, align: 'center', lineBreak: false });
      doc.fontSize(9).fillColor(colors.text).text(label, x, y + 42, { width: statBoxWidth, align: 'center', lineBreak: false });
      if (subtext) doc.fontSize(8).fillColor(colors.textLight).text(subtext, x, y + 54, { width: statBoxWidth, align: 'center', lineBreak: false });
      doc.y = savedY;
    };

    drawStatBox(margin, currentY, 'Total Vendors', String(detail.requisition.totalVendors), '', colors.primary);
    drawStatBox(margin + statBoxWidth + 10, currentY, 'Completed', String(detail.requisition.completedVendors), `${Math.round((detail.requisition.completedVendors / detail.requisition.totalVendors) * 100) || 0}%`, colors.success);
    drawStatBox(margin + (statBoxWidth + 10) * 2, currentY, 'Lowest Bid', detail.priceRange.lowest ? `$${detail.priceRange.lowest.toLocaleString()}` : 'N/A', '', colors.successLight);
    drawStatBox(margin + (statBoxWidth + 10) * 3, currentY, 'Highest Bid', detail.priceRange.highest ? `$${detail.priceRange.highest.toLocaleString()}` : 'N/A', '', colors.warning);
    drawStatBox(margin + (statBoxWidth + 10) * 4, currentY, 'Average', detail.priceRange.average ? `$${Math.round(detail.priceRange.average).toLocaleString()}` : 'N/A', '', colors.textLight);

    currentY += statBoxHeight + 20;

    if (detail.priceRange.targetPrice || detail.priceRange.maxAcceptablePrice) {
      doc.rect(margin, currentY, contentWidth, 35).fill('#eff6ff');
      doc.rect(margin, currentY, contentWidth, 35).stroke('#bfdbfe');
      doc.fontSize(10).fillColor(colors.primary);
      let priceText = '';
      if (detail.priceRange.targetPrice) priceText += `Target Price: $${detail.priceRange.targetPrice.toLocaleString()}`;
      if (detail.priceRange.maxAcceptablePrice) {
        priceText += priceText ? '   |   ' : '';
        priceText += `Max Acceptable: $${detail.priceRange.maxAcceptablePrice.toLocaleString()}`;
      }
      doc.text(priceText, margin + 15, currentY + 12, { lineBreak: false });
      currentY += 45;
    }

    currentY = drawSectionHeader('Top Ranked Bids (L1, L2, L3)', currentY);
    const topBidWidth = (contentWidth - 20) / 3;
    const topBidHeight = 120;

    detail.topBids.slice(0, 3).forEach((bid: TopBidInfo, index: number) => {
      const savedY = doc.y;
      const x = margin + (topBidWidth + 10) * index;
      const rankColors = [colors.success, colors.primaryLight, colors.warning];
      const rankLabels = ['L1 - BEST', 'L2', 'L3'];
      const rankColor = rankColors[index] || colors.textLight;

      doc.rect(x, currentY, topBidWidth, topBidHeight).fill(colors.white);
      doc.rect(x, currentY, topBidWidth, topBidHeight).stroke(colors.border);
      doc.rect(x, currentY, topBidWidth, 25).fill(rankColor);
      doc.fontSize(10).fillColor(colors.white).text(rankLabels[index], x + 10, currentY + 7, { lineBreak: false });

      if (bid.isRejected) {
        doc.rect(x + topBidWidth - 60, currentY + 4, 50, 17).fill(colors.danger);
        doc.fontSize(8).fillColor(colors.white).text('REJECTED', x + topBidWidth - 55, currentY + 8, { lineBreak: false });
      }

      doc.fontSize(11).fillColor(colors.text).text(bid.vendorName, x + 10, currentY + 35, { width: topBidWidth - 20, ellipsis: true, lineBreak: false });
      doc.fontSize(9).fillColor(colors.textLight).text(bid.vendorEmail, x + 10, currentY + 50, { width: topBidWidth - 20, ellipsis: true, lineBreak: false });
      doc.fontSize(18).fillColor(rankColor).text(`$${bid.finalPrice?.toLocaleString() || 'N/A'}`, x + 10, currentY + 70, { lineBreak: false });
      doc.fontSize(8).fillColor(colors.textLight);
      doc.text(`Terms: ${bid.paymentTerms || 'N/A'}`, x + 10, currentY + 95, { lineBreak: false });
      doc.text(`Utility: ${bid.utilityScore ? `${(bid.utilityScore * 100).toFixed(1)}%` : 'N/A'}`, x + topBidWidth / 2, currentY + 95, { lineBreak: false });
      doc.y = savedY;
    });

    currentY += topBidHeight + 10;
    drawFooter(pageNumber, totalPages);

    // PAGE 2: All Bids Comparison Table
    doc.addPage();
    pageNumber++;
    drawHeader();
    currentY = 85;
    currentY = drawSectionHeader('Complete Bid Comparison', currentY);

    const tableHeaders = ['Rank', 'Vendor Name', 'Email', 'Price', 'Payment Terms', 'Delivery', 'Utility', 'Status'];
    const colWidths = [45, 130, 160, 90, 100, 85, 70, 80];
    const rowHeight = 28;

    const drawTableHeader = () => {
      const savedY = doc.y;
      doc.rect(margin, currentY, contentWidth, rowHeight).fill(colors.primary);
      let tx = margin + 5;
      doc.fontSize(9).fillColor(colors.white);
      tableHeaders.forEach((header, i) => {
        doc.text(header, tx, currentY + 9, { width: colWidths[i] - 10, lineBreak: false });
        tx += colWidths[i];
      });
      doc.y = savedY;
      currentY += rowHeight;
    };

    drawTableHeader();

    detail.allBids.forEach((bid, index) => {
      if (currentY > pageHeight - 60) {
        drawFooter(pageNumber, totalPages);
        doc.addPage();
        pageNumber++;
        totalPages++;
        drawHeader();
        currentY = 85;
        drawTableHeader();
      }

      const isSelected = bid.bidId === detail.selectedBidId;
      const bgColor = isSelected ? '#dcfce7' : (index % 2 === 0 ? colors.white : colors.background);
      const savedY = doc.y;
      doc.rect(margin, currentY, contentWidth, rowHeight).fill(bgColor);
      doc.rect(margin, currentY, contentWidth, rowHeight).stroke(colors.border);
      if (isSelected) doc.rect(margin, currentY, 4, rowHeight).fill(colors.success);

      let x = margin + 5;
      doc.fontSize(9).fillColor(bid.isRejected ? colors.textLight : colors.text);
      const statusText = isSelected ? 'SELECTED' : (bid.isRejected ? 'Rejected' : (bid.dealStatus || 'Pending'));
      const statusColor = isSelected ? colors.success : (bid.isRejected ? colors.danger : colors.text);

      const rowData = [
        `#${bid.rank}`,
        bid.vendorName,
        bid.vendorEmail,
        bid.finalPrice ? `$${bid.finalPrice.toLocaleString()}` : 'N/A',
        bid.paymentTerms || 'N/A',
        bid.deliveryDate ? new Date(bid.deliveryDate).toLocaleDateString() : 'N/A',
        bid.utilityScore ? `${(bid.utilityScore * 100).toFixed(1)}%` : 'N/A',
        statusText,
      ];

      rowData.forEach((cell, i) => {
        if (i === rowData.length - 1) doc.fillColor(statusColor);
        doc.text(cell, x, currentY + 9, { width: colWidths[i] - 10, ellipsis: true, lineBreak: false });
        x += colWidths[i];
      });
      doc.y = savedY;
      currentY += rowHeight;
    });

    drawFooter(pageNumber, totalPages);

    // PAGE 3: Selected Vendor Details (if awarded)
    if (hasSelectedVendor) {
      doc.addPage();
      pageNumber++;
      drawHeader();
      currentY = 85;

      const selectedBid = detail.allBids.find(b => b.bidId === detail.selectedBidId);
      currentY = drawSectionHeader('Selected Vendor - Award Details', currentY);

      doc.rect(margin, currentY, contentWidth, 50).fill('#dcfce7');
      doc.rect(margin, currentY, contentWidth, 50).stroke('#86efac');
      doc.rect(margin, currentY, 5, 50).fill(colors.success);
      doc.fontSize(14).fillColor(colors.success).text('VENDOR SELECTED', margin + 20, currentY + 10, { lineBreak: false });
      doc.fontSize(18).fillColor(colors.text).text(detail.selectedVendorName || 'N/A', margin + 20, currentY + 28, { lineBreak: false });

      doc.rect(pageWidth - margin - 100, currentY + 15, 90, 25).fill(colors.success);
      doc.fontSize(10).fillColor(colors.white).text('AWARDED', pageWidth - margin - 95, currentY + 22, { lineBreak: false });
      currentY += 65;

      if (selectedBid) {
        currentY = drawSectionHeader('Selected Vendor Offer Details', currentY);
        const leftColX = margin;
        const rightColX = margin + contentWidth / 2 + 10;
        const detailRowHeight = 30;

        const drawDetailRow = (dx: number, dy: number, label: string, val: string, highlight?: boolean) => {
          const savedDY = doc.y;
          const w = contentWidth / 2 - 20;
          if (highlight) doc.rect(dx, dy, w, detailRowHeight).fill('#fef3c7');
          doc.rect(dx, dy, w, detailRowHeight).stroke(colors.border);
          doc.fontSize(9).fillColor(colors.textLight).text(label, dx + 10, dy + 5, { lineBreak: false });
          doc.fontSize(11).fillColor(colors.text).text(val, dx + 10, dy + 17, { lineBreak: false });
          doc.y = savedDY;
        };

        drawDetailRow(leftColX, currentY, 'Vendor Name', selectedBid.vendorName);
        drawDetailRow(leftColX, currentY + detailRowHeight, 'Email', selectedBid.vendorEmail);
        drawDetailRow(leftColX, currentY + detailRowHeight * 2, 'Final Price', selectedBid.finalPrice ? `$${selectedBid.finalPrice.toLocaleString()}` : 'N/A', true);
        drawDetailRow(leftColX, currentY + detailRowHeight * 3, 'Unit Price', selectedBid.unitPrice ? `$${selectedBid.unitPrice.toLocaleString()}` : 'N/A');

        drawDetailRow(rightColX, currentY, 'Payment Terms', selectedBid.paymentTerms || 'N/A');
        drawDetailRow(rightColX, currentY + detailRowHeight, 'Delivery Date', selectedBid.deliveryDate ? new Date(selectedBid.deliveryDate).toLocaleDateString() : 'N/A');
        drawDetailRow(rightColX, currentY + detailRowHeight * 2, 'Utility Score', selectedBid.utilityScore ? `${(selectedBid.utilityScore * 100).toFixed(1)}%` : 'N/A', true);
        drawDetailRow(rightColX, currentY + detailRowHeight * 3, 'Deal Status', selectedBid.dealStatus || 'N/A');

        currentY += detailRowHeight * 4 + 20;

        if (detail.priceRange.highest && selectedBid.finalPrice) {
          currentY = drawSectionHeader('Cost Analysis', currentY);
          const savings = detail.priceRange.highest - selectedBid.finalPrice;
          const savingsPercent = ((savings / detail.priceRange.highest) * 100).toFixed(1);
          const vsAverage = detail.priceRange.average ? (detail.priceRange.average - selectedBid.finalPrice) : null;
          const vsTarget = detail.priceRange.targetPrice ? (detail.priceRange.targetPrice - selectedBid.finalPrice) : null;

          const analysisBoxWidth = (contentWidth - 30) / 4;
          const analysisBoxHeight = 70;

          const drawAnalysisBox = (ax: number, ay: number, label: string, val: string, subtext: string, positive: boolean) => {
            const savedAY = doc.y;
            doc.rect(ax, ay, analysisBoxWidth, analysisBoxHeight).fill(positive ? '#dcfce7' : '#fef2f2');
            doc.rect(ax, ay, analysisBoxWidth, analysisBoxHeight).stroke(positive ? '#86efac' : '#fecaca');
            doc.fontSize(18).fillColor(positive ? colors.success : colors.danger).text(val, ax, ay + 15, { width: analysisBoxWidth, align: 'center', lineBreak: false });
            doc.fontSize(9).fillColor(colors.text).text(label, ax, ay + 40, { width: analysisBoxWidth, align: 'center', lineBreak: false });
            doc.fontSize(8).fillColor(colors.textLight).text(subtext, ax, ay + 52, { width: analysisBoxWidth, align: 'center', lineBreak: false });
            doc.y = savedAY;
          };

          drawAnalysisBox(margin, currentY, 'vs Highest Bid', `$${savings.toLocaleString()}`, `${savingsPercent}% savings`, savings >= 0);
          if (vsAverage !== null) drawAnalysisBox(margin + analysisBoxWidth + 10, currentY, 'vs Average', `$${Math.round(vsAverage).toLocaleString()}`, vsAverage >= 0 ? 'Below average' : 'Above average', vsAverage >= 0);
          if (vsTarget !== null) drawAnalysisBox(margin + (analysisBoxWidth + 10) * 2, currentY, 'vs Target', `$${Math.round(vsTarget).toLocaleString()}`, vsTarget >= 0 ? 'Under target' : 'Over target', vsTarget >= 0);
          drawAnalysisBox(margin + (analysisBoxWidth + 10) * 3, currentY, 'Award Price', `$${selectedBid.finalPrice.toLocaleString()}`, 'Final negotiated', true);
        }
      }
      drawFooter(pageNumber, totalPages);
    }

    // NEW PAGES: Only if negotiation data exists
    if (hasNegotiationData) {
      doc.addPage();
      pageNumber++;
      drawHeader();
      currentY = 85;
      currentY = drawSectionHeader('Negotiation Summary', currentY);

      const negHeaders = ['Vendor', 'Status', 'Mode', 'Price Journey', 'Rounds', 'Utility', 'Payment Terms'];
      const negColWidths = [140, 80, 80, 170, 70, 70, 150];
      const negRowHeight = 30;

      const drawNegTableHeader = () => {
        const savedY = doc.y;
        doc.rect(margin, currentY, contentWidth, negRowHeight).fill(colors.primary);
        let tx = margin + 5;
        doc.fontSize(8).fillColor(colors.white);
        negHeaders.forEach((header, i) => {
          doc.text(header, tx, currentY + 10, { width: negColWidths[i] - 10, lineBreak: false });
          tx += negColWidths[i];
        });
        doc.y = savedY;
        currentY += negRowHeight;
      };

      drawNegTableHeader();

      negotiationHistory.forEach((vendor: VendorNegotiationSummary, index: number) => {
        if (currentY > pageHeight - 60) {
          drawFooter(pageNumber, totalPages);
          doc.addPage();
          pageNumber++;
          totalPages++;
          drawHeader();
          currentY = 85;
          drawNegTableHeader();
        }

        const isSelected = vendor.dealId === detail.selectedBidId;
        const bgColor = isSelected ? '#dcfce7' : (index % 2 === 0 ? colors.white : colors.background);

        const savedY = doc.y;
        doc.rect(margin, currentY, contentWidth, negRowHeight).fill(bgColor);
        doc.rect(margin, currentY, contentWidth, negRowHeight).stroke(colors.border);
        if (isSelected) doc.rect(margin, currentY, 4, negRowHeight).fill(colors.success);

        let x = margin + 5;
        doc.fontSize(8).fillColor(colors.text);

        const statusColor = isSelected ? colors.success
          : (vendor.dealStatus === 'ACCEPTED' ? colors.success
            : (vendor.dealStatus === 'WALKED_AWAY' ? colors.danger : colors.text));

        const priceJourneyText = vendor.startingPrice && vendor.finalPrice
          ? `$${vendor.startingPrice.toLocaleString()} -> $${vendor.finalPrice.toLocaleString()} (-${vendor.priceReductionPercent}%)`
          : (vendor.finalPrice ? `$${vendor.finalPrice.toLocaleString()}` : 'N/A');

        const rowData = [
          vendor.vendorName,
          vendor.dealStatus,
          vendor.mode || 'AI',
          priceJourneyText,
          `${vendor.roundsTaken}/${vendor.maxRounds}`,
          vendor.utilityScore != null ? `${(vendor.utilityScore * 100).toFixed(1)}%` : 'N/A',
          vendor.paymentTerms || 'N/A',
        ];

        rowData.forEach((cell, i) => {
          if (i === 1) doc.fillColor(statusColor);
          doc.text(cell, x, currentY + 10, { width: negColWidths[i] - 10, ellipsis: true, lineBreak: false });
          if (i === 1) doc.fillColor(colors.text);
          x += negColWidths[i];
        });
        doc.y = savedY;
        currentY += negRowHeight;
      });

      drawFooter(pageNumber, totalPages);

      // PRICE HISTORY COMPARISON PAGE
      doc.addPage();
      pageNumber++;
      drawHeader();
      currentY = 85;
      currentY = drawSectionHeader('Price Concession Comparison', currentY);

      const subHeaderWidth = contentWidth;
      const subHeaderHeight = 25;
      doc.rect(margin, currentY, subHeaderWidth, subHeaderHeight).fill('#eff6ff');
      doc.rect(margin, currentY, subHeaderWidth, subHeaderHeight).stroke('#bfdbfe');
      doc.fontSize(9).fillColor(colors.primary).text(
        'Comparison of initial quotes vs. final negotiated prices across all participating vendors',
        margin + 10, currentY + 7, { lineBreak: false }
      );
      currentY += subHeaderHeight + 15;

      const cardGridWidth = (contentWidth - 20) / 3;
      const cardGridHeight = 110;

      negotiationHistory.forEach((vendor: VendorNegotiationSummary, index: number) => {
        const col = index % 3;
        const row = Math.floor(index / 3);
        const cardX = margin + col * (cardGridWidth + 10);
        const cardY = currentY + row * (cardGridHeight + 10);

        if (cardY + cardGridHeight > pageHeight - 50) return;

        const isSelected = vendor.dealId === detail.selectedBidId;
        const savedY = doc.y;

        doc.rect(cardX, cardY, cardGridWidth, cardGridHeight).fill(colors.white);
        doc.rect(cardX, cardY, cardGridWidth, cardGridHeight).stroke(isSelected ? colors.success : colors.border);
        if (isSelected) doc.rect(cardX, cardY, cardGridWidth, 4).fill(colors.success);

        doc.fontSize(10).fillColor(colors.text).text(vendor.vendorName, cardX + 8, cardY + 8, { width: cardGridWidth - 16, ellipsis: true, lineBreak: false });

        doc.fontSize(7).fillColor(colors.textLight);
        doc.text(`Status: ${vendor.dealStatus}`, cardX + 8, cardY + 22, { lineBreak: false });

        doc.fontSize(8).fillColor(colors.textLight).text('Start:', cardX + 8, cardY + 36, { lineBreak: false });
        doc.fontSize(9).fillColor(colors.text).text(vendor.startingPrice ? `$${vendor.startingPrice.toLocaleString()}` : 'N/A', cardX + 40, cardY + 35, { lineBreak: false });

        doc.fontSize(8).fillColor(colors.textLight).text('Final:', cardX + 8, cardY + 51, { lineBreak: false });
        doc.fontSize(11).fillColor(isSelected ? colors.success : colors.primary).text(vendor.finalPrice ? `$${vendor.finalPrice.toLocaleString()}` : 'N/A', cardX + 40, cardY + 49, { lineBreak: false });

        const reduction = vendor.priceReductionPercent ?? 0;
        doc.rect(cardX + 8, cardY + 67, cardGridWidth - 16, 16).fill(reduction > 0 ? '#dcfce7' : colors.background);
        doc.fontSize(8).fillColor(reduction > 0 ? colors.success : colors.textLight).text(
          reduction > 0 ? `Reduced by ${reduction}% (${vendor.roundsTaken} rounds)` : `No price change (${vendor.roundsTaken} rounds)`,
          cardX + 12, cardY + 71, { width: cardGridWidth - 24, ellipsis: true, lineBreak: false }
        );

        doc.fontSize(7).fillColor(colors.textLight).text(
          `Strategy: ${(vendor as any).negotiationStrategy || 'Standard'}`,
          cardX + 8, cardY + 90, { width: cardGridWidth - 16, ellipsis: true, lineBreak: false }
        );
        doc.y = savedY;
      });

      const totalRows = Math.ceil(negotiationHistory.length / 3);
      currentY += totalRows * (cardGridHeight + 10) + 10;

      drawFooter(pageNumber, totalPages);

      // RECOMMENDATIONS & AI ANALYSIS PAGE
      doc.addPage();
      pageNumber++;
      drawHeader();
      currentY = 85;

      currentY = drawSectionHeader('Strategic Recommendations & AI Analysis', currentY);

      const recBoxWidth = (contentWidth - 30) / 4;
      const recBoxHeight = 85;

      const drawRecBox = (rx: number, ry: number, title: string, mainVal: string, sub: string, accentColor: string) => {
        const savedRY = doc.y;
        doc.rect(rx, ry, recBoxWidth, recBoxHeight).fill(colors.white);
        doc.rect(rx, ry, recBoxWidth, recBoxHeight).stroke(colors.border);
        doc.rect(rx, ry, recBoxWidth, 4).fill(accentColor);
        doc.fontSize(9).fillColor(colors.textLight).text(title, rx + 8, ry + 10, { width: recBoxWidth - 16, ellipsis: true, lineBreak: false });
        doc.fontSize(14).fillColor(accentColor).text(mainVal, rx + 8, ry + 26, { width: recBoxWidth - 16, ellipsis: true, lineBreak: false });
        doc.fontSize(8).fillColor(colors.text).text(sub, rx + 8, ry + 48, { width: recBoxWidth - 16, height: 32, ellipsis: true, lineBreak: false });
        doc.y = savedRY;
      };

      const topUtilityVendor = negotiationHistory.reduce((best, v) =>
        (v.utilityScore ?? 0) > (best.utilityScore ?? 0) ? v : best, negotiationHistory[0]);

      drawRecBox(
        margin, currentY,
        'Highest Value (Utility)',
        topUtilityVendor?.utilityScore != null ? `${(topUtilityVendor.utilityScore * 100).toFixed(1)}%` : 'N/A',
        topUtilityVendor?.vendorName || '',
        colors.success
      );

      const l1Bid = detail.topBids[0];
      drawRecBox(
        margin + recBoxWidth + 10, currentY,
        'Most Competitive Price',
        l1Bid ? `$${l1Bid.finalPrice?.toLocaleString() || 'N/A'}` : 'N/A',
        l1Bid?.vendorName || '',
        colors.primaryLight
      );

      const walkedAway = negotiationHistory.filter(v => v.dealStatus === 'WALKED_AWAY').length;
      const lowUtility = negotiationHistory.filter(v => v.utilityScore != null && v.utilityScore < 0.3).length;
      drawRecBox(
        margin + (recBoxWidth + 10) * 2, currentY,
        'Risk Flags',
        `${walkedAway + lowUtility}`,
        `${walkedAway} walked away, ${lowUtility} low utility`,
        walkedAway + lowUtility > 0 ? colors.danger : colors.success
      );

      const lowestPrice = detail.priceRange.lowest ?? 0;
      const highestPrice = detail.priceRange.highest ?? 0;
      const spread = highestPrice - lowestPrice;
      const targetDiff = detail.priceRange.targetPrice && lowestPrice > 0 ? detail.priceRange.targetPrice - lowestPrice : null;
      drawRecBox(
        margin + (recBoxWidth + 10) * 3, currentY,
        'Savings Potential',
        spread > 0 ? `$${spread.toLocaleString()}` : 'N/A',
        targetDiff != null ? `${targetDiff >= 0 ? '$' + Math.round(targetDiff).toLocaleString() + ' under' : '$' + Math.round(Math.abs(targetDiff)).toLocaleString() + ' over'} target` : `Spread across ${negotiationHistory.length} vendors`,
        colors.warning
      );

      currentY += recBoxHeight + 20;
      currentY = drawSectionHeader('AI-Generated Summary', currentY);

      let narrative = '';
      try {
        const vendorDataForLlm = negotiationHistory.map(v => ({
          vendor: v.vendorName,
          status: v.dealStatus,
          startPrice: v.startingPrice,
          finalPrice: v.finalPrice,
          reduction: `${v.priceReductionPercent}%`,
          rounds: `${v.roundsTaken}/${v.maxRounds}`,
          utility: v.utilityScore != null ? `${(v.utilityScore * 100).toFixed(1)}%` : 'N/A',
        }));

        const llmPromise = chatCompletion(
          [
            {
              role: 'system',
              content: 'You are a procurement analyst. Summarize the following vendor negotiation data in 1-2 concise paragraphs. Highlight the best value vendor, key risks, and a recommended next step. Do not use markdown formatting.',
            },
            {
              role: 'user',
              content: JSON.stringify({
                rfq: detail.requisition.rfqId,
                subject: detail.requisition.subject,
                vendors: vendorDataForLlm,
                lowestPrice: detail.priceRange.lowest,
                highestPrice: detail.priceRange.highest,
                targetPrice: detail.priceRange.targetPrice,
              }),
            },
          ],
          { temperature: 0.3, maxTokens: 512, retries: 1 }
        );

        const timeoutPromise = new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('LLM timeout')), 10000)
        );

        narrative = await Promise.race([llmPromise, timeoutPromise]);
      } catch {
        narrative = '';
      }

      if (narrative) {
        doc.rect(margin, currentY, contentWidth, 2).fill(colors.primaryLight);
        currentY += 8;
        const maxNarrativeHeight = pageHeight - currentY - 60;
        doc.fontSize(9).fillColor(colors.text).text(narrative, margin + 5, currentY, {
          width: contentWidth - 10,
          lineBreak: true,
          height: maxNarrativeHeight,
          ellipsis: true,
        });
        currentY = Math.min(doc.y + 10, pageHeight - 50);
      } else {
        const savedY = doc.y;
        doc.rect(margin, currentY, contentWidth, 40).fill(colors.background);
        doc.rect(margin, currentY, contentWidth, 40).stroke(colors.border);
        doc.fontSize(9).fillColor(colors.textLight).text(
          'AI narrative unavailable — analysis above is based on negotiation data only.',
          margin + 15, currentY + 14, { width: contentWidth - 30, lineBreak: false }
        );
        doc.y = savedY;
      }

      drawFooter(pageNumber, totalPages);
    }

    doc.end();
  } catch (error) { next(error); }
}

// ============================================================================
// Routes Setup
// ============================================================================

router.use(authMiddleware);
router.get('/requisitions', getRequisitions);
router.get('/requisitions/:requisitionId', getRequisitionDetail);
router.get('/requisitions/:requisitionId/history', getHistory);
router.get('/requisitions/:requisitionId/pdf', downloadPdfHandler);
router.post('/requisitions/:requisitionId/select/:bidId', selectBid);
router.post('/requisitions/:requisitionId/reject/:bidId', rejectBidHandler);
router.post('/requisitions/:requisitionId/restore/:bidId', restoreBidHandler);
router.post('/requisitions/:requisitionId/export', exportPdfHandler);

export default router;
