import { Sequelize, Model } from 'sequelize';
import sequelize from '../config/database.js';

import authTokenModel, { AuthToken } from './auth/auth-token.js';
import companyModel, { Company } from './auth/company.js';
import contractModel, { Contract } from './procurement/contract.js';
import moduleModel, { Module } from './auth/module.js';
import otpModel, { Otp } from './auth/otp.js';
import poModel, { Po } from './procurement/po.js';
import productModel, { Product } from './procurement/product.js';
import projectModel, { Project } from './procurement/project.js';
import projectPocModel, { ProjectPoc } from './procurement/project-poc.js';
import requisitionModel, { Requisition } from './procurement/requisition.js';
import requisitionAttachmentModel, { RequisitionAttachment } from './procurement/requisition-attachment.js';
import requisitionProductModel, { RequisitionProduct } from './procurement/requisition-product.js';
import roleModel, { Role } from './auth/role.js';
import rolePermissionModel, { RolePermission } from './auth/role-permission.js';
import userModel, { User } from './auth/user.js';
import userActionModel, { UserAction } from './system/user-action.js';
import vendorCompanyModel, { VendorCompany } from './vendor/vendor-company.js';
import negotiationModel, { Negotiation } from './chatbot/negotiation.js';
import negotiationRoundModel, { NegotiationRound } from './chatbot/negotiation-round.js';
import preferenceModel, { Preference } from './vendor/preference.js';
import chatSessionModel, { ChatSession } from './chatbot/chat-session.js';
import emailLogModel, { EmailLog } from './system/email-log.js';
import { initChatbotTemplateModel, ChatbotTemplate } from './chatbot/chatbot-template.js';
import { initChatbotTemplateParameterModel, ChatbotTemplateParameter } from './chatbot/chatbot-template-parameter.js';
import { initChatbotDealModel, ChatbotDeal } from './chatbot/chatbot-deal.js';
import { initChatbotMessageModel, ChatbotMessage } from './chatbot/chatbot-message.js';
import { initNegotiationTrainingDataModel, NegotiationTrainingData } from './chatbot/negotiation-training-data.js';
import { initMessageEmbeddingModel, MessageEmbedding } from './vector/message-embedding.js';
import { initDealEmbeddingModel, DealEmbedding } from './vector/deal-embedding.js';
import { initNegotiationPatternModel, NegotiationPattern } from './chatbot/negotiation-pattern.js';
import { initVectorMigrationStatusModel, VectorMigrationStatus } from './vector/vector-migration-status.js';
import { initMesoRoundModel, MesoRound } from './chatbot/meso-round.js';
import { initVendorNegotiationProfileModel, VendorNegotiationProfile } from './chatbot/vendor-negotiation-profile.js';
import vendorBidModel, { VendorBid } from './vendor/vendor-bid.js';
import bidComparisonModel, { BidComparison } from './vendor/bid-comparison.js';
import vendorSelectionModel, { VendorSelection } from './vendor/vendor-selection.js';
import vendorNotificationModel, { VendorNotification } from './vendor/vendor-notification.js';
import { initApprovalModel, Approval } from './procurement/approval.js';
import addressModel, { Address } from './system/address.js';
import bidActionHistoryModel, { BidActionHistory } from './vendor/bid-action-history.js';
import ApiUsageLog from './system/api-usage-log.js';

// Type definitions for the models collection
export interface Models {
  User: typeof User;
  Otp: typeof Otp;
  Po: typeof Po;
  Role: typeof Role;
  UserAction: typeof UserAction;
  RolePermission: typeof RolePermission;
  Module: typeof Module;
  AuthToken: typeof AuthToken;
  Product: typeof Product;
  Company: typeof Company;
  Project: typeof Project;
  ProjectPoc: typeof ProjectPoc;
  Requisition: typeof Requisition;
  RequisitionProduct: typeof RequisitionProduct;
  RequisitionAttachment: typeof RequisitionAttachment;
  Contract: typeof Contract;
  VendorCompany: typeof VendorCompany;
  Negotiation: typeof Negotiation;
  NegotiationRound: typeof NegotiationRound;
  Preference: typeof Preference;
  ChatSession: typeof ChatSession;
  EmailLog: typeof EmailLog;
  ChatbotTemplate: typeof ChatbotTemplate;
  ChatbotTemplateParameter: typeof ChatbotTemplateParameter;
  ChatbotDeal: typeof ChatbotDeal;
  ChatbotMessage: typeof ChatbotMessage;
  NegotiationTrainingData: typeof NegotiationTrainingData;
  MessageEmbedding: typeof MessageEmbedding;
  DealEmbedding: typeof DealEmbedding;
  NegotiationPattern: typeof NegotiationPattern;
  VectorMigrationStatus: typeof VectorMigrationStatus;
  MesoRound: typeof MesoRound;
  VendorNegotiationProfile: typeof VendorNegotiationProfile;
  VendorBid: typeof VendorBid;
  BidComparison: typeof BidComparison;
  VendorSelection: typeof VendorSelection;
  VendorNotification: typeof VendorNotification;
  Approval: typeof Approval;
  Address: typeof Address;
  BidActionHistory: typeof BidActionHistory;
  ApiUsageLog: typeof ApiUsageLog;
  // Legacy aliases
  Vendor: typeof User;
  vendorCompany: typeof VendorCompany;
}

