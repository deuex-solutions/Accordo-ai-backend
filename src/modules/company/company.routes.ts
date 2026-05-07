import { Router } from "express";
import {
  createCompany,
  updateCompany,
  getCompany,
  getAllCompany,
  deleteCompany,
  getAddresses,
} from "./company.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { upload } from "../../middlewares/upload.middleware.js";
import { cleanJson } from "../../middlewares/clean.middleware.js";

const companyRouter = Router();

companyRouter.post("/", authMiddleware, upload.any(), cleanJson, createCompany);
companyRouter.get("/", authMiddleware, getAllCompany);

// Get delivery addresses for deal creation wizard
companyRouter.get("/addresses", authMiddleware, getAddresses);

// Parameterized routes must come after static routes
companyRouter.get("/:companyId", authMiddleware, getCompany);

companyRouter.put(
  "/:companyId",
  authMiddleware,
  upload.any(),
  cleanJson,
  updateCompany,
);

companyRouter.delete("/:companyId", authMiddleware, deleteCompany);

export default companyRouter;
