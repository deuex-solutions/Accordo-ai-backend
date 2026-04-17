import { Router } from "express";
import { getDashboardData, getStats } from "./dashboard.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";

const dashboardRouter = Router();

dashboardRouter.get("/", authMiddleware, getDashboardData);
dashboardRouter.get("/stats", authMiddleware, getStats);

export default dashboardRouter;
