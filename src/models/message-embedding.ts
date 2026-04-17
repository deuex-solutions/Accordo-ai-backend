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
import type { ChatbotMessage } from './chatbot-message.js';
import type { ChatbotDeal } from './chatbot-deal.js';
import type { User } from './user.js';

export class MessageEmbedding extends Model<
  InferAttributes<MessageEmbedding>,
  InferCreationAttributes<MessageEmbedding>
> {
  declare id: CreationOptional<string>;
  declare messageId: ForeignKey<string>;
  declare dealId: ForeignKey<string>;
  declare userId: ForeignKey<number> | null;
  declare vendorId: ForeignKey<number> | null;
  declare embedding: number[];
  declare contentText: string;
  declare contentType: 'message' | 'offer_extract' | 'decision';
  declare role: 'VENDOR' | 'ACCORDO' | 'SYSTEM';
  declare round: number;
  declare outcome: string | null;
  declare utilityScore: number | null;
  declare decisionAction: string | null;
  declare productCategory: string | null;
  declare priceRange: string | null;
  declare paymentTerms: string | null;
  declare metadata: object | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  // Associations
  declare Message?: NonAttribute<ChatbotMessage>;
  declare Deal?: NonAttribute<ChatbotDeal>;
  declare User?: NonAttribute<User>;
  declare Vendor?: NonAttribute<User>;

  static associate(models: Record<string, unknown>): void {
    this.belongsTo(models.ChatbotMessage as typeof ChatbotMessage, {
      foreignKey: 'messageId',
      as: 'Message',
    });
    this.belongsTo(models.ChatbotDeal as typeof ChatbotDeal, {
      foreignKey: 'dealId',
      as: 'Deal',
    });
    this.belongsTo(models.User as typeof User, {
      foreignKey: 'userId',
      as: 'User',
    });
    this.belongsTo(models.User as typeof User, {
      foreignKey: 'vendorId',
      as: 'Vendor',
    });
  }
}

export function initMessageEmbeddingModel(sequelize: Sequelize): typeof MessageEmbedding {
  MessageEmbedding.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      messageId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'message_id',
        references: {
          model: 'chatbot_messages',
          key: 'id',
        },
      },
      dealId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'deal_id',
        references: {
          model: 'chatbot_deals',
          key: 'id',
        },
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'user_id',
      },
      vendorId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'vendor_id',
      },
      embedding: {
        type: DataTypes.ARRAY(DataTypes.FLOAT),
        allowNull: false,
        comment: 'Vector embedding (1024 dimensions for bge-large-en-v1.5)',
      },
      contentText: {
        type: DataTypes.TEXT,
        allowNull: false,
        field: 'content_text',
        comment: 'Original text that was embedded',
      },
      contentType: {
        type: DataTypes.ENUM('message', 'offer_extract', 'decision'),
        allowNull: false,
        defaultValue: 'message',
        field: 'content_type',
      },
      role: {
        type: DataTypes.ENUM('VENDOR', 'ACCORDO', 'SYSTEM'),
        allowNull: false,
      },
      round: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      outcome: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Deal outcome: ACCEPTED, WALKED_AWAY, ESCALATED, etc.',
      },
      utilityScore: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: true,
        field: 'utility_score',
      },
      decisionAction: {
        type: DataTypes.STRING,
        allowNull: true,
        field: 'decision_action',
        comment: 'ACCEPT, COUNTER, WALK_AWAY, ESCALATE, ASK_CLARIFY',
      },
      productCategory: {
        type: DataTypes.STRING,
        allowNull: true,
        field: 'product_category',
      },
      priceRange: {
        type: DataTypes.STRING,
        allowNull: true,
        field: 'price_range',
        comment: 'Price range bucket for filtering: low, medium, high',
      },
      paymentTerms: {
        type: DataTypes.STRING,
        allowNull: true,
        field: 'payment_terms',
        comment: 'Payment terms: Net 30, Net 60, Net 90, etc.',
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'Additional metadata for filtering and context',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'created_at',
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'updated_at',
      },
    },
    {
      sequelize,
      tableName: 'message_embeddings',
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: 'idx_message_embeddings_deal_id',
          fields: ['deal_id'],
        },
        {
          name: 'idx_message_embeddings_message_id',
          fields: ['message_id'],
        },
        {
          name: 'idx_message_embeddings_role',
          fields: ['role'],
        },
        {
          name: 'idx_message_embeddings_outcome',
          fields: ['outcome'],
        },
        {
          name: 'idx_message_embeddings_content_type',
          fields: ['content_type'],
        },
        {
          name: 'idx_message_embeddings_created_at',
          fields: ['created_at'],
        },
      ],
    }
  );
  return MessageEmbedding;
}
