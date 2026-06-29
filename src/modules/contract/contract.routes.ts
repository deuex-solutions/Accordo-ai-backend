import { Router, type Request, type Response, type NextFunction } from "express";
import {
  createContractService,
  getContractService,
  getContractsService,
  updateContractService,
  deleteContractService,
  getContractDetailsService,
  updateContractStatusService,
} from "./contract.service.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { getNumericParam } from "../../utils/types.js";

const contractRouter = Router();

const resolveUserId = (context?: { userId: number }): number | undefined => context?.userId;

// ============================================================================
// Endpoint Handlers & Routes
// ============================================================================

// Public route for vendor access via uniqueToken
contractRouter.get("/get-contract-details", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const uniqueToken = req.query.uniquetoken;
    if (!uniqueToken || typeof uniqueToken !== "string" || uniqueToken.trim().length === 0) {
      res.status(400).json({ message: "uniqueToken is required" });
      return;
    }
    const contractDetails = await getContractDetailsService(uniqueToken);
    res.status(200).json({ message: "Contract Details", data: contractDetails });
  } catch (error) { next(error); }
});

contractRouter.post("/", authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { skipEmail, skipChatbot, ...contractData } = req.body;
    const data = await createContractService({ ...contractData, createdBy: req.context.userId }, { skipEmail, skipChatbot });
    res.status(201).json({ message: "Contract created successfully", data });
  } catch (error) { next(error); }
});

contractRouter.get("/", authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { search, page = 1, limit = 10, requisitionid, filters } = req.query;
    const parsedPage = parseInt(page as string, 10);
    const parsedLimit = parseInt(limit as string, 10);
    if (isNaN(parsedPage) || parsedPage < 1) { res.status(400).json({ message: "Invalid page number" }); return; }
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) { res.status(400).json({ message: "Invalid limit. Must be between 1 and 100" }); return; }

    const parsedRequisitionId = requisitionid ? parseInt(requisitionid as string, 10) : null;
    if (requisitionid && (isNaN(parsedRequisitionId!) || parsedRequisitionId! <= 0)) {
      res.status(400).json({ message: "Invalid requisition ID" });
      return;
    }

    const data = await getContractsService(search as string | undefined, parsedPage, parsedLimit, parsedRequisitionId, filters as string | undefined);
    res.status(200).json({ message: "Contracts", ...data });
  } catch (error) { next(error); }
});

// Static sub-routes must come before parameterized /:contractId
contractRouter.put("/approve/:contractId", authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const contractId = getNumericParam(req.params.contractId);
    if (isNaN(contractId) || contractId <= 0) { res.status(400).json({ message: "Invalid contract ID" }); return; }
    const userId = resolveUserId(req.context);
    if (!userId) { res.status(401).json({ message: "User authentication required" }); return; }
    const data = await updateContractService(contractId, { ...req.body, status: "Approved" }, userId);
    res.status(200).json({ message: "Contract approved successfully", data });
  } catch (error) { next(error); }
});

contractRouter.get("/:contractId", authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const contractId = getNumericParam(req.params.contractId);
    if (isNaN(contractId) || contractId <= 0) { res.status(400).json({ message: "Invalid contract ID" }); return; }
    const data = await getContractService(contractId);
    res.status(200).json({ message: "Contract", data });
  } catch (error) { next(error); }
});

contractRouter.put("/:contractId", authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const contractId = getNumericParam(req.params.contractId);
    if (isNaN(contractId) || contractId <= 0) { res.status(400).json({ message: "Invalid contract ID" }); return; }
    if (!req.context || !req.context.userId) { res.status(401).json({ message: "Authentication required" }); return; }
    const userId = resolveUserId(req.context);
    if (!userId) { res.status(401).json({ message: "User ID not found in context" }); return; }

    const data = await updateContractService(contractId, req.body, userId, req.body.uniqueToken);
    if (!data) { res.status(404).json({ message: "Contract not found" }); return; }
    res.status(200).json({ message: "Contract updated successfully", data });
  } catch (error) { next(error); }
});

contractRouter.delete("/:contractId", authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const contractId = getNumericParam(req.params.contractId);
    if (isNaN(contractId) || contractId <= 0) { res.status(400).json({ message: "Invalid contract ID" }); return; }
    const data = await deleteContractService(contractId);
    res.status(200).json({ message: "Contract deleted successfully", data });
  } catch (error) { next(error); }
});

export default contractRouter;
