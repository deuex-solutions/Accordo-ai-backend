import { Op } from "sequelize";
import models from "../../models/index.js";
import type { Requisition } from "../../models/requisition.js";
import type { ChatbotDeal } from "../../models/chatbot-deal.js";
import type { Contract } from "../../models/contract.js";
import type { VendorBid } from "../../models/vendor-bid.js";

const repo = {
  // ============================================================================
  // Existing method (kept as-is)
  // ============================================================================
  findRequisitionsForCompany: async (
    companyId: number,
    fromDate: Date,
  ): Promise<Requisition[]> => {
    return models.Requisition.findAll({
      where: {
        deliveryDate: {
          [Op.gte]: fromDate,
        },
      },
      include: [
        {
          model: models.Project,
          as: "Project",
          attributes: [],
          where: { companyId },
        },
        {
          model: models.Contract,
          as: "Contract",
        },
        {
          model: models.RequisitionProduct,
          as: "RequisitionProduct",
        },
      ],
      order: [["createdAt", "DESC"]],
      subQuery: false,
    });
  },

  // ============================================================================
  // New methods for dashboard stats
  // ============================================================================

  /**
   * Find all requisitions for a company created within a date range.
   */
  findRequisitionsInPeriod: async (
    companyId: number,
    fromDate: Date,
    toDate: Date,
  ): Promise<Requisition[]> => {
    return models.Requisition.findAll({
      where: {
        createdAt: {
          [Op.gte]: fromDate,
          [Op.lte]: toDate,
        },
      },
      include: [
        {
          model: models.Project,
          as: "Project",
          attributes: [],
          where: { companyId },
        },
        {
          model: models.Contract,
          as: "Contract",
        },
        {
          model: models.RequisitionProduct,
          as: "RequisitionProduct",
        },
      ],
      order: [["createdAt", "DESC"]],
      subQuery: false,
    });
  },

  /**
   * Find active (non-archived, non-deleted) ChatbotDeals for a company.
   * Optionally filtered by date range on createdAt.
   */
  findDealsForCompany: async (
    companyId: number,
    fromDate?: Date,
    toDate?: Date,
  ): Promise<ChatbotDeal[]> => {
    const where: any = {
      deletedAt: { [Op.is]: null as any },
    };
    if (fromDate && toDate) {
      where.createdAt = { [Op.gte]: fromDate, [Op.lte]: toDate };
    }
    return models.ChatbotDeal.findAll({
      where,
      include: [
        {
          model: models.Requisition,
          as: "Requisition",
          required: true,
          attributes: ["id", "rfqId", "subject", "totalPrice", "category"],
          include: [
            {
              model: models.Project,
              as: "Project",
              attributes: [],
              where: { companyId },
            },
          ],
        },
        {
          model: models.User,
          as: "Vendor",
          attributes: ["id", "name", "email"],
        },
      ],
      order: [["updatedAt", "DESC"]],
      subQuery: false,
    });
  },

  /**
   * Find vendor bids for requisitions belonging to a company.
   */
  findVendorBidsForCompany: async (
    companyId: number,
    fromDate: Date,
    toDate: Date,
  ): Promise<VendorBid[]> => {
    return models.VendorBid.findAll({
      where: {
        createdAt: {
          [Op.gte]: fromDate,
          [Op.lte]: toDate,
        },
      },
      include: [
        {
          model: models.Requisition,
          as: "Requisition",
          required: true,
          attributes: ["id", "rfqId", "projectId"],
          include: [
            {
              model: models.Project,
              as: "Project",
              attributes: [],
              where: { companyId },
            },
          ],
        },
      ],
      subQuery: false,
    });
  },

  /**
   * Find recent deal status changes and requisition creates for activity feed.
   * Uses deals updated recently + requisitions created recently.
   */
  findRecentDeals: async (
    companyId: number,
    limit: number,
    fromDate?: Date,
    toDate?: Date,
  ): Promise<ChatbotDeal[]> => {
    const where: any = {
      deletedAt: { [Op.is]: null as any },
    };
    if (fromDate && toDate) {
      where.updatedAt = { [Op.gte]: fromDate, [Op.lte]: toDate };
    }
    return models.ChatbotDeal.findAll({
      where,
      include: [
        {
          model: models.Requisition,
          as: "Requisition",
          required: true,
          attributes: ["id", "rfqId", "subject"],
          include: [
            {
              model: models.Project,
              as: "Project",
              attributes: [],
              where: { companyId },
            },
          ],
        },
        {
          model: models.User,
          as: "Vendor",
          attributes: ["id", "name"],
        },
      ],
      order: [["updatedAt", "DESC"]],
      limit,
      subQuery: false,
    });
  },

  findRecentRequisitions: async (
    companyId: number,
    limit: number,
    fromDate?: Date,
    toDate?: Date,
  ): Promise<Requisition[]> => {
    const where: any = {};
    if (fromDate && toDate) {
      where.createdAt = { [Op.gte]: fromDate, [Op.lte]: toDate };
    }
    return models.Requisition.findAll({
      where,
      include: [
        {
          model: models.Project,
          as: "Project",
          attributes: [],
          where: { companyId },
        },
      ],
      order: [["createdAt", "DESC"]],
      limit,
      subQuery: false,
    });
  },

  /**
   * Stalled negotiations: NEGOTIATING deals with no messages for N days.
   */
  findStalledDeals: async (
    companyId: number,
    staleDays: number,
    fromDate?: Date,
  ): Promise<ChatbotDeal[]> => {
    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - staleDays);

    const where: any = {
      status: "NEGOTIATING",
      archivedAt: { [Op.is]: null as any },
      deletedAt: { [Op.is]: null as any },
      lastMessageAt: { [Op.lt]: staleDate },
    };
    if (fromDate) {
      where.createdAt = { [Op.gte]: fromDate };
    }

    return models.ChatbotDeal.findAll({
      where,
      include: [
        {
          model: models.Requisition,
          as: "Requisition",
          required: true,
          attributes: ["id", "rfqId", "subject"],
          include: [
            {
              model: models.Project,
              as: "Project",
              attributes: [],
              where: { companyId },
            },
          ],
        },
        {
          model: models.User,
          as: "Vendor",
          attributes: ["id", "name"],
        },
      ],
      order: [["lastMessageAt", "ASC"]],
      subQuery: false,
    });
  },

  /**
   * Deals with approaching deadlines (negotiationConfigJson contains deadline).
   */
  findApproachingDeadlines: async (
    companyId: number,
    withinDays: number,
    fromDate?: Date,
  ): Promise<ChatbotDeal[]> => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + withinDays);

    const where: any = {
      status: "NEGOTIATING",
      archivedAt: { [Op.is]: null as any },
      deletedAt: { [Op.is]: null as any },
    };
    if (fromDate) {
      where.createdAt = { [Op.gte]: fromDate };
    }

    return models.ChatbotDeal.findAll({
      where,
      include: [
        {
          model: models.Requisition,
          as: "Requisition",
          required: true,
          attributes: ["id", "rfqId", "subject"],
          include: [
            {
              model: models.Project,
              as: "Project",
              attributes: [],
              where: { companyId },
            },
          ],
        },
      ],
      order: [["createdAt", "ASC"]],
      subQuery: false,
    });
  },

  /**
   * Escalated deals.
   */
  findEscalatedDeals: async (
    companyId: number,
    fromDate?: Date,
  ): Promise<ChatbotDeal[]> => {
    const where: any = {
      status: "ESCALATED",
      archivedAt: { [Op.is]: null as any },
      deletedAt: { [Op.is]: null as any },
    };
    if (fromDate) {
      where.createdAt = { [Op.gte]: fromDate };
    }

    return models.ChatbotDeal.findAll({
      where,
      include: [
        {
          model: models.Requisition,
          as: "Requisition",
          required: true,
          attributes: ["id", "rfqId", "subject"],
          include: [
            {
              model: models.Project,
              as: "Project",
              attributes: [],
              where: { companyId },
            },
          ],
        },
        {
          model: models.User,
          as: "Vendor",
          attributes: ["id", "name"],
        },
      ],
      order: [["updatedAt", "DESC"]],
      subQuery: false,
    });
  },

  /**
   * Unresponsive vendors: contracts sent (status='Created') but not opened for N days.
   */
  findUnresponsiveVendors: async (
    companyId: number,
    staleDays: number,
    fromDate?: Date,
  ): Promise<Contract[]> => {
    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - staleDays);

    const where: any = {
      companyId,
      status: "Created",
      createdAt: {
        [Op.lt]: staleDate,
      },
    };
    if (fromDate) {
      where.createdAt = { ...where.createdAt, [Op.gte]: fromDate };
    }

    return models.Contract.findAll({
      where,
      include: [
        {
          model: models.User,
          as: "Vendor",
          attributes: ["id", "name", "email"],
        },
        {
          model: models.Requisition,
          as: "Requisition",
          attributes: ["id", "rfqId", "subject"],
        },
      ],
      order: [["createdAt", "ASC"]],
    });
  },
};

export default repo;
