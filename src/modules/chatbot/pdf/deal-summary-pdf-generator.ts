/**
 * Deal Summary PDF Generator
 *
 * Generates professional PDF reports for completed deals using pdfkit.
 * Includes: Summary, Final Offer, Analytics Charts, Timeline, and Full Chat Transcript.
 *
 * Created: January 2026
 */

import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import logger from '../../../config/logger.js';

// Ensure uploads directory exists
const PDF_DIR = path.join(process.cwd(), 'uploads', 'pdfs');
if (!fs.existsSync(PDF_DIR)) {
  fs.mkdirSync(PDF_DIR, { recursive: true });
}

// Colors matching existing PDF style
const COLORS = {
  primary: '#0066cc',
  success: '#28a745',
  danger: '#dc3545',
  warning: '#ffc107',
  info: '#17a2b8',
  text: '#333333',
  textLight: '#666666',
  textMuted: '#999999',
  border: '#dee2e6',
  background: '#f8f9fa',
  white: '#ffffff',
};

// Status colors
const STATUS_COLORS: Record<string, string> = {
  ACCEPTED: COLORS.success,
  WALKED_AWAY: COLORS.danger,
  ESCALATED: COLORS.warning,
  NEGOTIATING: COLORS.info,
};

/**
 * Input data for PDF generation
 */
export interface DealSummaryPDFInput {
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
    vendorPrice?: number | null;
    accordoPrice?: number | null;
    timestamp?: string;
  }>;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    createdAt: string;
    extractedOffer?: { total_price?: number; payment_terms?: string } | null;
  }>;
  rfqId: number;
  generatedAt: Date;
}

/**
 * Generate a Deal Summary PDF
 */
export async function generateDealSummaryPDF(input: DealSummaryPDFInput): Promise<Buffer> {
  const { deal, finalOffer, metrics, timeline, messages, rfqId, generatedAt } = input;

  return new Promise((resolve, reject) => {
    try {
      const chunks: Buffer[] = [];

      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        bufferPages: true,
        info: {
          Title: `Deal Summary - ${deal.vendorName}`,
          Author: 'Accordo AI',
          Subject: 'Negotiation Deal Summary Report',
          Keywords: 'procurement, negotiation, deal summary',
        },
      });

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Page 1: Cover & Summary (always rendered)
      renderCoverPage(doc, deal, rfqId, generatedAt);
      renderDealOverview(doc, deal, metrics);
      renderFinalOffer(doc, finalOffer);
      renderUtilityScore(doc, metrics.utilityScore);

      // Page 2: Analytics & Charts (only if we have data to show)
      const hasPriceData = timeline.some(r => r.vendorPrice || r.accordoPrice);
      if (hasPriceData || timeline.length > 0) {
        doc.addPage();
        renderAnalyticsPage(doc, timeline, metrics);
      }

      // Page 3+: Timeline (only if timeline has content)
      if (timeline.length > 0) {
        doc.addPage();
        renderTimelinePage(doc, timeline);
      }

      // Chat Transcript Pages (only if messages exist)
      if (messages.length > 0) {
        doc.addPage();
        renderChatTranscript(doc, messages);
      }

      // Add page numbers
      addPageNumbers(doc);

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Save PDF to file and return filepath
 */
export async function saveDealSummaryPDF(input: DealSummaryPDFInput): Promise<string> {
  const buffer = await generateDealSummaryPDF(input);

  // Generate descriptive filename
  const vendorNameClean = input.deal.vendorName.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 30);
  const dateStr = new Date().toISOString().split('T')[0];
  const filename = `Deal-Summary-${vendorNameClean}-RFQ${input.rfqId}-${dateStr}-${uuidv4().slice(0, 8)}.pdf`;
  const filepath = path.join(PDF_DIR, filename);

  fs.writeFileSync(filepath, buffer);
  logger.info(`Deal Summary PDF saved: ${filepath}`);

  return filepath;
}

/**
 * Generate filename for the PDF
 */
export function generatePDFFilename(vendorName: string, rfqId: number): string {
  const vendorNameClean = vendorName.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 30);
  const dateStr = new Date().toISOString().split('T')[0];
  return `Deal-Summary-${vendorNameClean}-RFQ${rfqId}-${dateStr}.pdf`;
}

// ============================================================================
// Render Functions
// ============================================================================

