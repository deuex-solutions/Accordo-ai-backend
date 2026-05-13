import { Router } from "express";
import {
  createContract,
  getAllContract,
  getContract,
  updateContract,
  deleteContract,
  getContractDetails,
  completeContract,
  approveContract,
  updateContractStatus,
} from "./contract.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";

const contractRouter = Router();

// Public route for vendor access via uniqueToken
contractRouter.get("/get-contract-details", getContractDetails);
contractRouter.post("/create", authMiddleware, createContract);
contractRouter.get("/get-all", authMiddleware, getAllContract);
contractRouter.get("/get/:contractid", authMiddleware, getContract);
contractRouter.put("/update/:contractid", authMiddleware, updateContract);
contractRouter.put("/approve/:contractid", authMiddleware, approveContract);
contractRouter.post("/complete-contract", authMiddleware, completeContract);
// Public route for vendor status updates via uniqueToken
contractRouter.post("/update-status", updateContractStatus);
contractRouter.delete("/delete/:contractid", authMiddleware, deleteContract);

// RESTful aliases (frontend uses these; verbose paths above kept for back-compat)
contractRouter.post("/", authMiddleware, createContract);
contractRouter.get("/", authMiddleware, getAllContract);
contractRouter.get("/:contractid", authMiddleware, getContract);
contractRouter.put("/:contractid", authMiddleware, updateContract);
contractRouter.delete("/:contractid", authMiddleware, deleteContract);

export default contractRouter;
