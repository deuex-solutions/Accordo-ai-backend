/**
 * Comprehensive Database Seeder
 * Seeds ALL data from the data directory including:
 * - 20 Companies (4 enterprise + 16 vendors)
 * - 60 Users with role-based credentials
 * - 50 Products across 3 categories
 * - 12 Projects
 * - 15 Requisitions with scoring weights
 * - Contracts and Chatbot Deals
 * - Chat Messages (42 conversations)
 * - Vendor Bids and Comparisons
 * - Vendor Selections and POs
 * - Email Logs
 * - AI/ML Training Data
 *
 * Usage: npm run seed:comprehensive
 * Or: npx tsx src/seeders/comprehensiveSeed.ts
 */

import bcrypt from 'bcrypt';
import {
  Module,
  Role,
  RolePermission,
  Company,
  User,
  Product,
  Project,
  Requisition,
  RequisitionProduct,
  Contract,
  ChatbotDeal,
  ChatbotMessage,
  VendorBid,
  BidComparison,
  VendorSelection,
  VendorNotification,
  Po,
  EmailLog,
  NegotiationTrainingData,
  sequelize,
} from '../models/index.js';
import logger from '../config/logger.js';

// Import seed data
import {
  allCompanies,
  allUsers,
  allProducts,
  allProjects,
  allRequisitions,
  allContracts,
  allChatbotDeals,
  allChatMessages,
  allVendorBids,
  allBidComparisons,
  allSelections,
  allNotifications,
  allPurchaseOrders,
  allEmailLogs,
  allTrainingData,
  getSeedDataSummary,
} from './data/index.js';

/**
 * Seed modules (system permissions)
 */
async function seedModules(): Promise<void> {
  const modules = [
    { id: 1, name: 'Dashboard', isArchived: false },
    { id: 2, name: 'User Management', isArchived: false },
    { id: 3, name: 'Projects', isArchived: false },
    { id: 4, name: 'Requisitions', isArchived: false },
    { id: 5, name: 'Vendors', isArchived: false },
    { id: 6, name: 'Approvals', isArchived: false },
    { id: 7, name: 'Chatbot', isArchived: false },
    { id: 8, name: 'Reports', isArchived: false },
  ];

  for (const moduleData of modules) {
    await Module.findOrCreate({
      where: { id: moduleData.id },
      defaults: moduleData,
    });
  }
  logger.info(`Modules seeded: ${modules.length}`);
}

/**
 * Seed roles
 */
async function seedRoles(): Promise<void> {
  const roles = [
    { id: 1, name: 'Super Admin', companyId: 1, isArchived: false },
    { id: 2, name: 'Procurement Officer', companyId: null, isArchived: false },
    { id: 3, name: 'Project Manager', companyId: null, isArchived: false },
    { id: 4, name: 'Procurement Manager', companyId: null, isArchived: false },
    { id: 5, name: 'Procurement Director', companyId: null, isArchived: false },
    { id: 6, name: 'VP Procurement', companyId: null, isArchived: false },
    { id: 7, name: 'Vendor Sales', companyId: null, isArchived: false },
    { id: 8, name: 'Vendor Accounts', companyId: null, isArchived: false },
  ];

  for (const roleData of roles) {
    await Role.findOrCreate({
      where: { id: roleData.id },
      defaults: roleData,
    });
  }
  logger.info(`Roles seeded: ${roles.length}`);
}

/**
 * Seed role permissions
 */
