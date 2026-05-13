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

companyRouter.post(
  "/create",
  authMiddleware,
  upload.any(),
  cleanJson,
  createCompany,
);

companyRouter.put(
  "/update/:companyid",
  authMiddleware,
  upload.any(),
  cleanJson,
  updateCompany,
);

companyRouter.get("/get-all", authMiddleware, getAllCompany);
companyRouter.get("/get/:companyid", authMiddleware, getCompany);
companyRouter.delete("/delete/:companyid", authMiddleware, deleteCompany);

// Get delivery addresses for deal creation wizard
companyRouter.get("/addresses", authMiddleware, getAddresses);

// RESTful aliases (frontend uses these; verbose paths above kept for back-compat)
companyRouter.post("/", authMiddleware, upload.any(), cleanJson, createCompany);
companyRouter.get("/", authMiddleware, getAllCompany);
companyRouter.get("/:companyid", authMiddleware, getCompany);
companyRouter.put(
  "/:companyid",
  authMiddleware,
  upload.any(),
  cleanJson,
  updateCompany,
);
companyRouter.delete("/:companyid", authMiddleware, deleteCompany);

export default companyRouter;
