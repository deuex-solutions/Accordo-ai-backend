// tesseract.js is dynamically imported when ENABLE_DOC_OCR=true; otherwise it
// is never loaded so its ~43 MB native binaries don't ship with the deploy.
import path from "path";
import fs from "fs";
import { promises as fsp } from "fs";
import { fromPath } from "pdf2pic";
import logger from "../../config/logger.js";

/**
 * Document types for extraction
 */
export type DocumentType = "GST" | "PAN" | "MSME" | "CI";

/**
 * Extraction result interface
 */
export interface ExtractionResult {
  success: boolean;
  documentType: DocumentType;
  extractedNumber: string | null;
  confidence: number;
  filePath: string;
  error?: string;
}

/**
 * Regex patterns for different document types
 */
const EXTRACTION_PATTERNS: Record<DocumentType, RegExp[]> = {
  GST: [
    // GST format: 2 digits state code + 10 char PAN + 1 entity code + Z + 1 checksum
    /\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}\b/gi,
    /\bGST\s*(?:No|Number|#)?[\s:.-]*(\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1})\b/gi,
    /\bGSTIN[\s:.-]*(\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1})\b/gi,
  ],
  PAN: [
    // PAN format: 5 letters + 4 digits + 1 letter
    /\b[A-Z]{5}\d{4}[A-Z]{1}\b/gi,
    /\bPAN\s*(?:No|Number|#)?[\s:.-]*([A-Z]{5}\d{4}[A-Z]{1})\b/gi,
    /\bPermanent\s*Account\s*Number[\s:.-]*([A-Z]{5}\d{4}[A-Z]{1})\b/gi,
  ],
  MSME: [
    // MSME/Udyam format: UDYAM-XX-00-0000000
    /\bUDYAM[-\s]?[A-Z]{2}[-\s]?\d{2}[-\s]?\d{7}\b/gi,
    /\bMSME\s*(?:No|Number|#)?[\s:.-]*([A-Z]{2}\d{2}[A-Z]{1}\d{7})\b/gi,
    /\bUdyam\s*(?:Registration)?[\s:.-]*(UDYAM[-\s]?[A-Z]{2}[-\s]?\d{2}[-\s]?\d{7})\b/gi,
    // Older UAM format
    /\bUAM[-\s]?[A-Z]{2}[-\s]?\d{2}[-\s]?\d{7}\b/gi,
  ],
  CI: [
    // CIN format: L/U + 5 digits + 2 state code + 4 year + 3 letters + 6 digits
    /\b[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}\b/gi,
    /\bCIN[\s:.-]*([LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})\b/gi,
    /\bCorporate\s*Identity\s*Number[\s:.-]*([LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})\b/gi,
    // LLPIN for LLP
    /\b[A-Z]{3}[-\s]?\d{4}\b/gi,
  ],
};

/**
 * Convert PDF to image for OCR processing
 */
async function convertPdfToImage(pdfPath: string): Promise<string> {
  const outputDir = path.dirname(pdfPath);
  const baseName = path.basename(pdfPath, ".pdf");
  // removed dead: const _outputPath = path.join(outputDir, `${baseName}-page-1.png`);

  try {
    const options = {
      density: 300,
      saveFilename: `${baseName}-page`,
      savePath: outputDir,
      format: "png",
      width: 2000,
      height: 2800,
    };

    const convert = fromPath(pdfPath, options);
    const result = await convert(1, { responseType: "image" });

    if (result && result.path) {
      return result.path;
    }

    throw new Error("PDF conversion failed - no output path");
  } catch (error) {
    logger.error("PDF to image conversion failed:", error);
    throw error;
  }
}

/**
 * Extract text from image using Tesseract OCR
 */
async function performOCR(imagePath: string): Promise<string> {
  try {
    const { default: Tesseract } = await import("tesseract.js");
    const result = await Tesseract.recognize(imagePath, "eng", {
      logger: (m: { status: string; progress: number }) => {
        if (m.status === "recognizing text") {
          logger.debug(`OCR Progress: ${Math.round(m.progress * 100)}%`);
        }
      },
    });

    return result.data.text;
  } catch (error) {
    logger.error("OCR failed:", error);
    throw error;
  }
}

/**
 * Extract document number from text based on document type
 */
function extractNumberFromText(
  text: string,
  documentType: DocumentType,
): { number: string | null; confidence: number } {
  const patterns = EXTRACTION_PATTERNS[documentType];
  const normalizedText = text.toUpperCase().replace(/\s+/g, " ");

  for (const pattern of patterns) {
    const matches = normalizedText.match(pattern);
    if (matches && matches.length > 0) {
      // Clean up the extracted number
      let extractedNumber = matches[0]
        .replace(/GST\s*(?:No|Number|#)?[\s:.-]*/gi, "")
        .replace(/GSTIN[\s:.-]*/gi, "")
        .replace(/PAN\s*(?:No|Number|#)?[\s:.-]*/gi, "")
        .replace(/Permanent\s*Account\s*Number[\s:.-]*/gi, "")
        .replace(/MSME\s*(?:No|Number|#)?[\s:.-]*/gi, "")
        .replace(/Udyam\s*(?:Registration)?[\s:.-]*/gi, "")
        .replace(/CIN[\s:.-]*/gi, "")
        .replace(/Corporate\s*Identity\s*Number[\s:.-]*/gi, "")
        .replace(/[\s:-]/g, "")
        .trim();

      // Validate the extracted number format
      if (validateExtractedNumber(extractedNumber, documentType)) {
        return { number: extractedNumber, confidence: 0.9 };
      }
    }
  }

  return { number: null, confidence: 0 };
}

/**
 * Validate extracted number against expected format
 */
function validateExtractedNumber(
  number: string,
  documentType: DocumentType,
): boolean {
  switch (documentType) {
    case "GST":
      // GSTIN: 15 characters
      return /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/.test(
        number,
      );
    case "PAN":
      // PAN: 10 characters
      return /^[A-Z]{5}\d{4}[A-Z]{1}$/.test(number);
    case "MSME":
      // UDYAM format or older formats
      return (
        /^UDYAM[A-Z]{2}\d{2}\d{7}$/.test(number.replace(/-/g, "")) ||
        /^[A-Z]{2}\d{2}[A-Z]{1}\d{7}$/.test(number)
      );
    case "CI":
      // CIN: 21 characters
      return (
        /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/.test(number) ||
        /^[A-Z]{3}\d{4}$/.test(number)
      ); // LLPIN
    default:
      return false;
  }
}

/**
 * Main extraction service function
 */
export async function extractDocumentNumber(
  filePath: string,
  documentType: DocumentType,
): Promise<ExtractionResult> {
  const absolutePath = path.resolve(filePath);

  // Verify file exists
  try {
    await fsp.access(absolutePath);
  } catch {
    return {
      success: false,
      documentType,
      extractedNumber: null,
      confidence: 0,
      filePath: absolutePath,
      error: "File not found",
    };
  }

  try {
    let imagePath = absolutePath;
    const ext = path.extname(absolutePath).toLowerCase();

    // Convert PDF to image if needed
    if (ext === ".pdf") {
      try {
        imagePath = await convertPdfToImage(absolutePath);
      } catch (pdfError) {
        logger.warn("PDF conversion failed, attempting direct OCR:", pdfError);
        // Some Tesseract builds can handle PDFs directly
      }
    }

    // Perform OCR
    const extractedText = await performOCR(imagePath);
    logger.debug(
      `Extracted text from ${documentType} document:`,
      extractedText.substring(0, 500),
    );

    // Extract number from text
    const { number, confidence } = extractNumberFromText(
      extractedText,
      documentType,
    );

    // Clean up temporary image if PDF was converted
    if (ext === ".pdf" && imagePath !== absolutePath) {
      try {
        await fsp.unlink(imagePath);
      } catch (cleanupError) {
        const err = cleanupError as NodeJS.ErrnoException;
        if (err?.code !== "ENOENT") {
          logger.warn("Failed to clean up temporary image:", cleanupError);
        }
      }
    }

    return {
      success: number !== null,
      documentType,
      extractedNumber: number,
      confidence,
      filePath: absolutePath,
    };
  } catch (error) {
    logger.error(`Document extraction failed for ${documentType}:`, error);
    return {
      success: false,
      documentType,
      extractedNumber: null,
      confidence: 0,
      filePath: absolutePath,
      error: error instanceof Error ? error.message : "Extraction failed",
    };
  }
}