function renderCoverPage(
  doc: PDFKit.PDFDocument,
  deal: DealSummaryPDFInput['deal'],
  rfqId: number,
  generatedAt: Date
): void {
  // Title
  doc.fontSize(28).fillColor(COLORS.primary).text('DEAL SUMMARY REPORT', { align: 'center' });
  doc.moveDown(0.5);

  // Subtitle
  doc.fontSize(12).fillColor(COLORS.textLight).text('Negotiation Outcome Analysis', { align: 'center' });
  doc.moveDown(1.5);

  // Deal Title Box
  const boxY = doc.y;
  doc.rect(50, boxY, 495, 80).fill(COLORS.background).stroke(COLORS.border);

  doc.fontSize(16).fillColor(COLORS.text).text(deal.title, 60, boxY + 15, { width: 475 });
  doc.fontSize(11).fillColor(COLORS.textLight);
  doc.text(`RFQ ID: ${rfqId}`, 60, boxY + 40);
  doc.text(`Vendor: ${deal.vendorName}`, 60, boxY + 55);

  doc.y = boxY + 90;
  doc.moveDown(0.5);

  // Generation info
  doc.fontSize(10).fillColor(COLORS.textMuted);
  doc.text(`Generated: ${generatedAt.toLocaleDateString()} at ${generatedAt.toLocaleTimeString()}`, { align: 'center' });

  // Divider
  doc.moveDown(1);
  drawDivider(doc);
}

function renderDealOverview(
  doc: PDFKit.PDFDocument,
  deal: DealSummaryPDFInput['deal'],
  metrics: DealSummaryPDFInput['metrics']
): void {
  doc.moveDown(1);
  doc.fontSize(14).fillColor(COLORS.text).text('DEAL OVERVIEW', { underline: true });
  doc.moveDown(0.5);

  const startY = doc.y;
  const boxWidth = 155;
  const boxHeight = 55;
  const spacing = 15;

  // Status box
  const statusColor = STATUS_COLORS[deal.status] || COLORS.info;
  drawStatBox(doc, 50, startY, boxWidth, boxHeight, 'Status', deal.status.replace('_', ' '), statusColor);

  // Rounds box
  drawStatBox(doc, 50 + boxWidth + spacing, startY, boxWidth, boxHeight, 'Rounds Used', `${metrics.totalRounds}/${metrics.maxRounds}`, COLORS.info);

  // Duration box
  const durationText = metrics.durationDays !== null ? `${metrics.durationDays} days` : 'N/A';
  drawStatBox(doc, 50 + (boxWidth + spacing) * 2, startY, boxWidth, boxHeight, 'Duration', durationText, COLORS.textLight);

  doc.y = startY + boxHeight + 15;

  // Vendor info
  doc.fontSize(10).fillColor(COLORS.textLight);
  doc.text(`Vendor: ${deal.vendorName}`, 50);
  doc.text(`Email: ${deal.vendorEmail}`, 50);
  if (deal.companyName) {
    doc.text(`Company: ${deal.companyName}`, 50);
  }
  doc.text(`Mode: ${deal.mode}`, 50);
}

function renderFinalOffer(doc: PDFKit.PDFDocument, finalOffer: DealSummaryPDFInput['finalOffer']): void {
  doc.moveDown(1);
  drawDivider(doc);
  doc.moveDown(0.5);

  doc.fontSize(14).fillColor(COLORS.text).text('FINAL OFFER', { underline: true });
  doc.moveDown(0.5);

  const startY = doc.y;

  // Final offer table
  const tableData = [
    ['Unit Price', formatCurrency(finalOffer.unitPrice)],
    ['Total Value', formatCurrency(finalOffer.totalValue)],
    ['Payment Terms', finalOffer.paymentTerms || 'N/A'],
    ['Delivery Date', finalOffer.deliveryDate ? formatDate(finalOffer.deliveryDate) : 'N/A'],
  ];

  let y = startY;
  tableData.forEach(([label, value], index) => {
    const bgColor = index % 2 === 0 ? COLORS.white : COLORS.background;
    doc.rect(50, y, 200, 25).fill(bgColor);
    doc.rect(250, y, 150, 25).fill(bgColor);

    doc.fontSize(10).fillColor(COLORS.textLight).text(label, 55, y + 7);
    doc.fontSize(11).fillColor(COLORS.text).text(value, 255, y + 7);

    y += 25;
  });

  doc.y = y + 10;
}

