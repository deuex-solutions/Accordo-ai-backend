import { Router } from "express";
import env from "../config/env.js";
import authRoutes from "../modules/auth/auth.routes.js";
import { createAuthProxyRouter } from "./auth-proxy.routes.js";
import companyRoutes from "../modules/company/company.routes.js";
import requisitionRoutes from "../modules/requisition/requisition.routes.js";
import contractRoutes from "../modules/contract/contract.routes.js";
import poRoutes from "../modules/po/po.routes.js";
import vendorRoutes from "../modules/vendor/vendor.routes.js";
import productRoutes from "../modules/product/product.routes.js";
import projectRoutes from "../modules/project/project.routes.js";
import roleRoutes from "../modules/role/role.routes.js";
import userRoutes from "../modules/user/user.routes.js";
import customerRoutes from "../modules/customer/customer.routes.js";
import dashboardRoutes from "../modules/dashboard/dashboard.routes.js";
import chatRoutes from "../modules/chat/chat.routes.js";
import chatbotRoutes from "../modules/chatbot/chatbot.routes.js";
import vectorRoutes from "../modules/vector/vector.routes.js";
import bidAnalysisRoutes from "../modules/bid-analysis/bid-analysis.routes.js";
import healthRoutes from "../modules/health/health.routes.js";
import documentRoutes from "../modules/document/document.routes.js";
import vendorChatRoutes from "../modules/vendor-chat/vendor-chat.routes.js";

const router = Router();

// Health check routes (comprehensive)
router.use("/health", healthRoutes);

// Public vendor chat routes (no authMiddleware)
router.use("/vendor-chat", vendorChatRoutes);

const authStack = process.env.AUTH_SERVICE_URL
  ? createAuthProxyRouter(env.authServiceUrl)
  : authRoutes;
router.use("/auth", authStack);
router.use("/company", companyRoutes);
router.use("/requisition", requisitionRoutes);
router.use("/contract", contractRoutes);
router.use("/po", poRoutes);
router.use("/vendor-management", vendorRoutes);
router.use("/vendor", vendorRoutes); // Alias for backward compatibility
router.use("/product", productRoutes);
router.use("/project", projectRoutes);
router.use("/role", roleRoutes);
router.use("/user", userRoutes);
router.use("/customer", customerRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/chat", chatRoutes);
router.use("/chatbot", chatbotRoutes);
router.use("/vector", vectorRoutes);
router.use("/bid-analysis", bidAnalysisRoutes);
router.use("/document", documentRoutes);

export default router;