async function seedRolePermissions(): Promise<void> {
  // Super Admin - full access
  const superAdminPerms = [1, 2, 3, 4, 5, 6, 7, 8].map(moduleId => ({
    roleId: 1,
    moduleId,
    permission: 15,
  }));

  // Procurement Officer - read/write projects and requisitions
  const procOfficerPerms = [
    { roleId: 2, moduleId: 1, permission: 1 },
    { roleId: 2, moduleId: 3, permission: 15 },
    { roleId: 2, moduleId: 4, permission: 15 },
    { roleId: 2, moduleId: 5, permission: 7 },
    { roleId: 2, moduleId: 7, permission: 15 },
  ];

  // Manager/Director/VP - approvals
  const approverPerms = [4, 5, 6].flatMap(roleId => [
    { roleId, moduleId: 1, permission: 1 },
    { roleId, moduleId: 4, permission: 3 },
    { roleId, moduleId: 6, permission: 15 },
  ]);

  // Vendor - limited access
  const vendorPerms = [7, 8].flatMap(roleId => [
    { roleId, moduleId: 1, permission: 1 },
    { roleId, moduleId: 4, permission: 1 },
    { roleId, moduleId: 7, permission: 3 },
  ]);

  const allPerms = [...superAdminPerms, ...procOfficerPerms, ...approverPerms, ...vendorPerms];

  for (const permData of allPerms) {
    await RolePermission.findOrCreate({
      where: { roleId: permData.roleId, moduleId: permData.moduleId },
      defaults: permData,
    });
  }
  logger.info(`Role permissions seeded: ${allPerms.length}`);
}

/**
 * Seed companies
 */
async function seedCompanies(): Promise<void> {
  for (const company of allCompanies) {
    // Map 'International' to 'Interational' (model has typo)
    const nature = company.nature === 'International' ? 'Interational' : company.nature;

    await Company.findOrCreate({
      where: { id: company.id },
      defaults: {
        id: company.id,
        companyName: company.companyName,
        nature: nature as 'Domestic' | 'Interational',
        type: company.type,
        numberOfEmployees: company.numberOfEmployees,
        industryType: company.industryType,
        typeOfCurrency: company.typeOfCurrency,
        pocName: company.pocName,
        pocEmail: company.pocEmail,
        pocPhone: company.pocPhone,
        pocDesignation: company.pocDesignation,
        fullAddress: company.fullAddress,
        bankName: company.bankName,
        accountNumber: company.accountNumber,
        ifscCode: company.ifscCode,
      },
    });
  }
  logger.info(`Companies seeded: ${allCompanies.length}`);
}

/**
 * Seed users with role-based passwords
 * Uses upsert to handle both new inserts and updates to existing records
 */
async function seedUsers(): Promise<void> {
  // First, reset the sequence to avoid conflicts
  const maxSeedId = Math.max(...allUsers.map(u => u.id));
  await sequelize.query(`SELECT setval('"User_id_seq"', ${maxSeedId + 1}, false)`);

  for (const user of allUsers) {
    const hashedPassword = await bcrypt.hash(user.password, 10);

    // Map role to roleId
    let roleId = 2; // Default: Procurement Officer
    if (user.role.includes('Admin')) roleId = 1;
    else if (user.role.includes('Manager')) roleId = 4;
    else if (user.role.includes('Director')) roleId = 5;
    else if (user.role.includes('VP')) roleId = 6;
    else if (user.role.includes('Sales')) roleId = 7;
    else if (user.role.includes('Accounts')) roleId = 8;
    else if (user.role.includes('PM') || user.role.includes('Project')) roleId = 3;

    // Use upsert with explicit ID to handle existing data properly
    await User.upsert({
      id: user.id,
      name: user.name,
      email: user.email,
      password: hashedPassword,
      userType: user.type,
      companyId: user.companyId,
      roleId,
      status: user.isActive ? 'active' : 'inactive',
      approvalLevel: user.approvalLimit ? (
        user.approvalLimit >= 500000 ? 'L3' :
        user.approvalLimit >= 50000 ? 'L2' : 'L1'
      ) : 'NONE',
      approvalLimit: user.approvalLimit || null,
    });
  }
  logger.info(`Users seeded: ${allUsers.length}`);
}

/**
 * Seed products
 */
async function seedProducts(): Promise<void> {
  for (const product of allProducts) {
    await Product.findOrCreate({
      where: { id: product.id },
      defaults: {
        id: product.id,
        productName: product.name,
        category: product.category,
        brandName: product.subcategory,
        gstType: 'GST',
        gstPercentage: 18,
        UOM: product.unit,
        companyId: 1, // All products owned by main enterprise
      },
    });
  }
  logger.info(`Products seeded: ${allProducts.length}`);
}

/**
 * Seed projects
 */