function renderUtilityScore(doc: PDFKit.PDFDocument, utilityScore: number | null): void {
  if (utilityScore === null) return;

  doc.moveDown(0.5);
  doc.fontSize(14).fillColor(COLORS.text).text('UTILITY SCORE', { underline: true });
  doc.moveDown(0.5);

  const startY = doc.y;
  const barWidth = 300;
  const barHeight = 25;
  const scorePercent = Math.round(utilityScore * 100);

  // Background bar
  doc.rect(50, startY, barWidth, barHeight).fill(COLORS.border);

  // Score bar
  const scoreWidth = (scorePercent / 100) * barWidth;
  const scoreColor = scorePercent >= 70 ? COLORS.success : scorePercent >= 40 ? COLORS.warning : COLORS.danger;
  doc.rect(50, startY, scoreWidth, barHeight).fill(scoreColor);

  // Score text
  doc.fontSize(14).fillColor(COLORS.text).text(`${scorePercent}%`, 360, startY + 5);

  // Rating
  const rating = scorePercent >= 80 ? 'Excellent' : scorePercent >= 60 ? 'Good' : scorePercent >= 40 ? 'Fair' : 'Poor';
  doc.fontSize(10).fillColor(scoreColor).text(rating, 400, startY + 8);

  doc.y = startY + barHeight + 15;
}

function renderAnalyticsPage(
  doc: PDFKit.PDFDocument,
  timeline: DealSummaryPDFInput['timeline'],
  metrics: DealSummaryPDFInput['metrics']
): void {
  // Skip if no timeline data
  if (timeline.length === 0) return;

  doc.fontSize(20).fillColor(COLORS.primary).text('NEGOTIATION ANALYTICS', { align: 'center' });
  doc.moveDown(1);
  drawDivider(doc);
  doc.moveDown(1);

  // Price Progression Chart (only if we have price data)
  const hasPriceData = timeline.some(r => r.vendorPrice || r.accordoPrice);
  if (hasPriceData) {
    renderPriceProgressionChart(doc, timeline);
    doc.moveDown(1.5);
  }

  // Round-by-Round Comparison Table
  renderRoundComparisonTable(doc, timeline);
}

function renderPriceProgressionChart(doc: PDFKit.PDFDocument, timeline: DealSummaryPDFInput['timeline']): void {
  doc.fontSize(14).fillColor(COLORS.text).text('Price Progression', { underline: true });
  doc.moveDown(0.5);

  // Extract prices from timeline
  const vendorPrices: number[] = [];
  const accordoPrices: number[] = [];

  timeline.forEach((round) => {
    if (round.vendorPrice) vendorPrices.push(round.vendorPrice);
    if (round.accordoPrice) accordoPrices.push(round.accordoPrice);
  });

  if (vendorPrices.length === 0 && accordoPrices.length === 0) {
    doc.fontSize(10).fillColor(COLORS.textMuted).text('Price data not available for chart visualization.', { align: 'center' });
    return;
  }

  const allPrices = [...vendorPrices, ...accordoPrices].filter((p) => p > 0);
  if (allPrices.length === 0) {
    doc.fontSize(10).fillColor(COLORS.textMuted).text('No price data to display.', { align: 'center' });
    return;
  }

  const maxPrice = Math.max(...allPrices);
  const minPrice = Math.min(...allPrices);
  const priceRange = maxPrice - minPrice || maxPrice * 0.1;

  const chartX = 80;
  const chartY = doc.y;
  const chartWidth = 400;
  const chartHeight = 150;

  // Draw chart background
  doc.rect(chartX, chartY, chartWidth, chartHeight).fill(COLORS.background);

  // Draw Y-axis labels
  doc.fontSize(8).fillColor(COLORS.textMuted);
  doc.text(formatCurrency(maxPrice), chartX - 60, chartY);
  doc.text(formatCurrency(minPrice), chartX - 60, chartY + chartHeight - 10);

  // Draw X-axis labels
  timeline.forEach((round, i) => {
    const x = chartX + (i / Math.max(timeline.length - 1, 1)) * chartWidth;
    doc.text(`R${round.round}`, x - 5, chartY + chartHeight + 5);
  });

  // Draw vendor line (red)
  if (vendorPrices.length > 1) {
    doc.strokeColor(COLORS.danger).lineWidth(2);
    doc.moveTo(chartX, chartY + chartHeight - ((vendorPrices[0] - minPrice) / priceRange) * chartHeight);
    vendorPrices.forEach((price, i) => {
      const x = chartX + (i / Math.max(vendorPrices.length - 1, 1)) * chartWidth;
      const y = chartY + chartHeight - ((price - minPrice) / priceRange) * chartHeight;
      doc.lineTo(x, y);
    });
    doc.stroke();
  }

  // Draw accordo line (blue)
  if (accordoPrices.length > 1) {
    doc.strokeColor(COLORS.primary).lineWidth(2);
    doc.moveTo(chartX, chartY + chartHeight - ((accordoPrices[0] - minPrice) / priceRange) * chartHeight);
    accordoPrices.forEach((price, i) => {
      const x = chartX + (i / Math.max(accordoPrices.length - 1, 1)) * chartWidth;
      const y = chartY + chartHeight - ((price - minPrice) / priceRange) * chartHeight;
      doc.lineTo(x, y);
    });
    doc.stroke();
  }

  // Legend
  doc.y = chartY + chartHeight + 25;
  doc.fontSize(9).fillColor(COLORS.danger).text('● Vendor Offers', chartX, doc.y);
  doc.fillColor(COLORS.primary).text('● Accordo Counters', chartX + 120, doc.y - 11);

  doc.y += 15;
}

