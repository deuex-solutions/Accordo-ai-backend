import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  ForeignKey,
  NonAttribute,
} from "sequelize";
import type { ChatbotTemplate } from "./chatbot-template.js";
import type { ChatbotMessage } from "./chatbot-message.js";
import type { Requisition } from "./requisition.js";
import type { Contract } from "./contract.js";
import type { User } from "./user.js";

export type DealStatus =
  | "NEGOTIATING"
  | "ACCEPTED"
  | "WALKED_AWAY"
  | "ESCALATED";
export type DealMode = "INSIGHTS" | "CONVERSATION";

export class ChatbotDeal extends Model<
  InferAttributes<ChatbotDeal>,
  InferCreationAttributes<ChatbotDeal>
> {
  declare id: CreationOptional<string>;
  declare title: string;
  declare counterparty: string | null;
  declare status: DealStatus;
  declare round: number;
  declare mode: DealMode;
  declare latestOfferJson: object | null;
  declare latestVendorOffer: object | null;
  declare latestDecisionAction: string | null;
  declare latestUtility: number | null;
  declare convoStateJson: object | null;
  declare negotiationConfigJson: object | null;
  declare openQuestions: CreationOptional<
    Array<{ question: string; askedAtRound: number }>
  >;
  declare templateId: ForeignKey<string> | null;
  declare requisitionId: ForeignKey<number> | null;
  declare contractId: ForeignKey<number> | null;
  declare userId: ForeignKey<number> | null;
  declare vendorId: ForeignKey<number> | null;
  declare archivedAt: Date | null;
  declare deletedAt: Date | null;
  declare lastAccessed: CreationOptional<Date>;
  declare lastMessageAt: Date | null;
  declare viewCount: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  // Associations
  declare Template?: NonAttribute<ChatbotTemplate>;
  declare Requisition?: NonAttribute<Requisition>;
  declare Contract?: NonAttribute<Contract>;
  declare User?: NonAttribute<User>;
  declare Vendor?: NonAttribute<User>;
  declare Messages?: NonAttribute<ChatbotMessage[]>;

  static associate(models: any): void {
    this.belongsTo(models.ChatbotTemplate, {
      foreignKey: "templateId",
      as: "Template",
    });
    this.belongsTo(models.Requisition, {
      foreignKey: "requisitionId",
      as: "Requisition",
    });
    this.belongsTo(models.Contract, {
      foreignKey: "contractId",
      as: "Contract",
    });
    this.belongsTo(models.User, {
      foreignKey: "userId",
      as: "User",
    });
    this.belongsTo(models.User, {
      foreignKey: "vendorId",
      as: "Vendor",
    });
    this.hasMany(models.ChatbotMessage, {
      foreignKey: "dealId",
      as: "Messages",
    });
  }
}

export function initChatbotDealModel(sequelize: Sequelize): typeof ChatbotDeal {
  ChatbotDeal.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      counterparty: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM(
          "NEGOTIATING",
          "ACCEPTED",
          "WALKED_AWAY",
          "ESCALATED",
        ),
        allowNull: false,
        defaultValue: "NEGOTIATING",
      },
      round: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      mode: {
        type: DataTypes.ENUM("INSIGHTS", "CONVERSATION"),
        allowNull: false,
        defaultValue: "CONVERSATION",
      },
      latestOfferJson: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: "latest_offer_json",
      },
      latestVendorOffer: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: "latest_vendor_offer",
      },
      latestDecisionAction: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "latest_decision_action",
      },
      latestUtility: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        field: "latest_utility",
      },
      convoStateJson: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: "convo_state_json",
      },
      negotiationConfigJson: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: "negotiation_config_json",
      },
      openQuestions: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
        field: "open_questions",
      },
      templateId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: "template_id",
      },
      requisitionId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "requisition_id",
      },
      contractId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "contract_id",
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "user_id",
      },
      vendorId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "vendor_id",
      },
      archivedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "archived_at",
      },
      deletedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "deleted_at",
      },
      lastAccessed: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: DataTypes.NOW,
        field: "last_accessed",
      },
      lastMessageAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: "last_message_at",
      },
      viewCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: "view_count",
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: "created_at",
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: "updated_at",
      },
    },
    {
      sequelize,
      tableName: "chatbot_deals",
      timestamps: true,
      underscored: true,
      paranoid: false, // We handle soft deletes manually with deletedAt
    },
  );
  return ChatbotDeal;
}
