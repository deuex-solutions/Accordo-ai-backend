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
import type { User } from './user.js';

export type DealEmbeddingType = 'summary' | 'pattern' | 'outcome';

export class DealEmbedding extends Model<
  InferAttributes<DealEmbedding>,
  InferCreationAttributes<DealEmbedding>
> {
  declare id: CreationOptional<string>;
  declare dealId: ForeignKey<string>;
  declare userId: ForeignKey<number> | null;
  declare vendorId: ForeignKey<number> | null;
  declare embedding: number[];
  declare contentText: string;
  declare embeddingType: DealEmbeddingType;
  declare dealTitle: string | null;
  declare counterparty: string | null;
  declare finalStatus: string | null;
  declare totalRounds: number | null;
  declare finalUtility: number | null;
  declare anchorPrice: number | null;
  declare targetPrice: number | null;
  declare finalPrice: number | null;
  declare initialTerms: string | null;
  declare finalTerms: string | null;
  declare productCategory: string | null;
  declare negotiationDuration: number | null;
  declare successMetrics: object | null;
  declare metadata: object | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  // Associations
  declare Deal?: NonAttribute<ChatbotDeal>;
  declare User?: NonAttribute<User>;
  declare Vendor?: NonAttribute<User>;

  static associate(models: Record<string, unknown>): void {
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

export function initDealEmbeddingModel(sequelize: Sequelize): typeof DealEmbedding {
  DealEmbedding.init(
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
        comment: 'Original text that was embedded (deal summary)',
      },
      embeddingType: {
        type: DataTypes.ENUM('summary', 'pattern', 'outcome'),
        allowNull: false,
        defaultValue: 'summary',
        field: 'embedding_type',
      },
      dealTitle: {
        type: DataTypes.STRING,
        allowNull: true,
        field: 'deal_title',
      },
      counterparty: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      finalStatus: {
        type: DataTypes.STRING,
        allowNull: true,
        field: 'final_status',
        comment: 'ACCEPTED, WALKED_AWAY, ESCALATED, NEGOTIATING',
      },
      totalRounds: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'total_rounds',
      },
      finalUtility: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: true,
        field: 'final_utility',
      },
      anchorPrice: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true,
        field: 'anchor_price',
      },
      targetPrice: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true,
        field: 'target_price',
      },
      finalPrice: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true,
        field: 'final_price',
      },
      initialTerms: {
        type: DataTypes.STRING,
        allowNull: true,
        field: 'initial_terms',
      },
      finalTerms: {
        type: DataTypes.STRING,
        allowNull: true,
        field: 'final_terms',
      },
      productCategory: {
        type: DataTypes.STRING,
        allowNull: true,
        field: 'product_category',
      },
      negotiationDuration: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'negotiation_duration',
        comment: 'Duration in hours from first to last message',
      },
      successMetrics: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: 'success_metrics',
        comment: 'Key success metrics: price_reduction_pct, terms_improvement, etc.',
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
      tableName: 'deal_embeddings',
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: 'idx_deal_embeddings_deal_id',
          fields: ['deal_id'],
        },
        {
          name: 'idx_deal_embeddings_type',
          fields: ['embedding_type'],
        },
        {
          name: 'idx_deal_embeddings_status',
          fields: ['final_status'],
        },
        {
          name: 'idx_deal_embeddings_utility',
          fields: ['final_utility'],
        },
        {
          name: 'idx_deal_embeddings_category',
          fields: ['product_category'],
        },
        {
          name: 'idx_deal_embeddings_created_at',
          fields: ['created_at'],
        },
      ],
    }
  );
  return DealEmbedding;
}
