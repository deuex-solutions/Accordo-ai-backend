import { Router } from "express";
import {
  createPo,
  getAllPo,
  getPo,
  cancelPo,
  downloadPo,
} from "./po.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";

const poRouter = Router();

poRouter.post("/", authMiddleware, createPo);
poRouter.get("/", authMiddleware, getAllPo);

// Static sub-routes must come before parameterized /:poId
poRouter.put("/cancel/:poId", authMiddleware, cancelPo);
poRouter.get("/download/:poId", downloadPo);

poRouter.get("/:poId", authMiddleware, getPo);

export default poRouter;
