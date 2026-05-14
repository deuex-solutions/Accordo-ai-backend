import type { Request, Response, NextFunction } from "express";
import path from "path";
import { extractDocumentNumber, DocumentType } from "./document.service.js";
import env from "../../config/env.js";
import logger from "../../config/logger.js";

/** Sent when ENABLE_DOC_OCR=false — keeps the route registered (so clients
 *  don't get a 404) but communicates that the feature is intentionally off. */
const OCR_DISABLED_RESPONSE = {
  success: false,
  message:
    "Document OCR is disabled on this server. Set ENABLE_DOC_OCR=true to enable.",
};

/**
 * Extract document number from uploaded file
 * POST /api/document/extract
 */
export const extractDocument = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (!env.features.enableDocOcr) {
    res.status(501).json(OCR_DISABLED_RESPONSE);
    return;
  }
  try {
    const { documentType } = req.body;

    // Validate document type
    const validTypes: DocumentType[] = ["GST", "PAN", "MSME", "CI"];
    if (!documentType || !validTypes.includes(documentType)) {
      res.status(400).json({
        success: false,
        message: "Invalid document type. Must be one of: GST, PAN, MSME, CI",
      });
      return;
    }

    // Check if file was uploaded
    if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
      res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
      return;
    }

    const file = req.files[0];
    const uploadPath = path.resolve(process.cwd(), "uploads");
    const filePath = path.join(uploadPath, file.filename);

    logger.info(`Processing ${documentType} document: ${file.filename}`);

    // Extract document number
    const result = await extractDocumentNumber(
      filePath,
      documentType as DocumentType,
    );

    res.status(200).json({
      success: result.success,
      message: result.success
        ? `${documentType} number extracted successfully`
        : `Could not extract ${documentType} number from document`,
      data: {
        documentType: result.documentType,
        extractedNumber: result.extractedNumber,
        confidence: result.confidence,
        fileName: file.filename,
        originalName: file.originalname,
      },
    });
  } catch (error) {
    logger.error("Document extraction controller error:", error);
    next(error);
  }
};

/**
 * Extract multiple document numbers from uploaded files
 * POST /api/document/extract-batch
 */
export const extractDocumentBatch = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (!env.features.enableDocOcr) {
    res.status(501).json(OCR_DISABLED_RESPONSE);
    return;
  }
  try {
    const { documents } = req.body;

    // documents should be an array of { fieldName, documentType }
    if (!documents || !Array.isArray(documents)) {
      res.status(400).json({
        success: false,
        message: "Invalid request. Expected documents array.",
      });
      return;
    }

    if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
      res.status(400).json({
        success: false,
        message: "No files uploaded",
      });
      return;
    }

    const uploadPath = path.resolve(process.cwd(), "uploads");
    const results: Record<string, any> = {};

    for (const file of req.files) {
      const docConfig = documents.find(
        (d: any) => d.fieldName === file.fieldname,
      );
      if (!docConfig) continue;

      const filePath = path.join(uploadPath, file.filename);
      const result = await extractDocumentNumber(
        filePath,
        docConfig.documentType as DocumentType,
      );

      results[docConfig.fieldName] = {
        success: result.success,
        extractedNumber: result.extractedNumber,
        confidence: result.confidence,
        fileName: file.filename,
        originalName: file.originalname,
      };
    }

    res.status(200).json({
      success: true,
      message: "Batch extraction completed",
      data: results,
    });
  } catch (error) {
    logger.error("Batch document extraction error:", error);
    next(error);
  }
};
