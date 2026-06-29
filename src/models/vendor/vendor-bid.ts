import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  ForeignKey,
  ModelStatic,
  NonAttribute,
} from 'sequelize';

const bidStatusEnum = ['PENDING', 'COMPLETED', 'EXCLUDED', 'SELECTED', 'REJECTED'] as const;
const dealStatusEnum = ['NEGOTIATING', 'ACCEPTED', 'WALKED_AWAY', 'ESCALATED'] as const;

export type BidStatus = (typeof bidStatusEnum)[number];
export type DealStatus = (typeof dealStatusEnum)[number];

export interface ChatSummaryMetrics {
  totalRounds: number;
  initialPrice: number | null;
  finalPrice: number | null;
  priceReductionPercent: number | null;
  initialPaymentTerms: string | null;
  finalPaymentTerms: string | null;
  keyDecisions: Array<{
    round: number;
    action: string;
    utilityScore: number;
  }>;
  negotiationDurationHours: number | null;
  averageUtilityScore: number | null;
}

export class VendorBid extends Model<
  InferAttributes<VendorBid>,
  InferCreationAttributes<VendorBid>
> {
  declare id: CreationOptional<string>;
  declare requisitionId: ForeignKey<number>;
  declare contractId: ForeignKey<number>;
  declare dealId: ForeignKey<string>;
  declare vendorId: ForeignKey<number>;

  // Final offer details
  declare finalPrice: number | null;
  declare unitPrice: number | null;
  declare paymentTerms: string | null;
  declare deliveryDate: Date | null;
  declare utilityScore: number | null;

  // Status
  declare bidStatus: BidStatus;
  declare dealStatus: DealStatus;

  // Summary
  declare chatSummaryMetrics: ChatSummaryMetrics | null;
  declare chatSummaryNarrative: string | null;
  declare chatLink: string | null;

  // Timestamps
  declare completedAt: Date | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  // Associations
  declare Requisition?: NonAttribute<any>;
  declare Contract?: NonAttribute<any>;
  declare Deal?: NonAttribute<any>;
  declare Vendor?: NonAttribute<any>;

  static associate(models: Record<string, typeof Model>): void {
    this.belongsTo(models.Requisition as ModelStatic<Model>, {
      foreignKey: 'requisitionId',
      as: 'Requisition',
    });
    this.belongsTo(models.Contract as ModelStatic<Model>, {
      foreignKey: 'contractId',
      as: 'Contract',
    });
    this.belongsTo(models.ChatbotDeal as ModelStatic<Model>, {
      foreignKey: 'dealId',
      as: 'Deal',
    });
    this.belongsTo(models.User as ModelStatic<Model>, {
      foreignKey: 'vendorId',
      as: 'Vendor',
    });
  }
}

export default function vendorBidModel(sequelize: Sequelize): typeof VendorBid {
  VendorBid.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      requisitionId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'Requisitions',
          key: 'id',
        },
      },
      contractId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'Contracts',
          key: 'id',
        },
      },
      dealId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'chatbot_deals',
          key: 'id',
        },
      },
      vendorId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'User',
          key: 'id',
        },
      },
      finalPrice: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true,
        comment: 'Final negotiated total price',
      },
      unitPrice: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true,
        comment: 'Final negotiated unit price',
      },
      paymentTerms: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Final payment terms (e.g., Net 30, Net 60)',
      },
      deliveryDate: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Promised delivery date',
      },
      utilityScore: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: true,
        comment: 'Final utility score (0-1)',
      },
      bidStatus: {
        type: DataTypes.ENUM('PENDING', 'COMPLETED', 'EXCLUDED', 'SELECTED', 'REJECTED'),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      dealStatus: {
        type: DataTypes.ENUM('NEGOTIATING', 'ACCEPTED', 'WALKED_AWAY', 'ESCALATED'),
        allowNull: false,
        defaultValue: 'NEGOTIATING',
      },
      chatSummaryMetrics: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'Structured metrics from negotiation (rounds, price changes, etc.)',
      },
      chatSummaryNarrative: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'LLM-generated narrative summary of negotiation',
      },
      chatLink: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'URL to view full chat history',
      },
      completedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'When the negotiation completed',
      },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'vendor_bids',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['requisition_id'] },
        { fields: ['vendor_id'] },
        { fields: ['bid_status'] },
        { fields: ['final_price'] },
        { fields: ['deal_id'] },
        { fields: ['contract_id'] },
      ],
    }
  );

  return VendorBid;
}