async function seedProjects(): Promise<void> {
  for (const project of allProjects) {
    await Project.findOrCreate({
      where: { id: project.id },
      defaults: {
        id: project.id,
        projectId: project.projectId,
        projectName: project.name,
        projectAddress: project.description,
        typeOfProject: project.category,
        tenureInDays: Math.ceil((project.endDate.getTime() - project.startDate.getTime()) / (1000 * 60 * 60 * 24)),
        companyId: project.companyId,
      },
    });
  }
  logger.info(`Projects seeded: ${allProjects.length}`);
}

/**
 * Seed requisitions and their products
 * Uses upsert to update existing records with new fields (maxDeliveryDate, companyId)
 */
async function seedRequisitions(): Promise<void> {
  // Reset the RequisitionProducts sequence to avoid ID conflicts
  // Get the current max ID and set sequence to start after it
  const [result] = await sequelize.query(
    'SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM "RequisitionProducts"'
  ) as [{ next_id: number }[], unknown];
  const nextId = result[0]?.next_id || 1;
  await sequelize.query(`SELECT setval('"RequisitionProducts_id_seq"', ${nextId}, false)`);

  for (const req of allRequisitions) {
    // Use upsert to update existing requisitions with new fields
    await Requisition.upsert({
      id: req.id,
      projectId: req.projectId,
      rfqId: req.rfqId,
      subject: req.title,
      category: req.products[0]?.productId ? 'Mixed' : 'General',
      deliveryDate: req.deliveryDate,
      maxDeliveryDate: req.maxDeliveryDate,  // Hard deadline for delivery
      negotiationClosureDate: req.negotiationClosureDate,
      typeOfCurrency: 'USD',
      totalPrice: req.estimatedValue,
      status: req.status,
      payment_terms: 'Net 30',
      net_payment_day: '30',
      batna: req.estimatedValue * 0.9,
      maxDiscount: 15,
      createdBy: req.createdById,
      approvalStatus: 'FULLY_APPROVED',
      totalEstimatedAmount: req.estimatedValue,
      requiredApprovalLevel: req.estimatedValue > 50000 ? 'L2' : 'L1',
    });

    // Seed requisition products
    for (let i = 0; i < req.products.length; i++) {
      const product = req.products[i];
      await RequisitionProduct.findOrCreate({
        where: { requisitionId: req.id, productId: product.productId },
        defaults: {
          requisitionId: req.id,
          productId: product.productId,
          targetPrice: product.targetUnitPrice,
          maximum_price: product.targetUnitPrice * 1.2,
          qty: product.quantity,
          createdBy: req.createdById,
        },
      });
    }
  }
  logger.info(`Requisitions seeded: ${allRequisitions.length}`);
}

/**
 * Map seed contract status to model contract status
 */
function mapContractStatus(seedStatus: string): 'Created' | 'Opened' | 'Completed' | 'Verified' | 'Accepted' | 'Rejected' | 'Expired' | 'InitialQuotation' {
  const statusMap: Record<string, 'Created' | 'Opened' | 'Completed' | 'Verified' | 'Accepted' | 'Rejected' | 'Expired' | 'InitialQuotation'> = {
    'Draft': 'Created',
    'Sent': 'InitialQuotation',
    'Opened': 'Opened',
    'InNegotiation': 'Opened',
    'Accepted': 'Accepted',
    'Rejected': 'Rejected',
    'Expired': 'Expired',
  };
  return statusMap[seedStatus] || 'Created';
}

/**
 * Seed contracts and chatbot deals
 */
async function seedContractsAndDeals(): Promise<void> {
  // First create chatbot deals
  for (const deal of allChatbotDeals) {
    await ChatbotDeal.findOrCreate({
      where: { id: deal.id },
      defaults: {
        id: deal.id,
        title: deal.title,
        status: deal.status,
        mode: deal.mode,
        round: deal.round,
        requisitionId: deal.requisitionId,
        vendorId: deal.vendorId,
        userId: deal.createdById,
        negotiationConfigJson: deal.negotiationConfigJson,
      },
    });
  }
  logger.info(`Chatbot deals seeded: ${allChatbotDeals.length}`);

  // Then create contracts
  for (const contract of allContracts) {
    await Contract.findOrCreate({
      where: { id: contract.id },
      defaults: {
        id: contract.id,
        companyId: 1, // Main enterprise
        requisitionId: contract.requisitionId,
        vendorId: contract.vendorUserId,
        status: mapContractStatus(contract.status),
        chatbotDealId: contract.chatbotDealId,
        createdBy: 2, // Procurement user
      },
    });

    // Update deal with contract ID
    if (contract.chatbotDealId) {
      await ChatbotDeal.update(
        { contractId: contract.id },
        { where: { id: contract.chatbotDealId } }
      );
    }
  }
  logger.info(`Contracts seeded: ${allContracts.length}`);
}