// Initialize all models
const models: Models = {
  User: userModel(sequelize),
  Otp: otpModel(sequelize),
  Po: poModel(sequelize),
  Role: roleModel(sequelize),
  UserAction: userActionModel(sequelize),
  RolePermission: rolePermissionModel(sequelize),
  Module: moduleModel(sequelize),
  AuthToken: authTokenModel(sequelize),
  Product: productModel(sequelize),
  Company: companyModel(sequelize),
  Project: projectModel(sequelize),
  ProjectPoc: projectPocModel(sequelize),
  Requisition: requisitionModel(sequelize),
  RequisitionProduct: requisitionProductModel(sequelize),
  RequisitionAttachment: requisitionAttachmentModel(sequelize),
  Contract: contractModel(sequelize),
  VendorCompany: vendorCompanyModel(sequelize),
  Negotiation: negotiationModel(sequelize),
  NegotiationRound: negotiationRoundModel(sequelize),
  Preference: preferenceModel(sequelize),
  ChatSession: chatSessionModel(sequelize),
  EmailLog: emailLogModel(sequelize),
  ChatbotTemplate: initChatbotTemplateModel(sequelize),
  ChatbotTemplateParameter: initChatbotTemplateParameterModel(sequelize),
  ChatbotDeal: initChatbotDealModel(sequelize),
  ChatbotMessage: initChatbotMessageModel(sequelize),
  NegotiationTrainingData: initNegotiationTrainingDataModel(sequelize),
  MessageEmbedding: initMessageEmbeddingModel(sequelize),
  DealEmbedding: initDealEmbeddingModel(sequelize),
  NegotiationPattern: initNegotiationPatternModel(sequelize),
  VectorMigrationStatus: initVectorMigrationStatusModel(sequelize),
  MesoRound: initMesoRoundModel(sequelize),
  VendorNegotiationProfile: initVendorNegotiationProfileModel(sequelize),
  VendorBid: vendorBidModel(sequelize),
  BidComparison: bidComparisonModel(sequelize),
  VendorSelection: vendorSelectionModel(sequelize),
  VendorNotification: vendorNotificationModel(sequelize),
  Approval: initApprovalModel(sequelize),
  Address: addressModel(sequelize),
  BidActionHistory: bidActionHistoryModel(sequelize),
  ApiUsageLog: ApiUsageLog,
  // Maintain legacy aliases
  Vendor: null as unknown as typeof User,
  vendorCompany: null as unknown as typeof VendorCompany,
};

// Set legacy aliases
models.Vendor = models.User;
models.vendorCompany = models.VendorCompany;

// Run associations
const uniqueModels = new Set(Object.values(models));
uniqueModels.forEach((model) => {
  if (model && typeof (model as typeof Model & { associate?: (models: Record<string, typeof Model>) => void }).associate === 'function') {
    (model as typeof Model & { associate: (models: Record<string, typeof Model>) => void }).associate(models as unknown as Record<string, typeof Model>);
  }
});

// Export individual models for direct import
export {
  User,
  Otp,
  Po,
  Role,
  UserAction,
  RolePermission,
  Module,
  AuthToken,
  Product,
  Company,
  Project,
  ProjectPoc,
  Requisition,
  RequisitionProduct,
  RequisitionAttachment,
  Contract,
  VendorCompany,
  Negotiation,
  NegotiationRound,
  Preference,
  ChatSession,
  EmailLog,
  ChatbotTemplate,
  ChatbotTemplateParameter,
  ChatbotDeal,
  ChatbotMessage,
  NegotiationTrainingData,
  MessageEmbedding,
  DealEmbedding,
  NegotiationPattern,
  VectorMigrationStatus,
  MesoRound,
  VendorNegotiationProfile,
  VendorBid,
  BidComparison,
  VendorSelection,
  VendorNotification,
  Approval,
  Address,
  BidActionHistory,
  ApiUsageLog,
  sequelize,
};

export default models;
