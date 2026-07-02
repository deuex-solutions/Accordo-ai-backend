import { Router, type Request, type Response, type NextFunction } from "express";
import {
  createCompanyService,
  getCompanyService,
  getCompaniesService,
  updadateCompanyService,
  deleteCompanyService,
  getAddressesService,
} from "./company.service.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { upload } from "../../middlewares/upload.middleware.js";
import { cleanJson } from "../../middlewares/clean.middleware.js";

const companyRouter = Router();

// ============================================================================
// Endpoint Handlers & Routes
// ============================================================================

companyRouter.post("/", authMiddleware, upload.any(), cleanJson, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const companyData = { ...req.body, createdBy: req.context?.userId };
    const files = (req.files as Express.Multer.File[]) || [];
    const data = await createCompanyService(companyData, files);
    res.status(201).json({ message: "Company created successfully", data });
  } catch (error) { next(error); }
});

companyRouter.get("/", authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { search, page = "1", limit = "10" } = req.query;
    const data = await getCompaniesService(search as string | undefined, Number(page), Number(limit));
    res.status(200).json({ message: "Companies", data });
  } catch (error) { next(error); }
});

// Get delivery addresses for deal creation wizard
companyRouter.get("/addresses", authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await getAddressesService(req.context.userId);
    res.status(200).json({ message: "Delivery addresses", data });
  } catch (error) { next(error); }
});

// Parameterized routes must come after static routes
companyRouter.get("/:companyId", authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const companyId = req.params.companyId;
    if (!companyId || companyId === "undefined" || companyId === "null") {
      res.status(400).json({ message: "Invalid company ID", data: null, error: "Company ID is required" });
      return;
    }
    const companyIdNum = Number(companyId);
    if (isNaN(companyIdNum)) {
      res.status(400).json({ message: "Invalid company ID", data: null, error: "Company ID must be a valid number" });
      return;
    }
    const data = await getCompanyService(companyIdNum);
    res.status(200).json({ message: "Company Details", data });
  } catch (error) { next(error); }
});

companyRouter.put("/:companyId", authMiddleware, upload.any(), cleanJson, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { companyId } = req.params;
    const files = (req.files as Express.Multer.File[]) || [];
    const companyData = { ...req.body };
    if (typeof companyData.addresses === "string") {
      try { companyData.addresses = JSON.parse(companyData.addresses); } catch { delete companyData.addresses; }
    }
    const data = await updadateCompanyService(Number(companyId), companyData, req.context?.userId as number, files);
    res.status(200).json({ message: "Company updated successfully", data });
  } catch (error) { next(error); }
});

companyRouter.delete("/:companyId", authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await deleteCompanyService(Number(req.params.companyId));
    res.status(200).json({ message: "Company deleted successfully", data });
  } catch (error) { next(error); }
});

export default companyRouter;
