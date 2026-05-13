import type { Request, Response, NextFunction } from 'express';
import PDFDocument from 'pdfkit';
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
  extractPrice,
} from './bid-analysis.service.js';
import {
  getRequisitionsSchema,
  requisitionIdParamSchema,
  bidIdParamSchema,
  selectBidBodySchema,
  rejectBidBodySchema,
} from './bid-analysis.validator.js';
import { CustomError } from '../../utils/custom-error.js';
import type { TopBidInfo, VendorNegotiationSummary } from './bid-analysis.types.js';
import { chatCompletion } from '../../services/llm.service.js';

/**
 * GET /api/bid-analysis/requisitions
 * List requisitions with bid summaries
 */
export async function getRequisitions(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { error, value } = getRequisitionsSchema.validate(req.query);
    if (error) {
      throw new CustomError(error.details[0].message, 400);
    }

    const userId = req.context?.userId;
    // Super admin bypasses company isolation (sees all companies).
    const companyId = req.context?.userType === 'super_admin' ? null : (req.context?.companyId || null);

    if (!userId) {
      throw new CustomError('Authentication required', 401);
    }

    const result = await getRequisitionsForBidAnalysis(userId, companyId, value);

    res.json({
      message: 'Requisitions retrieved successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/bid-analysis/requisitions/:requisitionId
 * Get detailed bid analysis for a requisition
 */
export async function getRequisitionDetail(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { error, value } = requisitionIdParamSchema.validate(req.params);
    if (error) {
      throw new CustomError(error.details[0].message, 400);
    }

    const userId = req.context?.userId;
    if (!userId) {
      throw new CustomError('Authentication required', 401);
    }

    // Super admin bypasses company isolation (sees all companies).
    const companyId = req.context?.userType === 'super_admin' ? null : (req.context?.companyId || null);
    const result = await getRequisitionBidDetail(value.requisitionId, companyId);

    // Log view action
    await logViewAction(value.requisitionId, userId);

    res.json({
      message: 'Requisition detail retrieved successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/bid-analysis/requisitions/:requisitionId/history
 * Get action history for a requisition
 */
export async function getHistory(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { error, value } = requisitionIdParamSchema.validate(req.params);
    if (error) {
      throw new CustomError(error.details[0].message, 400);
    }

    // Super admin bypasses company isolation (sees all companies).
    const companyId = req.context?.userType === 'super_admin' ? null : (req.context?.companyId || null);
    const result = await getActionHistory(value.requisitionId, companyId);

    res.json({
      message: 'History retrieved successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/bid-analysis/requisitions/:requisitionId/select/:bidId
 * Select a bid (award to vendor)
 */
export async function selectBid(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { error: paramsError, value: params } = bidIdParamSchema.validate(req.params);
    if (paramsError) {
      throw new CustomError(paramsError.details[0].message, 400);
    }

    const { error: bodyError, value: body } = selectBidBodySchema.validate(req.body);
    if (bodyError) {
      throw new CustomError(bodyError.details[0].message, 400);
    }

    const userId = req.context?.userId;
    if (!userId) {
      throw new CustomError('Authentication required', 401);
    }

    const result = await selectBidForAnalysis(
      params.requisitionId,
      params.bidId,
      userId,
      body.remarks
    );

    res.json({
      message: 'Vendor selected successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/bid-analysis/requisitions/:requisitionId/reject/:bidId
 * Reject a bid
 */
export async function rejectBidHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { error: paramsError, value: params } = bidIdParamSchema.validate(req.params);
    if (paramsError) {
      throw new CustomError(paramsError.details[0].message, 400);
    }

    const { error: bodyError, value: body } = rejectBidBodySchema.validate(req.body);
    if (bodyError) {
      throw new CustomError(bodyError.details[0].message, 400);
    }

    const userId = req.context?.userId;
    if (!userId) {
      throw new CustomError('Authentication required', 401);
    }

    const result = await rejectBid(
      params.requisitionId,
      params.bidId,
      userId,
      body.remarks
    );

    res.json({
      message: 'Bid rejected successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/bid-analysis/requisitions/:requisitionId/restore/:bidId
 * Restore a rejected bid
 */
export async function restoreBidHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { error, value } = bidIdParamSchema.validate(req.params);
    if (error) {
      throw new CustomError(error.details[0].message, 400);
    }

    const userId = req.context?.userId;
    if (!userId) {
      throw new CustomError('Authentication required', 401);
    }

    const result = await restoreBid(
      value.requisitionId,
      value.bidId,
      userId
    );

    res.json({
      message: 'Bid restored successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/bid-analysis/requisitions/:requisitionId/export
 * Log export action (PDF download happens client-side via existing endpoint)
 */
export async function exportPdfHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { error, value } = requisitionIdParamSchema.validate(req.params);
    if (error) {
      throw new CustomError(error.details[0].message, 400);
    }

    const userId = req.context?.userId;
    if (!userId) {
      throw new CustomError('Authentication required', 401);
    }

    await logExportAction(value.requisitionId, userId);

    res.json({
      message: 'Export logged successfully',
      data: { success: true },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/bid-analysis/requisitions/:requisitionId/pdf
 * Generate and download PDF on-the-fly with enhanced layout
 */
export async function downloadPdfHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { error, value } = requisitionIdParamSchema.validate(req.params);
    if (error) {
      throw new CustomError(error.details[0].message, 400);
    }

    const userId = req.context?.userId;
    if (!userId) {
      throw new CustomError('Authentication required', 401);
    }

    // Get requisition data
    const detail = await getRequisitionBidDetail(value.requisitionId);

    // Fetch negotiation history for new pages
    const negotiationHistory = await getNegotiationHistory(value.requisitionId);

    // Log export action
    await logExportAction(value.requisitionId, userId);

    // Generate PDF in landscape orientation for better table display
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

    // Set headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="bid-comparison-${detail.requisition.rfqId}.pdf"`
    );

    // Pipe PDF to response
    doc.pipe(res);

    // Brand colors
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

    const pageWidth = 841.89; // A4 landscape width
    const pageHeight = 595.28; // A4 landscape height
    const margin = 40;
    const contentWidth = pageWidth - (margin * 2);

    // Pre-calculate total pages
    const hasSelectedVendor = !!(detail.selectedBidId && detail.selectedVendorId);
    const hasNegotiationData = negotiationHistory.length > 0;
    let totalPages = 2; // Page 1 (summary) + Page 2 (table)
    if (hasSelectedVendor) totalPages++;
    if (hasNegotiationData) totalPages += 3; // negotiation summary + price history + AI recommendation
    let pageNumber = 0;

    // Helper functions — all text calls use lineBreak:false to prevent cursor advancement
    const drawHeader = () => {
      const savedY = doc.y;
      doc.rect(0, 0, pageWidth, 70).fill(colors.primary);
      doc.rect(0, 65, pageWidth, 5).fill(colors.primaryLight);

      // Company branding — two separate positioned calls (no "continued")
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

    // ==================== PAGE 1: Executive Summary ====================
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
      if (subtext) {
        doc.fontSize(8).fillColor(colors.textLight).text(subtext, x, y + 54, { width: statBoxWidth, align: 'center', lineBreak: false });
      }
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
      if (detail.priceRange.targetPrice) {
        priceText += `Target Price: $${detail.priceRange.targetPrice.toLocaleString()}`;
      }
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

    // ==================== PAGE 2: All Bids Comparison Table ====================
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
        totalPages++; // extra overflow page
        drawHeader();
        currentY = 85;
        drawTableHeader();
      }

      const isSelected = bid.bidId === detail.selectedBidId;
      const bgColor = isSelected ? '#dcfce7' : (index % 2 === 0 ? colors.white : colors.background);

      const savedY = doc.y;
      doc.rect(margin, currentY, contentWidth, rowHeight).fill(bgColor);
      doc.rect(margin, currentY, contentWidth, rowHeight).stroke(colors.border);

      if (isSelected) {
        doc.rect(margin, currentY, 4, rowHeight).fill(colors.success);
      }

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
        if (i === rowData.length - 1) {
          doc.fillColor(statusColor);
        }
        doc.text(cell, x, currentY + 9, { width: colWidths[i] - 10, ellipsis: true, lineBreak: false });
        x += colWidths[i];
      });
      doc.y = savedY;

      currentY += rowHeight;
    });

    drawFooter(pageNumber, totalPages);

    // ==================== PAGE 3: Selected Vendor Details (if awarded) ====================
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
          if (highlight) {
            doc.rect(dx, dy, w, detailRowHeight).fill('#fef3c7');
          }
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
          if (vsAverage !== null) {
            drawAnalysisBox(margin + analysisBoxWidth + 10, currentY, 'vs Average', `$${Math.round(vsAverage).toLocaleString()}`, vsAverage >= 0 ? 'Below average' : 'Above average', vsAverage >= 0);
          }
          if (vsTarget !== null) {
            drawAnalysisBox(margin + (analysisBoxWidth + 10) * 2, currentY, 'vs Target', `$${Math.round(vsTarget).toLocaleString()}`, vsTarget >= 0 ? 'Under target' : 'Over target', vsTarget >= 0);
          }
          drawAnalysisBox(margin + (analysisBoxWidth + 10) * 3, currentY, 'Award Price', `$${selectedBid.finalPrice.toLocaleString()}`, 'Final negotiated', true);
        }
      }

      drawFooter(pageNumber, totalPages);
    }

    // ==================== NEW PAGES: Only if negotiation data exists ====================
    if (hasNegotiationData) {

      // ==================== NEGOTIATION SUMMARY PAGE ====================
      doc.addPage();
      pageNumber++;
      drawHeader();
      currentY = 85;

      currentY = drawSectionHeader('Negotiation Summary', currentY);

      // Negotiation summary table
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

        const savedY = doc.y;
        const bgColor = index % 2 === 0 ? colors.white : colors.background;
        doc.rect(margin, currentY, contentWidth, negRowHeight).fill(bgColor);
        doc.rect(margin, currentY, contentWidth, negRowHeight).stroke(colors.border);

        let x = margin + 5;

        // Vendor name + email
        doc.fontSize(8).fillColor(colors.text);
        doc.text(vendor.vendorName, x, currentY + 5, { width: negColWidths[0] - 10, ellipsis: true, lineBreak: false });
        doc.fontSize(6).fillColor(colors.textLight);
        doc.text(vendor.vendorEmail, x, currentY + 17, { width: negColWidths[0] - 10, ellipsis: true, lineBreak: false });
        x += negColWidths[0];

        // Status (color-coded)
        const statusColors: Record<string, string> = {
          ACCEPTED: colors.success,
          WALKED_AWAY: colors.danger,
          ESCALATED: colors.warning,
          NEGOTIATING: colors.primaryLight,
        };
        doc.fontSize(8).fillColor(statusColors[vendor.dealStatus] || colors.text);
        doc.text(vendor.dealStatus, x, currentY + 10, { width: negColWidths[1] - 10, lineBreak: false });
        x += negColWidths[1];

        // Mode
        doc.fontSize(8).fillColor(colors.text);
        doc.text(vendor.mode, x, currentY + 10, { width: negColWidths[2] - 10, lineBreak: false });
        x += negColWidths[2];

        // Price journey
        const journey = vendor.startingPrice > 0
          ? `$${vendor.startingPrice.toLocaleString()} → $${vendor.finalPrice.toLocaleString()} (${vendor.priceReductionPercent}%)`
          : vendor.finalPrice > 0 ? `$${vendor.finalPrice.toLocaleString()}` : 'N/A';
        doc.fontSize(8).fillColor(vendor.priceReductionPercent > 0 ? colors.success : colors.text);
        doc.text(journey, x, currentY + 10, { width: negColWidths[3] - 10, ellipsis: true, lineBreak: false });
        x += negColWidths[3];

        // Rounds
        doc.fontSize(8).fillColor(colors.text);
        doc.text(`${vendor.roundsTaken}/${vendor.maxRounds}`, x, currentY + 10, { width: negColWidths[4] - 10, lineBreak: false });
        x += negColWidths[4];

        // Utility
        doc.fontSize(8).fillColor(colors.text);
        doc.text(vendor.utilityScore != null ? `${(vendor.utilityScore * 100).toFixed(1)}%` : 'N/A', x, currentY + 10, { width: negColWidths[5] - 10, lineBreak: false });
        x += negColWidths[5];

        // Payment Terms
        doc.fontSize(8).fillColor(colors.text);
        doc.text(vendor.paymentTerms || 'N/A', x, currentY + 10, { width: negColWidths[6] - 10, ellipsis: true, lineBreak: false });

        doc.y = savedY;
        currentY += negRowHeight;
      });

      drawFooter(pageNumber, totalPages);

      // ==================== PRICE HISTORY PAGE ====================
      doc.addPage();
      pageNumber++;
      drawHeader();
      currentY = 85;

      // Sort by utility for top-3 determination
      const sortedByUtility = [...negotiationHistory].sort((a, b) => (b.utilityScore ?? 0) - (a.utilityScore ?? 0));
      const top3Vendors = sortedByUtility.slice(0, 3);
      const otherVendors = sortedByUtility.slice(3);

      currentY = drawSectionHeader('Detailed Price History — Top 3 Vendors', currentY);

      // Per-vendor round table for top 3
      const phHeaders = ['Round', 'Vendor Price', 'Accordo Action', 'Utility'];
      const phColWidths = [60, 120, 200, 80];
      const phRowHeight = 22;

      for (const vendor of top3Vendors) {
        // Check if enough space for at least header + 2 rows
        if (currentY > pageHeight - 120) {
          drawFooter(pageNumber, totalPages);
          doc.addPage();
          pageNumber++;
          totalPages++;
          drawHeader();
          currentY = 85;
        }

        // Vendor sub-header
        const savedVY = doc.y;
        doc.rect(margin, currentY, contentWidth, 22).fill('#eff6ff');
        doc.rect(margin, currentY, 3, 22).fill(colors.primaryLight);
        doc.fontSize(10).fillColor(colors.primary).text(
          `${vendor.vendorName} — ${vendor.dealStatus}`,
          margin + 12, currentY + 6, { lineBreak: false }
        );
        doc.fontSize(8).fillColor(colors.textLight).text(
          `${vendor.roundsTaken} rounds | ${vendor.priceReductionPercent}% reduction`,
          pageWidth - margin - 200, currentY + 7, { width: 200, align: 'right', lineBreak: false }
        );
        doc.y = savedVY;
        currentY += 26;

        // Table header
        const savedTHY = doc.y;
        doc.rect(margin, currentY, contentWidth / 2 + 40, phRowHeight).fill(colors.primaryDark);
        let tx = margin + 5;
        doc.fontSize(8).fillColor(colors.white);
        phHeaders.forEach((h, i) => {
          doc.text(h, tx, currentY + 6, { width: phColWidths[i] - 10, lineBreak: false });
          tx += phColWidths[i];
        });
        doc.y = savedTHY;
        currentY += phRowHeight;

        // Group messages by round
        const rounds = new Map<number, typeof vendor.messages>();
        for (const msg of vendor.messages) {
          const r = msg.round ?? 0;
          if (!rounds.has(r)) rounds.set(r, []);
          rounds.get(r)!.push(msg);
        }

        if (rounds.size === 0) {
          const savedNRY = doc.y;
          doc.fontSize(8).fillColor(colors.textLight).text('No rounds completed', margin + 10, currentY + 5, { lineBreak: false });
          doc.y = savedNRY;
          currentY += phRowHeight;
        } else {
          for (const [roundNum, msgs] of rounds) {
            if (currentY > pageHeight - 60) {
              drawFooter(pageNumber, totalPages);
              doc.addPage();
              pageNumber++;
              totalPages++;
              drawHeader();
              currentY = 85;
            }

            const vendorMsg = msgs.find(m => m.role === 'VENDOR');
            const accordoMsg = msgs.find(m => m.role === 'ACCORDO');

            const savedRY = doc.y;
            const rowBg = roundNum % 2 === 0 ? colors.white : colors.background;
            doc.rect(margin, currentY, contentWidth / 2 + 40, phRowHeight).fill(rowBg);
            doc.rect(margin, currentY, contentWidth / 2 + 40, phRowHeight).stroke(colors.border);

            tx = margin + 5;
            doc.fontSize(8).fillColor(colors.text);
            doc.text(`R${roundNum}`, tx, currentY + 6, { width: phColWidths[0] - 10, lineBreak: false });
            tx += phColWidths[0];

            doc.text(vendorMsg && vendorMsg.price > 0 ? `$${vendorMsg.price.toLocaleString()}` : '-', tx, currentY + 6, { width: phColWidths[1] - 10, lineBreak: false });
            tx += phColWidths[1];

            doc.fontSize(7).fillColor(colors.textLight);
            doc.text(accordoMsg?.decisionAction || '-', tx, currentY + 6, { width: phColWidths[2] - 10, ellipsis: true, lineBreak: false });
            tx += phColWidths[2];

            const utility = vendorMsg?.utilityScore ?? accordoMsg?.utilityScore;
            doc.fontSize(8).fillColor(colors.text);
            doc.text(utility != null ? `${(utility * 100).toFixed(1)}%` : '-', tx, currentY + 6, { width: phColWidths[3] - 10, lineBreak: false });

            doc.y = savedRY;
            currentY += phRowHeight;
          }
        }

        currentY += 10; // spacing between vendors
      }

      // Other vendors summary (compact)
      if (otherVendors.length > 0) {
        if (currentY > pageHeight - 100) {
          drawFooter(pageNumber, totalPages);
          doc.addPage();
          pageNumber++;
          totalPages++;
          drawHeader();
          currentY = 85;
        }

        currentY = drawSectionHeader('Other Vendors Summary', currentY);

        for (const vendor of otherVendors) {
          if (currentY > pageHeight - 50) {
            drawFooter(pageNumber, totalPages);
            doc.addPage();
            pageNumber++;
            totalPages++;
            drawHeader();
            currentY = 85;
          }

          const savedY = doc.y;
          const priceStr = vendor.startingPrice > 0
            ? `$${vendor.startingPrice.toLocaleString()} → $${vendor.finalPrice.toLocaleString()}`
            : vendor.finalPrice > 0 ? `$${vendor.finalPrice.toLocaleString()}` : 'N/A';
          const line = `${vendor.vendorName}: ${priceStr} (${vendor.roundsTaken} rounds, ${vendor.priceReductionPercent}% reduction) — ${vendor.dealStatus}`;

          doc.fontSize(9).fillColor(colors.text).text(line, margin + 10, currentY, { width: contentWidth - 20, lineBreak: false });
          doc.y = savedY;
          currentY += 18;
        }
      }

      drawFooter(pageNumber, totalPages);

      // ==================== AI RECOMMENDATION & ANALYSIS PAGE ====================
      doc.addPage();
      pageNumber++;
      drawHeader();
      currentY = 85;

      currentY = drawSectionHeader('AI Recommendation & Analysis', currentY);

      // Static analysis boxes
      const recBoxWidth = (contentWidth - 30) / 4;
      const recBoxHeight = 75;

      const drawRecBox = (rx: number, ry: number, label: string, val: string, subtext: string, boxColor: string) => {
        const savedY = doc.y;
        doc.rect(rx, ry, recBoxWidth, recBoxHeight).fill(colors.white);
        doc.rect(rx, ry, recBoxWidth, recBoxHeight).stroke(colors.border);
        doc.rect(rx, ry, recBoxWidth, 4).fill(boxColor);
        doc.fontSize(14).fillColor(boxColor).text(val, rx + 8, ry + 15, { width: recBoxWidth - 16, align: 'center', lineBreak: false });
        doc.fontSize(9).fillColor(colors.text).text(label, rx + 8, ry + 40, { width: recBoxWidth - 16, align: 'center', lineBreak: false });
        if (subtext) {
          doc.fontSize(7).fillColor(colors.textLight).text(subtext, rx + 8, ry + 55, { width: recBoxWidth - 16, align: 'center', lineBreak: false });
        }
        doc.y = savedY;
      };

      // Best Value (highest utility)
      const bestUtilityVendor = sortedByUtility[0];
      drawRecBox(
        margin, currentY,
        'Best Value',
        bestUtilityVendor?.vendorName || 'N/A',
        bestUtilityVendor?.utilityScore != null ? `Utility: ${(bestUtilityVendor.utilityScore * 100).toFixed(1)}%` : '',
        colors.success
      );

      // Most Competitive Price (L1)
      const l1Bid = detail.topBids[0];
      drawRecBox(
        margin + recBoxWidth + 10, currentY,
        'Most Competitive Price',
        l1Bid ? `$${l1Bid.finalPrice?.toLocaleString() || 'N/A'}` : 'N/A',
        l1Bid?.vendorName || '',
        colors.primaryLight
      );

      // Risk Flags
      const walkedAway = negotiationHistory.filter(v => v.dealStatus === 'WALKED_AWAY').length;
      const lowUtility = negotiationHistory.filter(v => v.utilityScore != null && v.utilityScore < 0.3).length;
      drawRecBox(
        margin + (recBoxWidth + 10) * 2, currentY,
        'Risk Flags',
        `${walkedAway + lowUtility}`,
        `${walkedAway} walked away, ${lowUtility} low utility`,
        walkedAway + lowUtility > 0 ? colors.danger : colors.success
      );

      // Savings Potential
      const lowestPrice = detail.priceRange.lowest ?? 0;
      const highestPrice = detail.priceRange.highest ?? 0;
      const spread = highestPrice - lowestPrice;
      const targetDiff = detail.priceRange.targetPrice && lowestPrice > 0
        ? detail.priceRange.targetPrice - lowestPrice : null;
      drawRecBox(
        margin + (recBoxWidth + 10) * 3, currentY,
        'Savings Potential',
        spread > 0 ? `$${spread.toLocaleString()}` : 'N/A',
        targetDiff != null ? `${targetDiff >= 0 ? '$' + Math.round(targetDiff).toLocaleString() + ' under' : '$' + Math.round(Math.abs(targetDiff)).toLocaleString() + ' over'} target` : `Spread across ${negotiationHistory.length} vendors`,
        colors.warning
      );

      currentY += recBoxHeight + 20;

      // AI Narrative
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
        // This is the ONE place lineBreak is true — for wrapping narrative text
        const maxNarrativeHeight = pageHeight - currentY - 60;
        doc.fontSize(9).fillColor(colors.text).text(narrative, margin + 5, currentY, {
          width: contentWidth - 10,
          lineBreak: true,
          height: maxNarrativeHeight,
          ellipsis: true,
        });
        // Reset cursor after wrapping text
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
  } catch (error) {
    next(error);
  }
}