function renderRoundComparisonTable(doc: PDFKit.PDFDocument, timeline: DealSummaryPDFInput['timeline']): void {
  // Skip if no timeline data
  if (timeline.length === 0) return;

  if (doc.y > 550) doc.addPage();

  doc.fontSize(14).fillColor(COLORS.text).text('Round-by-Round Comparison', { underline: true });
  doc.moveDown(0.5);

  const tableX = 50;
  let y = doc.y;
  const headers = ['Round', 'Vendor Offer', 'Accordo Response', 'Decision'];
  const colWidths = [50, 180, 180, 80];
  const rowHeight = 30;

  // Header row
  doc.rect(tableX, y, 490, rowHeight).fill(COLORS.primary);
  doc.fontSize(10).fillColor(COLORS.white);
  let x = tableX + 5;
  headers.forEach((header, i) => {
    doc.text(header, x, y + 10, { width: colWidths[i] - 10 });
    x += colWidths[i];
  });
  y += rowHeight;

  // Data rows
  timeline.forEach((round, index) => {
    if (y > 700) {
      doc.addPage();
      y = 50;
    }

    const bgColor = index % 2 === 0 ? COLORS.white : COLORS.background;
    doc.rect(tableX, y, 490, rowHeight).fill(bgColor);
    doc.rect(tableX, y, 490, rowHeight).stroke(COLORS.border);

    doc.fontSize(9).fillColor(COLORS.text);
    x = tableX + 5;

    // Round number
    doc.text(`#${round.round}`, x, y + 10, { width: colWidths[0] - 10 });
    x += colWidths[0];

    // Vendor offer (truncated)
    const vendorText = round.vendorOffer.substring(0, 50) + (round.vendorOffer.length > 50 ? '...' : '');
    doc.text(vendorText, x, y + 10, { width: colWidths[1] - 10 });
    x += colWidths[1];

    // Accordo response (truncated)
    const accordoText = round.accordoResponse.substring(0, 50) + (round.accordoResponse.length > 50 ? '...' : '');
    doc.text(accordoText, x, y + 10, { width: colWidths[2] - 10 });
    x += colWidths[2];

    // Decision with color
    const actionColor = round.action === 'ACCEPT' ? COLORS.success : round.action === 'WALK_AWAY' ? COLORS.danger : COLORS.primary;
    doc.fillColor(actionColor).text(round.action.replace('_', ' '), x, y + 10, { width: colWidths[3] - 10 });

    y += rowHeight;
  });

  doc.y = y + 10;
}

