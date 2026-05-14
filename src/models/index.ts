import { Model } from 'sequelize';
import sequelize from '../config/database.js';

import authTokenModel, { AuthToken } from './auth-token.js';
import companyModel, { Company } from './company.js';
import contractModel, { Contract } from './contract.js';
import moduleModel, { Module } from './module.js';
import otpModel, { Otp } from './otp.js';
import poModel, { Po } from './po.js';
import productModel, { Product } from './product.js';
import projectModel, { Project } from './project.js';
import projectPocModel, { ProjectPoc } from './project-poc.js';
import requisitionModel, { Requisition } from './requisition.js';
import requisitionAttachmentModel, { RequisitionAttachment } from './requisition-attachment.js';
import requisitionProductModel, { RequisitionProduct } from './requisition-product.js';
import roleModel, { Role } from './role.js';
import rolePermissionModel, { RolePermission } from './role-permission.js';
import userModel, { User } from './user.js';
import userActionModel, { UserAction } from './user-action.js';
import vendorCompanyModel, { VendorCompany } from './vendor-company.js';
import negotiationModel, { Negotiation } from './negotiation.js';
import negotiationRoundModel, { NegotiationRound } from './negotiation-round.js';
import preferenceModel, { Preference } from './preference.js';
import chatSessionModel, { ChatSession } from './chat-session.js';
import emailLogModel, { EmailLog } from './email-log.js';
import { initChatbotTemplateModel, ChatbotTemplate } from './chatbot-template.js';
import { initChatbotTemplateParameterModel, ChatbotTemplateParameter } from './chatbot-template-parameter.js';
import { initChatbotDealModel, ChatbotDeal } from './chatbot-deal.js';
import { initChatbotMessageModel, ChatbotMessage } from './chatbot-message.js';
import { initNegotiationTrainingDataModel, NegotiationTrainingData } from './negotiation-training-data.js';
import { initMessageEmbeddingModel, MessageEmbedding } from './message-embedding.js';
import { initDealEmbeddingModel, DealEmbedding } from './deal-embedding.js';
import { initNegotiationPatternModel, NegotiationPattern } from './negotiation-pattern.js';
import { initVectorMigrationStatusModel, VectorMigrationStatus } from './vector-migration-status.js';
import { initMesoRoundModel, MesoRound } from './meso-round.js';
import { initVendorNegotiationProfileModel, VendorNegotiationProfile } from './vendor-negotiation-profile.js';
import vendorBidModel, { VendorBid } from './vendor-bid.js';
import bidComparisonModel, { BidComparison } from './bid-comparison.js';
import vendorSelectionModel, { VendorSelection } from './vendor-selection.js';
import vendorNotificationModel, { VendorNotification } from './vendor-notification.js';
import { initApprovalModel, Approval } from './approval.js';
import addressModel, { Address } from './address.js';
import bidActionHistoryModel, { BidActionHistory } from './bid-action-history.js';
import ApiUsageLog from './api-usage-log.js';

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
