import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import env from "../../../config/env.js";
import logger from "../../../config/logger.js";
import type { GeneratePDFInput, PDFBidData } from "../bid-comparison.types.js";

// Ensure uploads directory exists
const PDF_DIR = path.join(process.cwd(), "uploads", "pdfs");
if (!fs.existsSync(PDF_DIR)) {
  fs.mkdirSync(PDF_DIR, { recursive: true });
}

// Colors for the chart
const CHART_COLORS = {
  rank1: "#28a745", // Green
  rank2: "#17a2b8", // Cyan
  rank3: "#ffc107", // Yellow
  other: "#6c757d", // Gray
  text: "#333333",
  border: "#dee2e6",
  background: "#f8f9fa",
};

/**
 * Generate a PDF comparison report with bar chart
 */
export async function generateComparisonPDF(
  input: GeneratePDFInput,
): Promise<string> {
  const { requisition, bids, generatedAt } = input;

  // pdfkit is dynamically imported so it isn't loaded on app boot.
  const { default: PDFDocument } = await import("pdfkit");

  return new Promise((resolve, reject) => {
    try {
      const filename = `comparison_${requisition.rfqId}_${uuidv4().slice(0, 8)}.pdf`;
      const filepath = path.join(PDF_DIR, filename);

      const doc = new PDFDocument({
        size: "A4",
        margin: 50,
        info: {
          Title: `Bid Comparison - ${requisition.rfqId}`,
          Author: "Accordo AI",
          Subject: "Vendor Bid Comparison Report",
          Keywords: "procurement, negotiation, bid comparison",
        },
      });

      const stream = fs.createWriteStream(filepath);
      doc.pipe(stream);

      // Header
      renderHeader(doc, requisition, generatedAt);

      // Summary Stats
      doc.moveDown(1);
      renderSummaryStats(doc, requisition);

      // Bar Chart
      doc.moveDown(1);
      if (bids.length > 0) {
        renderBarChart(doc, bids);
      } else {
        doc
          .fontSize(12)
          .fillColor(CHART_COLORS.text)
          .text("No completed bids to display.", { align: "center" });
      }

      // Bid Details Table
      doc.moveDown(1);
      renderBidTable(doc, bids);

      // Footer
      renderFooter(doc);

      doc.end();

      stream.on("finish", () => {
        logger.info(`PDF generated: ${filepath}`);
        resolve(filepath);
      });

      stream.on("error", (err) => {
        logger.error(`PDF generation error: ${err.message}`);
        reject(err);
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Render the header section
 */
function renderHeader(
  doc: PDFKit.PDFDocument,
  requisition: any,
  generatedAt: Date,
): void {
  // Title
  doc
    .fontSize(24)
    .fillColor("#0066cc")
    .text("Vendor Bid Comparison Report", { align: "center" });

  doc.moveDown(0.5);

  // Requisition info
  doc
    .fontSize(14)
    .fillColor(CHART_COLORS.text)
    .text(requisition.subject, { align: "center" });

  doc.moveDown(0.5);

  // Project and RFQ
  doc.fontSize(10).fillColor("#666666");
  doc.text(`Project: ${requisition.projectName}`, { align: "center" });
  doc.text(`RFQ ID: ${requisition.rfqId}`, { align: "center" });
  doc.text(
    `Generated: ${generatedAt.toLocaleDateString()} ${generatedAt.toLocaleTimeString()}`,
    { align: "center" },
  );

  doc.moveDown(0.5);

  // Divider line
  doc.strokeColor(CHART_COLORS.border).lineWidth(1);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
}

/**
 * Render summary statistics
 */
function renderSummaryStats(doc: PDFKit.PDFDocument, requisition: any): void {
  const statsY = doc.y + 10;
  const boxWidth = 150;
  const boxHeight = 50;
  const spacing = 15;

  // Total Vendors box
  drawStatBox(
    doc,
    50,
    statsY,
    boxWidth,
    boxHeight,
    "Total Vendors",
    String(requisition.totalVendors),
    "#0066cc",
  );

  // Completed box
  drawStatBox(
    doc,
    50 + boxWidth + spacing,
    statsY,
    boxWidth,
    boxHeight,
    "Completed",
    String(requisition.completedVendors),
    "#28a745",
  );

  // Excluded box
  drawStatBox(
    doc,
    50 + (boxWidth + spacing) * 2,
    statsY,
    boxWidth,
    boxHeight,
    "Excluded",
    String(requisition.excludedVendors),
    "#dc3545",
  );

  doc.y = statsY + boxHeight + 10;
}

/**
 * Draw a stat box
 */
function drawStatBox(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  value: string,
  color: string,
): void {
  // Box background
  doc.rect(x, y, width, height).fill(CHART_COLORS.background);
  doc.rect(x, y, width, height).stroke(CHART_COLORS.border);

  // Value
  doc
    .fontSize(20)
    .fillColor(color)
    .text(value, x, y + 10, { width, align: "center" });

  // Label
  doc
    .fontSize(10)
    .fillColor("#666666")
    .text(label, x, y + 32, { width, align: "center" });
}

/**
 * Render horizontal bar chart comparing vendor prices
 */
function renderBarChart(doc: PDFKit.PDFDocument, bids: PDFBidData[]): void {
  if (bids.length === 0) return;

  const chartX = 50;
  const chartY = doc.y + 10;
  const chartWidth = 400;
  const barHeight = 30;
  const barSpacing = 10;
  // removed dead: const _chartHeight = bids.length * (barHeight + barSpacing) + 40;

  // Title
  doc
    .fontSize(14)
    .fillColor(CHART_COLORS.text)
    .text("Price Comparison", chartX, chartY, { underline: true });

  const startY = chartY + 25;

  // Find max price for scaling
  const maxPrice = Math.max(...bids.map((b) => b.finalPrice));
  const priceScale = chartWidth / (maxPrice * 1.1); // 10% padding

  // Draw bars
  bids.forEach((bid, index) => {
    const y = startY + index * (barHeight + barSpacing);
    const barWidth = bid.finalPrice * priceScale;
    const color = getBarColor(bid.rank);

    // Vendor name (left side)
    doc
      .fontSize(10)
      .fillColor(CHART_COLORS.text)
      .text(bid.vendorName, chartX, y + 8, { width: 100, ellipsis: true });

    // Bar
    const barX = chartX + 110;
    doc.rect(barX, y, barWidth, barHeight).fill(color);

    // Price label on bar
    const priceLabel = `$${bid.finalPrice.toLocaleString()}`;
    const labelX = barX + barWidth + 5;
    doc
      .fontSize(10)
      .fillColor(CHART_COLORS.text)
      .text(priceLabel, labelX, y + 8);

    // Rank badge
    const rankX = chartX + chartWidth + 50;
    drawRankBadge(doc, rankX, y + 5, bid.rank);
  });

  doc.y = startY + bids.length * (barHeight + barSpacing);
}

/**
 * Get bar color based on rank
 */
function getBarColor(rank: number): string {
  switch (rank) {
    case 1:
      return CHART_COLORS.rank1;
    case 2:
      return CHART_COLORS.rank2;
    case 3:
      return CHART_COLORS.rank3;
    default:
      return CHART_COLORS.other;
  }
}

/**
 * Draw rank badge
 */
function drawRankBadge(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  rank: number,
): void {
  const color = getBarColor(rank);
  const size = 20;

  doc.circle(x + size / 2, y + size / 2, size / 2).fill(color);
  doc
    .fontSize(10)
    .fillColor("#ffffff")
    .text(`#${rank}`, x, y + 5, { width: size, align: "center" });
}

/**
 * Render bid details table
 */
function renderBidTable(doc: PDFKit.PDFDocument, bids: PDFBidData[]): void {
  if (bids.length === 0) return;

  // Check if we need a new page
  if (doc.y > 600) {
    doc.addPage();
  }

  const tableX = 50;
  const tableY = doc.y + 10;

  // Title
  doc
    .fontSize(14)
    .fillColor(CHART_COLORS.text)
    .text("Bid Details", tableX, tableY, { underline: true });

  // Table headers
  const headers = ["Rank", "Vendor", "Price", "Payment Terms", "Utility"];
  const colWidths = [40, 150, 80, 100, 80];
  const rowHeight = 25;

  let y = tableY + 25;

  // Header row
  doc.fontSize(10).fillColor("#ffffff");
  doc.rect(tableX, y, 495, rowHeight).fill("#0066cc");

  let x = tableX + 5;
  headers.forEach((header, i) => {
    doc.text(header, x, y + 7, { width: colWidths[i] - 10 });
    x += colWidths[i];
  });

  y += rowHeight;

  // Data rows
  bids.forEach((bid, index) => {
    const bgColor = index % 2 === 0 ? "#ffffff" : CHART_COLORS.background;
    doc.rect(tableX, y, 495, rowHeight).fill(bgColor);
    doc.rect(tableX, y, 495, rowHeight).stroke(CHART_COLORS.border);

    doc.fontSize(9).fillColor(CHART_COLORS.text);

    x = tableX + 5;
    const rowData = [
      `#${bid.rank}`,
      bid.vendorName,
      `$${bid.finalPrice.toLocaleString()}`,
      bid.paymentTerms,
      bid.utilityScore !== null
        ? `${(bid.utilityScore * 100).toFixed(1)}%`
        : "N/A",
    ];

    rowData.forEach((cell, i) => {
      doc.text(cell, x, y + 8, { width: colWidths[i] - 10, ellipsis: true });
      x += colWidths[i];
    });

    y += rowHeight;
  });

  doc.y = y + 10;
}

/**
 * Render footer
 */
function renderFooter(doc: PDFKit.PDFDocument): void {
  const bottomY = 750;

  // Divider
  doc.strokeColor(CHART_COLORS.border).lineWidth(1);
  doc.moveTo(50, bottomY).lineTo(545, bottomY).stroke();

  // Footer text
  doc.fontSize(8).fillColor("#999999");
  doc.text(
    "This report is generated by Accordo AI. For questions, please contact your procurement team.",
    50,
    bottomY + 10,
    { align: "center", width: 495 },
  );
  doc.text("Confidential - For internal use only", 50, bottomY + 25, {
    align: "center",
    width: 495,
  });
}

/**
 * Get the PDF URL for a given path
 */
export function getPDFUrl(filepath: string): string {
  const filename = path.basename(filepath);
  return `${env.backendUrl || "http://localhost:8000"}/pdfs/${filename}`;
}
