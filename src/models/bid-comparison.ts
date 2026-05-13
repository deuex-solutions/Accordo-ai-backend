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

const triggerTypeEnum = ['ALL_COMPLETED', 'DEADLINE_REACHED', 'MANUAL'] as const;
const emailStatusEnum = ['PENDING', 'SENT', 'FAILED'] as const;

export type TriggerType = (typeof triggerTypeEnum)[number];
export type ComparisonEmailStatus = (typeof emailStatusEnum)[number];

export interface TopBidInfo {
  bidId: string;
  vendorId: number;
  vendorName: string;
  vendorEmail: string;
  finalPrice: number;
  unitPrice: number | null;
  paymentTerms: string | null;
  deliveryDate: string | null;
  utilityScore: number | null;
  rank: number;
  chatLink: string | null;
}

export class BidComparison extends Model<
  InferAttributes<BidComparison>,
  InferCreationAttributes<BidComparison>
> {
  declare id: CreationOptional<string>;
  declare requisitionId: ForeignKey<number>;
  declare triggeredBy: TriggerType;

  // Report details
  declare totalVendors: number;
  declare completedVendors: number;
  declare excludedVendors: number;
  declare topBidsJson: TopBidInfo[] | null;
  declare pdfUrl: string | null;

  // Notification
  declare sentToUserId: ForeignKey<number> | null;
  declare sentToEmail: string | null;
  declare emailStatus: ComparisonEmailStatus;
  declare emailLogId: ForeignKey<number> | null;

  // Timestamps
  declare generatedAt: Date | null;
  declare sentAt: Date | null;
  declare createdAt: CreationOptional<Date>;

  // Associations
  declare Requisition?: NonAttribute<any>;
  declare Recipient?: NonAttribute<any>;
  declare EmailLog?: NonAttribute<any>;

  static associate(models: Record<string, typeof Model>): void {
    this.belongsTo(models.Requisition as ModelStatic<Model>, {
      foreignKey: 'requisitionId',
      as: 'Requisition',
    });
    this.belongsTo(models.User as ModelStatic<Model>, {
      foreignKey: 'sentToUserId',
      as: 'Recipient',
    });
    this.belongsTo(models.EmailLog as ModelStatic<Model>, {
      foreignKey: 'emailLogId',
      as: 'EmailLog',
    });
  }
}

export default function bidComparisonModel(sequelize: Sequelize): typeof BidComparison {
  BidComparison.init(
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
      triggeredBy: {
        type: DataTypes.ENUM(...triggerTypeEnum),
        allowNull: false,
      },
      totalVendors: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Total number of vendors attached to requisition',
      },
      completedVendors: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Number of vendors who completed negotiations',
      },
      excludedVendors: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Number of vendors excluded (walked away without resolution)',
      },
      topBidsJson: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'Array of top bids with vendor details and pricing',
      },
      pdfUrl: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Path or URL to the generated PDF report',
      },
      sentToUserId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'User',
          key: 'id',
        },
        comment: 'Procurement owner who receives the comparison',
      },
      sentToEmail: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Email address comparison was sent to',
      },
      emailStatus: {
        type: DataTypes.ENUM(...emailStatusEnum),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      emailLogId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'EmailLogs',
          key: 'id',
        },
        comment: 'Reference to email log for audit',
      },
      generatedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'When the comparison report was generated',
      },
      sentAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'When the email was sent',
      },
      createdAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'bid_comparisons',
      timestamps: true,
      underscored: true,
      updatedAt: false,
      indexes: [
        { fields: ['requisition_id'] },
        { fields: ['triggered_by'] },
        { fields: ['generated_at'] },
        { fields: ['email_status'] },
      ],
    }
  );

  return BidComparison;
}
