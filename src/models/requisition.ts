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
  Op,
} from 'sequelize';

const currencyEnum = ['USD', 'INR', 'EUR', 'GBP', 'AUD'] as const;
const statusEnum = [
  'Draft',
  'Created',
  'Fulfilled',
  'Benchmarked',
  'InitialQuotation',
  'Closed',
  'Awarded',
  'Cancelled',
  'Expired',
  'NegotiationStarted',
] as const;

const approvalStatusEnum = [
  'NOT_SUBMITTED',
  'PENDING_L1',
  'APPROVED_L1',
  'PENDING_L2',
  'APPROVED_L2',
  'PENDING_L3',
  'APPROVED_L3',
  'FULLY_APPROVED',
  'REJECTED',
] as const;

const approvalLevelEnum = ['L1', 'L2', 'L3'] as const;

export type RequisitionCurrency = (typeof currencyEnum)[number];
export type RequisitionStatus = (typeof statusEnum)[number];
export type RequisitionApprovalStatus = (typeof approvalStatusEnum)[number];
export type RequisitionApprovalLevel = (typeof approvalLevelEnum)[number];

export class Requisition extends Model<
  InferAttributes<Requisition>,
  InferCreationAttributes<Requisition>
> {
  declare id: CreationOptional<number>;
  declare projectId: ForeignKey<number>;
  declare rfqId: string | null;
  declare subject: string | null;
  declare category: string | null;
  declare deliveryDate: Date | null;
  declare negotiationClosureDate: Date | null;
  declare typeOfCurrency: RequisitionCurrency | null;
  declare totalQuantity: number | null;
  declare totalPrice: number | null;
  declare totalMaxPrice: number | null;
  declare finalPrice: number | null;
  declare status: RequisitionStatus | null;
  declare savingsInPrice: number | null;
  declare createdBy: number | null;
  declare fulfilledAt: Date | null;
  declare fulfilledBy: number | null;
  declare payment_terms: string | null;
  declare net_payment_day: string | null;
  declare pre_payment_percentage: number | null;
  declare post_payment_percentage: number | null;
  declare maxDeliveryDate: Date | null;
  declare batna: number | null;
  declare discountedValue: number | null;
  declare maxDiscount: number | null;
  declare approvalStatus: RequisitionApprovalStatus;
  declare currentApprovalLevel: RequisitionApprovalLevel | null;
  declare totalEstimatedAmount: number | null;
  declare requiredApprovalLevel: RequisitionApprovalLevel | null;
  declare submittedForApprovalAt: Date | null;
  declare submittedByUserId: ForeignKey<number> | null;
  declare createdAt: CreationOptional<Date>;
  declare archivedAt: Date | null;

  // Associations
  declare RequisitionProduct?: NonAttribute<any[]>;

  static associate(models: Record<string, typeof Model>): void {
    this.belongsTo(models.Project as ModelStatic<Model>, {
      foreignKey: 'projectId',
      as: 'Project',
    });
    this.hasMany(models.Contract as ModelStatic<Model>, {
      foreignKey: 'requisitionId',
      as: 'Contract',
    });
    this.hasMany(models.RequisitionProduct as ModelStatic<Model>, {
      foreignKey: 'requisitionId',
      as: 'RequisitionProduct',
    });
    this.hasMany(models.RequisitionAttachment as ModelStatic<Model>, {
      foreignKey: 'requisitionId',
      as: 'RequisitionAttachment',
    });
    this.hasMany(models.Po as ModelStatic<Model>, {
      foreignKey: 'requisitionId',
      as: 'PurchaseOrders',
    });
  }
}

export default function requisitionModel(sequelize: Sequelize): typeof Requisition {
  Requisition.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      projectId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      rfqId: {
        type: DataTypes.STRING,
        unique: true,
      },
      subject: DataTypes.STRING,
      category: DataTypes.STRING,
      deliveryDate: DataTypes.DATE,
      negotiationClosureDate: DataTypes.DATE,
      typeOfCurrency: DataTypes.ENUM(...currencyEnum),
      totalQuantity: DataTypes.INTEGER,
      totalPrice: DataTypes.DOUBLE,
      totalMaxPrice: DataTypes.DOUBLE,
      finalPrice: DataTypes.DOUBLE,
      status: DataTypes.ENUM(...statusEnum),
      savingsInPrice: DataTypes.DOUBLE,
      createdBy: DataTypes.INTEGER,
      fulfilledAt: DataTypes.DATE,
      fulfilledBy: DataTypes.INTEGER,
      payment_terms: DataTypes.STRING,
      net_payment_day: DataTypes.STRING,
      pre_payment_percentage: DataTypes.DOUBLE,
      post_payment_percentage: DataTypes.DOUBLE,
      maxDeliveryDate: DataTypes.DATE,
      batna: DataTypes.DOUBLE,
      discountedValue: DataTypes.DOUBLE,
      maxDiscount: DataTypes.DOUBLE,
      approvalStatus: {
        type: DataTypes.ENUM(...approvalStatusEnum),
        allowNull: false,
        defaultValue: 'NOT_SUBMITTED',
      },
      currentApprovalLevel: {
        type: DataTypes.ENUM(...approvalLevelEnum),
        allowNull: true,
        defaultValue: null,
      },
      totalEstimatedAmount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true,
        defaultValue: null,
      },
      requiredApprovalLevel: {
        type: DataTypes.ENUM(...approvalLevelEnum),
        allowNull: true,
        defaultValue: null,
      },
      submittedForApprovalAt: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
      },
      submittedByUserId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null,
      },
      createdAt: DataTypes.DATE,
      archivedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
      },
    },
    {
      sequelize,
      tableName: 'Requisitions',
      timestamps: true,
      underscored: false,
      updatedAt: false,
    }
  );

  Requisition.beforeCreate(async (requisition: Requisition) => {
    if (!requisition.rfqId) {
      // Find the maximum RFQ number from all existing requisitions
      // Fetch all rfqIds and filter/parse in JavaScript for reliability
      const allRequisitions = await Requisition.findAll({
        attributes: ['rfqId'],
        where: {
          rfqId: {
            [Op.not]: null,
          },
        },
      });

      let maxNum = 0;
      for (const req of allRequisitions) {
        if (req.rfqId) {
          // Match standard format RFQ0001, RFQ0002, etc.
          const match = req.rfqId.match(/^RFQ(\d+)$/);
          if (match) {
            const num = parseInt(match[1], 10);
            if (!Number.isNaN(num) && num > maxNum) {
              maxNum = num;
            }
          }
        }
      }

      requisition.rfqId = `RFQ${String(maxNum + 1).padStart(4, '0')}`;
    }
  });

  return Requisition;
}
