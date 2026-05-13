// Bid Comparison Module - Vendor Bid Comparison System
// Compares vendor bids, generates PDF reports, and enables vendor selection

export * from "./bid-comparison.types.js";
export * from "./bid-comparison.service.js";
export * from "./bid-comparison.controller.js";
export { default as bidComparisonRoutes } from "./bid-comparison.routes.js";
export {
  startDeadlineScheduler,
  stopDeadlineScheduler,
  isSchedulerRunning,
  triggerDeadlineCheck,
} from "./scheduler/deadline-checker.js";
export { generateComparisonPDF, getPDFUrl } from "./pdf/pdf-generator.js";
export {
  generateMetricsSummary,
  generateNarrativeSummary,
} from "./summary/summary-generator.js";