/**
 * Seed chat messages
 */
async function seedChatMessages(): Promise<void> {
  for (const message of allChatMessages) {
    // Note: Model doesn't have 'round' field, only deals have rounds
    const engineDecision = message.engineDecision;
    await ChatbotMessage.findOrCreate({
      where: { id: message.id },
      defaults: {
        id: message.id,
        dealId: message.dealId,
        role: message.role,
        content: message.content,
        extractedOffer: message.extractedOffer || null,
        engineDecision: engineDecision || null,
        decisionAction: engineDecision?.action || null,
        utilityScore: engineDecision?.utilityScore || null,
        counterOffer: engineDecision?.counterOffer || null,
      },
    });
  }
  logger.info(`Chat messages seeded: ${allChatMessages.length}`);
}

/**
 * Seed vendor bids
 */
async function seedVendorBids(): Promise<void> {
  for (const bid of allVendorBids) {
    // Map seed chatSummaryMetrics to model ChatSummaryMetrics interface
    const chatSummaryMetrics = {
      totalRounds: bid.chatSummaryMetrics.totalRounds,
      initialPrice: bid.chatSummaryMetrics.startPrice,
      finalPrice: bid.chatSummaryMetrics.finalPrice,
      priceReductionPercent: bid.chatSummaryMetrics.priceReduction,
      initialPaymentTerms: bid.paymentTerms,
      finalPaymentTerms: bid.paymentTerms,
      keyDecisions: [] as Array<{ round: number; action: string; utilityScore: number }>,
      negotiationDurationHours: bid.chatSummaryMetrics.negotiationDays * 24,
      averageUtilityScore: bid.utilityScore,
    };

    await VendorBid.findOrCreate({
      where: { id: bid.id },
      defaults: {
        id: bid.id,
        requisitionId: bid.requisitionId,
        contractId: bid.contractId,
        dealId: bid.dealId,
        vendorId: bid.vendorUserId,
        finalPrice: bid.finalPrice,
        unitPrice: bid.unitPrice,
        paymentTerms: bid.paymentTerms,
        deliveryDate: new Date(bid.createdAt),
        utilityScore: bid.utilityScore,
        bidStatus: bid.bidStatus,
        dealStatus: bid.dealStatus,
        chatSummaryMetrics,
        chatSummaryNarrative: bid.chatSummaryNarrative,
      },
    });
  }
  logger.info(`Vendor bids seeded: ${allVendorBids.length}`);
}

/**
 * Seed bid comparisons
 */
async function seedBidComparisons(): Promise<void> {
  for (const comparison of allBidComparisons) {
    // Map seed topBids to model TopBidInfo interface
    const topBidsJson = comparison.topBids.map((bid, index) => ({
      bidId: `bid-${comparison.requisitionId}-${index}`,
      vendorId: bid.vendorCompanyId,
      vendorName: bid.vendorName,
      vendorEmail: `vendor${bid.vendorCompanyId}@example.com`,
      finalPrice: bid.finalPrice,
      unitPrice: bid.finalPrice / 100, // Approximation
      paymentTerms: bid.paymentTerms,
      deliveryDate: null,
      utilityScore: bid.score / 100, // Convert score to 0-1 range
      rank: index + 1,
      chatLink: null,
    }));

    await BidComparison.findOrCreate({
      where: { id: comparison.id },
      defaults: {
        id: comparison.id,
        requisitionId: comparison.requisitionId,
        triggeredBy: comparison.triggeredBy,
        totalVendors: comparison.totalVendors,
        completedVendors: comparison.completedVendors,
        excludedVendors: comparison.excludedVendors,
        topBidsJson,
        pdfUrl: comparison.pdfUrl,
        emailStatus: 'SENT', // Required field
      },
    });
  }
  logger.info(`Bid comparisons seeded: ${allBidComparisons.length}`);
}

