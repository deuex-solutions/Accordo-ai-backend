import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  ForeignKey,
  NonAttribute,
} from 'sequelize';
import type { ChatbotDeal } from './chatbot-deal.js';

export type MessageRole = 'VENDOR' | 'ACCORDO' | 'SYSTEM';

export class ChatbotMessage extends Model<
  InferAttributes<ChatbotMessage>,
  InferCreationAttributes<ChatbotMessage>
> {
  declare id: CreationOptional<string>;
  declare dealId: ForeignKey<string>;
  declare role: MessageRole;
  declare content: string;
  declare extractedOffer: object | null;
  declare engineDecision: object | null;
  declare decisionAction: string | null;
  declare utilityScore: number | null;
  declare counterOffer: object | null;
  declare explainabilityJson: object | null;
  declare round: number | null;  // Which negotiation round this message belongs to
  declare createdAt: CreationOptional<Date>;

  // Associations
  declare Deal?: NonAttribute<ChatbotDeal>;

  static associate(models: any): void {
    this.belongsTo(models.ChatbotDeal, {
      foreignKey: 'dealId',
      as: 'Deal',
    });
  }
}

export function initChatbotMessageModel(sequelize: Sequelize): typeof ChatbotMessage {
  ChatbotMessage.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      dealId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'deal_id',
      },
      role: {
        type: DataTypes.ENUM('VENDOR', 'ACCORDO', 'SYSTEM'),
        allowNull: false,
      },
      content: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      extractedOffer: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: 'extracted_offer',
      },
      engineDecision: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: 'engine_decision',
      },
      decisionAction: {
        type: DataTypes.STRING,
        allowNull: true,
        field: 'decision_action',
      },
      utilityScore: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        field: 'utility_score',
      },
      counterOffer: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: 'counter_offer',
      },
      explainabilityJson: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: 'explainability_json',
      },
      round: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'round',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'created_at',
      },
    },
    {
      sequelize,
      tableName: 'chatbot_messages',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false, // No updatedAt for messages
      underscored: true,
    }
  );
  return ChatbotMessage;
}
