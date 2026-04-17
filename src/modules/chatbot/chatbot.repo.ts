import { Op, Transaction } from 'sequelize';
import models from '../../models/index.js';
import type { ChatbotDeal } from '../../models/chatbot-deal.js';
import type { ChatbotMessage } from '../../models/chatbot-message.js';

/**
 * Repository layer for chatbot database operations
 * Provides typed query methods using Sequelize models
 */

export interface FindDealsOptions {
  where?: any;
  limit?: number;
  offset?: number;
  order?: Array<[string, 'ASC' | 'DESC']>;
  include?: any[];
  transaction?: Transaction;
}

export const findDealById = async (
  dealId: string,
  transaction?: Transaction
): Promise<ChatbotDeal | null> => {
  return models.ChatbotDeal.findByPk(dealId, {
    include: [
      { model: models.Requisition, as: 'Requisition' },
      { model: models.Contract, as: 'Contract' },
      { model: models.User, as: 'User', attributes: ['id', 'name', 'email'] },
      { model: models.User, as: 'Vendor', attributes: ['id', 'name', 'email'] },
    ],
    transaction,
  });
};

export const findDeals = async (
  options: FindDealsOptions
): Promise<{ rows: ChatbotDeal[]; count: number }> => {
  return models.ChatbotDeal.findAndCountAll({
    where: options.where || {},
    limit: options.limit,
    offset: options.offset,
    order: options.order || [['createdAt', 'DESC']],
    include: options.include || [],
    transaction: options.transaction,
  });
};

export const createDeal = async (
  dealData: Partial<ChatbotDeal>,
  transaction?: Transaction
): Promise<ChatbotDeal> => {
  return models.ChatbotDeal.create(dealData as any, { transaction });
};

export const updateDeal = async (
  dealId: string,
  updates: Partial<ChatbotDeal>,
  transaction?: Transaction
): Promise<[number, ChatbotDeal[]]> => {
  return models.ChatbotDeal.update(updates as any, {
    where: { id: dealId },
    returning: true,
    transaction,
  });
};

export const deleteDeal = async (
  dealId: string,
  transaction?: Transaction
): Promise<number> => {
  return models.ChatbotDeal.destroy({
    where: { id: dealId },
    transaction,
  });
};

export const findMessagesByDealId = async (
  dealId: string,
  transaction?: Transaction
): Promise<ChatbotMessage[]> => {
  return models.ChatbotMessage.findAll({
    where: { dealId },
    order: [['createdAt', 'ASC']],
    transaction,
  });
};

export const createMessage = async (
  messageData: Partial<ChatbotMessage>,
  transaction?: Transaction
): Promise<ChatbotMessage> => {
  return models.ChatbotMessage.create(messageData as any, { transaction });
};

export const deleteMessagesByDealId = async (
  dealId: string,
  transaction?: Transaction
): Promise<number> => {
  return models.ChatbotMessage.destroy({
    where: { dealId },
    transaction,
  });
};

export const findLastMessageWithExplainability = async (
  dealId: string,
  transaction?: Transaction
): Promise<ChatbotMessage | null> => {
  return models.ChatbotMessage.findOne({
    where: {
      dealId,
      explainabilityJson: { [Op.ne]: null },
    },
    order: [['createdAt', 'DESC']],
    transaction,
  });
};

export const countMessagesByDealId = async (
  dealId: string,
  transaction?: Transaction
): Promise<number> => {
  return models.ChatbotMessage.count({
    where: { dealId },
    transaction,
  });
};

export default {
  findDealById,
  findDeals,
  createDeal,
  updateDeal,
  deleteDeal,
  findMessagesByDealId,
  createMessage,
  deleteMessagesByDealId,
  findLastMessageWithExplainability,
  countMessagesByDealId,
};
