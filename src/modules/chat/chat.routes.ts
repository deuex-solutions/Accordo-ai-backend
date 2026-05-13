import { Router } from "express";
import * as controller from "./chat.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";

const router = Router();

// Chat endpoints (protected)
router.get("/sessions", authMiddleware, controller.getSessions);
router.get("/sessions/:sessionId", authMiddleware, controller.getSession);
router.post("/", authMiddleware, controller.sendMessage);

export default router;
