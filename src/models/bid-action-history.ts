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

const actionEnum = ['SELECTED', 'REJECTED', 'RESTORED', 'VIEWED', 'EXPORTED', 'COMPARISON_GENERATED'] as const;

export type BidActionType = (typeof actionEnum)[number];

export interface ActionDetails {
  vendorId?: number;
  vendorName?: string;
  bidPrice?: number;
  previousStatus?: string;
  newStatus?: string;
  selectionId?: string | number;
  poId?: number | null;
  pdfUrl?: string;
  [key: string]: unknown;
}

export class BidActionHistory extends Model<
  InferAttributes<BidActionHistory>,
  InferCreationAttributes<BidActionHistory>
> {
  declare id: CreationOptional<number>;
  declare requisitionId: ForeignKey<number>;
  declare bidId: ForeignKey<string> | null;  // VendorBid ID
  declare dealId: ForeignKey<string> | null; // ChatbotDeal ID
  declare userId: ForeignKey<number>;
  declare action: BidActionType;
  declare actionDetails: ActionDetails | null;
  declare remarks: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  // Associations
  declare Requisition?: NonAttribute<any>;
  declare Bid?: NonAttribute<any>;
  declare Deal?: NonAttribute<any>;
  declare User?: NonAttribute<any>;

  static associate(models: Record<string, typeof Model>): void {
    this.belongsTo(models.Requisition as ModelStatic<Model>, {
      foreignKey: 'requisitionId',
      as: 'Requisition',
    });
    this.belongsTo(models.VendorBid as ModelStatic<Model>, {
      foreignKey: 'bidId',
      as: 'Bid',
    });
    this.belongsTo(models.ChatbotDeal as ModelStatic<Model>, {
      foreignKey: 'dealId',
      as: 'Deal',
    });
    this.belongsTo(models.User as ModelStatic<Model>, {
      foreignKey: 'userId',
      as: 'User',
    });
  }
}

export default function bidActionHistoryModel(sequelize: Sequelize): typeof BidActionHistory {
  BidActionHistory.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
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
      bidId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'vendor_bids',
          key: 'id',
        },
      },
      dealId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'chatbot_deals',
          key: 'id',
        },
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'User',
          key: 'id',
        },
      },
      action: {
        type: DataTypes.ENUM('SELECTED', 'REJECTED', 'RESTORED', 'VIEWED', 'EXPORTED', 'COMPARISON_GENERATED'),
        allowNull: false,
      },
      actionDetails: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'Additional details about the action (vendor name, prices, etc.)',
      },
      remarks: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'User-provided remarks for the action',
      },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'bid_action_histories',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['requisition_id'] },
        { fields: ['bid_id'] },
        { fields: ['deal_id'] },
        { fields: ['user_id'] },
        { fields: ['action'] },
        { fields: ['created_at'] },
      ],
    }
  );

  return BidActionHistory;
}
