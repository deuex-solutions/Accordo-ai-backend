import { Router, type Request, type Response, type NextFunction } from "express";
import {
  createPoService,
  getAllPoService,
  getPoService,
  cancelPoService,
  downloadPoService,
} from "./po.service.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";

const poRouter = Router();

// ============================================================================
// Endpoint Handlers & Routes
// ============================================================================

poRouter.post("/", authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await createPoService({ ...req.body, addedBy: req.context.userId });
    res.status(201).json({ message: "Po created successfully", data });
  } catch (error) { next(error); }
});

poRouter.get("/", authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { search, page = "1", limit = "10", filters } = req.query;
    const data = await getAllPoService(search as string | undefined, Number(page), Number(limit), req.context.userId, filters as string | undefined);
    res.status(200).json({ message: "Pos", ...data });
  } catch (error) { next(error); }
});

// Static sub-routes must come before parameterized /:poId
poRouter.put("/cancel/:poId", authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await cancelPoService(Number(req.params.poId));
    res.status(200).json({ message: "Po cancelled successfully", data });
  } catch (error) { next(error); }
});

poRouter.get("/download/:poId", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const buffer = await downloadPoService(Number(req.params.poId));
    res.contentType("application/pdf");
    res.send(buffer);
  } catch (error) { next(error); }
});

poRouter.get("/:poId", authMiddleware, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await getPoService(Number(req.params.poId));
    res.status(200).json({ message: "Po", data });
  } catch (error) { next(error); }
});

export default poRouter;