/**
 * Map seed PO status to model PO status
 */
function mapPoStatus(seedStatus: string): 'Created' | 'Cancelled' | null {
  const statusMap: Record<string, 'Created' | 'Cancelled' | null> = {
    'Draft': 'Created',
    'Sent': 'Created',
    'Acknowledged': 'Created',
    'Fulfilled': 'Created',
    'Cancelled': 'Cancelled',
  };
  return statusMap[seedStatus] || 'Created';
}

/**
 * Seed vendor selections, notifications, and POs
 * Order: POs first (because Selections reference POs), then Selections, then Notifications
 */
async function seedSelectionsAndPos(): Promise<void> {
  // Purchase Orders FIRST (selections reference POs via poId)
  for (const po of allPurchaseOrders) {
    await Po.findOrCreate({
      where: { id: po.id },
      defaults: {
        id: po.id,
        poNumber: po.poNumber,
        requisitionId: po.requisitionId,
        vendorId: po.vendorUserId,
        total: po.totalAmount,
        status: mapPoStatus(po.status),
        paymentTerms: po.paymentTerms,
        deliveryDate: po.deliveryDate,
        addedBy: po.createdById,
      },
    });
  }
  logger.info(`Purchase orders seeded: ${allPurchaseOrders.length}`);

  // Selections (reference POs)
  // Use requisitionId as unique key since the model has a unique constraint on it
  for (const selection of allSelections) {
    await VendorSelection.findOrCreate({
      where: { requisitionId: selection.requisitionId },
      defaults: {
        id: selection.id,
        requisitionId: selection.requisitionId,
        comparisonId: selection.comparisonId,
        selectedVendorId: selection.selectedVendorId,
        selectedBidId: selection.selectedBidId,
        selectedPrice: selection.selectedPrice,
        selectedByUserId: selection.selectedByUserId,
        selectionReason: selection.selectionReason,
        selectionMethod: selection.selectionMethod,
        poId: selection.poId,
        selectedAt: selection.createdAt, // Required field
      },
    });
  }
  logger.info(`Vendor selections seeded: ${allSelections.length}`);

  // Notifications (reference Selections)
  // Get actual selection IDs from database since findOrCreate may return existing records
  const existingSelections = await VendorSelection.findAll({ attributes: ['id'] });
  const existingSelectionIds = new Set(existingSelections.map(s => s.id));

  let notificationCount = 0;
  for (const notification of allNotifications) {
    // Skip if the selection doesn't exist (may have been skipped due to existing record)
    if (!existingSelectionIds.has(notification.selectionId)) {
      continue;
    }
    await VendorNotification.findOrCreate({
      where: { id: notification.id },
      defaults: {
        id: notification.id,
        selectionId: notification.selectionId,
        vendorId: notification.vendorUserId,
        bidId: notification.bidId,
        notificationType: notification.notificationType,
        emailStatus: 'SENT', // Required field with default
      },
    });
    notificationCount++;
  }
  logger.info(`Vendor notifications seeded: ${notificationCount}`);
}

/**
 * Map seed email type to model email type
 */
function mapEmailType(seedType: string): 'vendor_attached' | 'status_change' | 'reminder' | 'other' {
  const typeMap: Record<string, 'vendor_attached' | 'status_change' | 'reminder' | 'other'> = {
    'vendor_attached': 'vendor_attached',
    'status_change': 'status_change',
    'escalation': 'other',
    'comparison_ready': 'other',
    'selection_won': 'status_change',
    'selection_lost': 'status_change',
    'po_created': 'other',
    'deadline_reminder': 'reminder',
  };
  return typeMap[seedType] || 'other';
}

/**
 * Seed email logs
 */
async function seedEmailLogs(): Promise<void> {
  for (const email of allEmailLogs) {
    await EmailLog.findOrCreate({
      where: { id: email.id },
      defaults: {
        id: email.id,
        recipientEmail: email.recipientEmail,
        recipientId: email.recipientId,
        subject: email.subject,
        emailType: mapEmailType(email.emailType),
        status: email.status,
        contractId: email.contractId,
        requisitionId: email.requisitionId,
        metadata: email.metadata,
        errorMessage: email.errorMessage,
        retryCount: email.retryCount,
        messageId: email.messageId,
      },
    });
  }
  logger.info(`Email logs seeded: ${allEmailLogs.length}`);
}

