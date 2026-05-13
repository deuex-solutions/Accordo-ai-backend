/**
 * Vector Routes - API routes for vector operations
 */

import { Router } from "express";
import * as controller from "./vector.controller.js";

const router = Router();

// Health check
router.get("/health", controller.getHealth);

export default router;
