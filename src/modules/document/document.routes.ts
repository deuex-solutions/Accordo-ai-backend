import { Router, type Request, type Response, type NextFunction } from 'express';
import path from 'path';
import { extractDocumentNumber, type DocumentType } from './document.service.js';
import logger from '../../config/logger.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { uploadDocument } from '../../middlewares/upload.middleware.js';
import { cleanJson } from '../../middlewares/clean.middleware.js';

const documentRouter = Router();

// ============================================================================
// Endpoint Handlers & Routes
// ============================================================================

documentRouter.post(
  '/extract',
  authMiddleware,
  uploadDocument.any(),
  cleanJson,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { documentType } = req.body;
      const validTypes: DocumentType[] = ['GST', 'PAN', 'MSME', 'CI'];
      if (!documentType || !validTypes.includes(documentType)) {
        res.status(400).json({ success: false, message: 'Invalid document type. Must be one of: GST, PAN, MSME, CI' });
        return;
      }
      if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
        res.status(400).json({ success: false, message: 'No file uploaded' });
        return;
      }
      const file = req.files[0];
      const uploadPath = path.resolve(process.cwd(), 'uploads');
      const filePath = path.join(uploadPath, file.filename);

      logger.info(`Processing ${documentType} document: ${file.filename}`);
      const result = await extractDocumentNumber(filePath, documentType as DocumentType);

      res.status(200).json({
        success: result.success,
        message: result.success ? `${documentType} number extracted successfully` : `Could not extract ${documentType} number from document`,
        data: {
          documentType: result.documentType,
          extractedNumber: result.extractedNumber,
          confidence: result.confidence,
          fileName: file.filename,
          originalName: file.originalname,
        },
      });
    } catch (error) {
      logger.error('Document extraction controller error:', error);
      next(error);
    }
  }
);

documentRouter.post(
  '/extract-batch',
  authMiddleware,
  uploadDocument.any(),
  cleanJson,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { documents } = req.body;
      if (!documents || !Array.isArray(documents)) {
        res.status(400).json({ success: false, message: 'Invalid request. Expected documents array.' });
        return;
      }
      if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
        res.status(400).json({ success: false, message: 'No files uploaded' });
        return;
      }

      const uploadPath = path.resolve(process.cwd(), 'uploads');
      const results: Record<string, any> = {};

      for (const file of req.files) {
        const docConfig = documents.find((d: any) => d.fieldName === file.fieldname);
        if (!docConfig) continue;

        const filePath = path.join(uploadPath, file.filename);
        const result = await extractDocumentNumber(filePath, docConfig.documentType as DocumentType);

        results[docConfig.fieldName] = {
          success: result.success,
          extractedNumber: result.extractedNumber,
          confidence: result.confidence,
          fileName: file.filename,
          originalName: file.originalname,
        };
      }

      res.status(200).json({ success: true, message: 'Batch extraction completed', data: results });
    } catch (error) {
      logger.error('Batch document extraction error:', error);
      next(error);
    }
  }
);

export default documentRouter;