function renderTimelinePage(doc: PDFKit.PDFDocument, timeline: DealSummaryPDFInput['timeline']): void {
  // Skip if no timeline data
  if (timeline.length === 0) return;

  doc.fontSize(20).fillColor(COLORS.primary).text('NEGOTIATION TIMELINE', { align: 'center' });
  doc.moveDown(1);
  drawDivider(doc);
  doc.moveDown(1);

  timeline.forEach((round, index) => {
    if (doc.y > 650) doc.addPage();

    // Round header
    const actionColor = round.action === 'ACCEPT' ? COLORS.success : round.action === 'WALK_AWAY' ? COLORS.danger : COLORS.primary;

    doc.circle(60, doc.y + 8, 12).fill(COLORS.primary);
    doc.fontSize(10).fillColor(COLORS.white).text(`${round.round}`, 55, doc.y + 3);

    doc.fontSize(12).fillColor(COLORS.text).text(`Round ${round.round}`, 80, doc.y - 2);
    doc.fontSize(9).fillColor(actionColor).text(round.action.replace('_', ' '), 150, doc.y - 10);

    doc.moveDown(1);

    // Vendor message
    doc.fontSize(9).fillColor(COLORS.textLight).text('VENDOR:', 50);
    doc.rect(50, doc.y, 495, 40).fill(COLORS.background).stroke(COLORS.border);
    doc.fontSize(9).fillColor(COLORS.text).text(round.vendorOffer.substring(0, 200) + (round.vendorOffer.length > 200 ? '...' : ''), 55, doc.y + 5, { width: 485 });
    doc.y += 45;

    // Accordo response
    if (round.accordoResponse) {
      doc.fontSize(9).fillColor(COLORS.primary).text('ACCORDO:', 50);
      doc.rect(50, doc.y, 495, 40).fill('#e8f4fc').stroke(COLORS.primary);
      doc.fontSize(9).fillColor(COLORS.text).text(round.accordoResponse.substring(0, 200) + (round.accordoResponse.length > 200 ? '...' : ''), 55, doc.y + 5, { width: 485 });
      doc.y += 45;
    }

    doc.moveDown(0.5);

    // Connecting line (except last)
    if (index < timeline.length - 1) {
      doc.strokeColor(COLORS.border).lineWidth(1);
      doc.moveTo(60, doc.y - 10).lineTo(60, doc.y + 10).stroke();
      doc.moveDown(0.5);
    }
  });
}

function renderChatTranscript(doc: PDFKit.PDFDocument, messages: DealSummaryPDFInput['messages']): void {
  // Skip if no messages
  if (messages.length === 0) return;

  doc.fontSize(20).fillColor(COLORS.primary).text('FULL CHAT TRANSCRIPT', { align: 'center' });
  doc.moveDown(1);
  drawDivider(doc);
  doc.moveDown(1);

  doc.fontSize(10).fillColor(COLORS.textMuted).text(`Total Messages: ${messages.length}`, { align: 'center' });
  doc.moveDown(1);

  messages.forEach((message) => {
    if (doc.y > 680) doc.addPage();

    const isVendor = message.role === 'VENDOR';
    const roleColor = isVendor ? COLORS.danger : message.role === 'ACCORDO' ? COLORS.primary : COLORS.textMuted;
    const bgColor = isVendor ? '#fef2f2' : message.role === 'ACCORDO' ? '#eff6ff' : COLORS.background;

    // Role and timestamp
    doc.fontSize(8).fillColor(roleColor).text(message.role, 50);
    doc.fontSize(7).fillColor(COLORS.textMuted).text(formatDateTime(message.createdAt), 50);

    // Message content
    const contentHeight = Math.min(80, Math.ceil(message.content.length / 80) * 12 + 10);
    doc.rect(50, doc.y, 495, contentHeight).fill(bgColor);
    doc.fontSize(9).fillColor(COLORS.text).text(message.content, 55, doc.y + 5, { width: 485 });
    doc.y += contentHeight + 5;

    doc.moveDown(0.3);
  });
}

function addPageNumbers(doc: PDFKit.PDFDocument): void {
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);

    // Footer divider
    doc.strokeColor(COLORS.border).lineWidth(0.5);
    doc.moveTo(50, 780).lineTo(545, 780).stroke();

    // Confidential notice - height constrains the text box to prevent auto-pagination
    doc.fontSize(7).fillColor(COLORS.textMuted);
    doc.text('CONFIDENTIAL - Accordo AI - For Internal Use Only', 50, 785, {
      align: 'center',
      width: 495,
      height: 10,
      lineBreak: false
    });

    // Page number - height constrains the text box to prevent auto-pagination
    doc.text(`Page ${i + 1} of ${pages.count}`, 50, 795, {
      align: 'center',
      width: 495,
      height: 10,
      lineBreak: false
    });
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function drawDivider(doc: PDFKit.PDFDocument): void {
  doc.strokeColor(COLORS.border).lineWidth(1);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
}

function drawStatBox(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  value: string,
  color: string
): void {
  doc.rect(x, y, width, height).fill(COLORS.background).stroke(COLORS.border);
  doc.fontSize(18).fillColor(color).text(value, x, y + 12, { width, align: 'center' });
  doc.fontSize(9).fillColor(COLORS.textMuted).text(label, x, y + 36, { width, align: 'center' });
}

function formatCurrency(value: number | null): string {
  if (value === null) return 'N/A';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
