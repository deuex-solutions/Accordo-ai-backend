import { Router } from "express";
import * as controller from "./vector.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";

const router = Router();

// Health check (public/unsecured or secured, typically public for services)
router.get("/health", controller.getHealth);

// Secured vector routes
router.post("/search/messages", authMiddleware, controller.searchMessages);
router.post("/search/deals", authMiddleware, controller.searchDeals);
router.post("/search/patterns", authMiddleware, controller.searchPatterns);
router.post("/context/:dealId", authMiddleware, controller.buildContext);
router.post("/rag/:dealId", authMiddleware, controller.getRAGContext);
router.post("/embed/message/:messageId", authMiddleware, controller.embedMessage);
router.post("/embed/deal/:dealId", authMiddleware, controller.embedDeal);
router.get("/stats", authMiddleware, controller.getStats);

// Migration jobs
router.post("/migrate", authMiddleware, controller.startMigration);
router.get("/migrate/status", authMiddleware, controller.getMigrationStatus);
router.post("/migrate/cancel", authMiddleware, controller.cancelMigration);

export default router;