/**
 * Seed training data
 */
async function seedTrainingData(): Promise<void> {
  for (const data of allTrainingData) {
    // Model expects auto-increment integer id, so use findOrCreate with dealId+round
    await NegotiationTrainingData.findOrCreate({
      where: {
        dealId: data.dealId,
        round: data.round,
      },
      defaults: {
        // id is auto-generated
        dealId: data.dealId,
        userId: data.userId,
        round: data.round,
        suggestionsJson: data.suggestionsJson,
        conversationContext: data.conversationContext,
        configSnapshot: data.configSnapshot,
        llmModel: data.llmModel,
        generationSource: data.generationSource,
        selectedScenario: data.selectedScenario,
        selectedSuggestion: data.selectedSuggestion,
        dealOutcome: data.dealOutcome,
      },
    });
  }
  logger.info(`Training data seeded: ${allTrainingData.length}`);
}

/**
 * Print credentials summary
 */
function printCredentialsSummary(): void {
  logger.info('');
  logger.info('═══════════════════════════════════════════════════════════════');
  logger.info('                    SEED DATA COMPLETE                          ');
  logger.info('═══════════════════════════════════════════════════════════════');
  logger.info('');

  const summary = getSeedDataSummary();
  logger.info('Summary:');
  logger.info(`  Companies:     ${summary.companies.total} (${summary.companies.enterprise} enterprise, ${summary.companies.vendor} vendor)`);
  logger.info(`  Users:         ${summary.users.total} (see TEST_CREDENTIALS.md for passwords)`);
  logger.info(`  Products:      ${summary.products.total}`);
  logger.info(`  Projects:      ${summary.projects.total}`);
  logger.info(`  Requisitions:  ${summary.requisitions.total}`);
  logger.info(`  Contracts:     ${summary.contracts.total}`);
  logger.info(`  Chatbot Deals: ${summary.contracts.withDeals}`);
  logger.info(`  Chat Messages: ${summary.chatMessages}`);
  logger.info(`  Vendor Bids:   ${summary.vendorBids}`);
  logger.info(`  Selections:    ${summary.selections}`);
  logger.info(`  POs:           ${summary.purchaseOrders}`);
  logger.info(`  Email Logs:    ${summary.emailLogs}`);
  logger.info('');
  logger.info('Quick Login Credentials:');
  logger.info('  Admin:       admin@accordo.ai / Admin@2026!');
  logger.info('  Procurement: procurement@accordo.ai / Procure@2026!');
  logger.info('  Manager:     manager@accordo.ai / Manager@2026!');
  logger.info('  Vendor:      sales@techsupply.com / Vendor@2026!');
  logger.info('');
  logger.info('See /docs/TEST_CREDENTIALS.md for full credentials list');
  logger.info('═══════════════════════════════════════════════════════════════');
}

/**
 * Main seeder function
 */
export async function seedComprehensive(): Promise<void> {
  try {
    logger.info('Starting comprehensive seed...');

    // Core system data
    await seedModules();
    await seedRoles();
    await seedRolePermissions();

    // Entity data
    await seedCompanies();
    await seedUsers();
    await seedProducts();
    await seedProjects();

    // Business data
    await seedRequisitions();
    await seedContractsAndDeals();
    await seedChatMessages();

    // Bid management
    await seedVendorBids();
    await seedBidComparisons();
    await seedSelectionsAndPos();

    // Audit and ML data
    await seedEmailLogs();
    await seedTrainingData();

    printCredentialsSummary();
  } catch (error) {
    logger.error('Error during comprehensive seed:', error);
    throw error;
  }
}

// Run directly if executed as script
console.log('Script starting...');
console.log('import.meta.url:', import.meta.url);
console.log('process.argv[1]:', process.argv[1]);

// Always run when executed as script (tsx doesn't match import.meta.url correctly)
sequelize
  .authenticate()
  .then(() => {
    console.log('Database connected, starting seed...');
    return seedComprehensive();
  })
  .then(() => {
    console.log('Comprehensive seed completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  });

export default seedComprehensive;
