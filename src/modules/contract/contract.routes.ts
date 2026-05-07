import { Router } from "express";
import {
  createContract,
  getAllContract,
  getContract,
  updateContract,
  deleteContract,
  getContractDetails,
  approveContract,
} from "./contract.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";

const contractRouter = Router();

// Public route for vendor access via uniqueToken
contractRouter.get("/get-contract-details", getContractDetails);
contractRouter.post("/", authMiddleware, createContract);
contractRouter.get("/", authMiddleware, getAllContract);

// Static sub-routes must come before parameterized /:contractId
contractRouter.put("/approve/:contractId", authMiddleware, approveContract);

contractRouter.get("/:contractId", authMiddleware, getContract);
contractRouter.put("/:contractId", authMiddleware, updateContract);
contractRouter.delete("/:contractId", authMiddleware, deleteContract);

export default contractRouter;
