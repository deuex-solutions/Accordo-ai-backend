/**
 * Seed Data Index - Export all seed data modules
 */

// Companies
export {
  type CompanyData,
  enterpriseCompanies,
  vendorCompanies,
  allCompanies,
  getVendorCompanies,
  getEnterpriseCompanies,
  getCompanyById,
  getVendorRating,
} from './companies.js';

// Users
export {
  type UserData,
  ROLE_PASSWORDS,
  enterpriseUsers,
  vendorUsers,
  systemUsers,
  allUsers,
  getUserById,
  getUsersByCompany,
  getUsersByType,
  getApprovers,
  getProcurementUsers,
  getVendorSalesUsers,
  getUserByEmail,
  getApproverByLevel,
} from './users.js';

// Products
export {
  type ProductData,
  itProducts,
  officeProducts,
  manufacturingProducts,
  allProducts,
  getProductById,
  getProductsByCategory,
  getProductsBySubcategory,
  getProductsBySku,
  getRandomProducts,
  getProductsForSector,
} from './products.js';

// Projects
export {
  type ProjectData,
  allProjects,
  getProjectById,
  getProjectByProjectId,
  getProjectsByCompany,
  getProjectsByStatus,
  getActiveProjects,
  getProjectsByCategory,
  getProjectsForProductCategory,
} from './projects.js';

// Requisitions
export {
  type RequisitionData,
  type RequisitionProductData,
  type RequisitionVendorData,
  allRequisitions,
  getRequisitionById,
  getRequisitionByRfqId,
  getRequisitionsByCompany,
  getRequisitionsByStatus,
  getRequisitionsByProject,
  getActiveRequisitions,
  getDraftRequisitions,
  getAwardedRequisitions,
  getRequisitionsForVendor,
  getRequisitionsByVendorCount,
  getHighValueRequisitions,
} from './requisitions.js';

// Contracts and Chatbot Deals
export {
  type ContractData,
  type ChatbotDealData,
  type NegotiationConfigData,
  allContracts,
  allChatbotDeals,
  getContractById,
  getContractsByRequisition,
  getContractsByVendor,
  getContractsByStatus,
  getContractsWithDeals,
  getDealById,
  getDealsByStatus,
  getDealsByRequisition,
  getDealsByVendor,
  getActiveDeals,
  getCompletedDeals,
  getEscalatedDeals,
  getDealWithContract,
} from './contracts.js';

// Chat Messages
export {
  type ChatMessageData,
  allChatMessages,
  getMessagesByDeal,
  getMessagesByRole,
  getLastMessage,
  getVendorOffers,
  getAccordoDecisions,
  getConversationLength,
  getShortConversations,
  getMediumConversations,
  getLongConversations,
} from './chat-messages.js';

// Vendor Bids and Comparisons
export {
  type VendorBidData,
  type BidComparisonData,
  allVendorBids,
  allBidComparisons,
  getBidById,
  getBidsByRequisition,
  getBidsByVendor,
  getBidsByStatus,
  getBidsByRank,
  getL1Bids,
  getL2Bids,
  getL3Bids,
  getCompletedBids,
  getExcludedBids,
  getComparisonById,
  getComparisonByRequisition,
  getComparisonsWithMultipleBids,
  getComparisonsWithCloseCompetition,
  getClearWinnerScenarios,
  getTradeOffScenarios,
} from './vendor-bids.js';

// Selections and Purchase Orders
export {
  type VendorSelectionData,
  type VendorNotificationData,
  type PurchaseOrderData,
  allSelections,
  allNotifications,
  allPurchaseOrders,
  getSelectionById,
  getSelectionByRequisition,
  getSelectionsByVendor,
  getSelectionsByApprovalStatus,
  getPendingApprovals,
  getApprovedSelections,
  getNotificationsBySelection,
  getNotificationsByVendor,
  getWinNotifications,
  getLostNotifications,
  getPoById,
  getPoByNumber,
  getPoByRequisition,
  getPosByVendor,
  getPosByStatus,
  getOpenPos,
  getTotalPoValue,
  getPoValueByVendor,
} from './selections.js';

// Email Logs
export {
  type EmailLogData,
  allEmailLogs,
  getEmailLogById,
  getEmailLogsByRecipient,
  getEmailLogsByType,
  getEmailLogsByStatus,
  getEmailLogsByContract,
  getEmailLogsByRequisition,
  getSentEmails,
  getFailedEmails,
  getEmailsByDateRange,
  getEmailStats,
} from './email-logs.js';

// Training Data and Embeddings
export {
  type NegotiationTrainingData,
  type MessageEmbeddingData,
  type DealEmbeddingData,
  type NegotiationPatternData,
  allTrainingData,
  allMessageEmbeddings,
  allDealEmbeddings,
  allNegotiationPatterns,
  getTrainingDataByDeal,
  getTrainingDataByOutcome,
  getTrainingDataBySource,
  getEmbeddingsByDeal,
  getEmbeddingsByRole,
  getDealEmbeddingsByStatus,
  getActivePatterns,
  getPatternsByType,
  getTrainingDataStats,
} from './training-data.js';

// Summary statistics - static values based on seed configuration
export const getSeedDataSummary = () => {
  return {
    companies: {
      total: 20,
      enterprise: 4,
      vendor: 16,
    },
    users: {
      total: 60,
      enterprise: 24,
      vendor: 32,
      system: 4,
    },
    products: {
      total: 50,
      it: 20,
      office: 15,
      manufacturing: 15,
    },
    projects: {
      total: 12,
      active: 8,
      completed: 4,
    },
    requisitions: {
      total: 15,
      draft: 5,
      negotiating: 5,
      awarded: 3,
      expired: 2,
    },
    contracts: {
      total: 41, // From seed configuration
      withDeals: 22,
    },
    chatMessages: '200+', // Variable due to randomization
    vendorBids: 22,
    comparisons: 8,
    selections: 3,
    purchaseOrders: 3,
    emailLogs: 77,
    trainingData: 22,
  };
};
