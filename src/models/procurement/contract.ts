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

const statusEnum = [
  'Created',
  'Active',      // Deal is NEGOTIATING
  'Opened',
  'Completed',
  'Verified',
  'Accepted',
  'Rejected',
  'Expired',
  'Escalated',   // Deal was ESCALATED (can start new negotiation)
  'InitialQuotation',
] as const;

export type ContractStatus = (typeof statusEnum)[number];

export class Contract extends Model<
  InferAttributes<Contract>,
  InferCreationAttributes<Contract>
> {
  declare id: CreationOptional<number>;
  declare companyId: ForeignKey<number> | null;
  declare requisitionId: ForeignKey<number> | null;
  declare vendorId: ForeignKey<number> | null;
  declare status: ContractStatus;
  declare uniqueToken: string | null;
  declare contractDetails: string | null;
  declare finalContractDetails: string | null;
  declare openedAt: Date | null;
  declare completedAt: Date | null;
  declare verifiedAt: Date | null;
  declare acceptedAt: Date | null;
  declare rejectedAt: Date | null;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare quotedAt: Date | null;
  declare benchmarkRating: number | null;
  declare finalRating: number | null;
  declare chatbotDealId: string | null;
  declare previousContractId: CreationOptional<number | null>;
  declare createdAt: CreationOptional<Date>;

  // Associations
  declare Requisition?: NonAttribute<any>;
  declare ChatbotDeal?: NonAttribute<any>;

  static associate(models: Record<string, typeof Model>): void {
    this.belongsTo(models.Requisition as ModelStatic<Model>, {
      foreignKey: 'requisitionId',
      as: 'Requisition',
    });
    this.belongsTo(models.User as ModelStatic<Model>, {
      foreignKey: 'vendorId',
      as: 'Vendor',
    });
    this.belongsTo(models.Company as ModelStatic<Model>, {
      foreignKey: 'companyId',
      as: 'Company',
    });
    this.hasMany(models.Po as ModelStatic<Model>, { foreignKey: 'contractId', as: 'PurchaseOrders' });
    this.belongsTo(models.ChatbotDeal as ModelStatic<Model>, {
      foreignKey: 'chatbotDealId',
      as: 'ChatbotDeal',
    });
    this.belongsTo(Contract as unknown as ModelStatic<Model>, { foreignKey: 'previousContractId', as: 'PreviousContract', constraints: false });
    this.hasMany(Contract as unknown as ModelStatic<Model>, { foreignKey: 'previousContractId', as: 'FollowUpContracts', constraints: false });
  }
}

export default function contractModel(sequelize: Sequelize): typeof Contract {
  Contract.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      companyId: DataTypes.INTEGER,
      requisitionId: DataTypes.INTEGER,
      vendorId: DataTypes.INTEGER,
      status: {
        type: DataTypes.ENUM(...statusEnum),
        defaultValue: 'Created',
      },
      uniqueToken: DataTypes.STRING,
      contractDetails: DataTypes.TEXT,
      finalContractDetails: DataTypes.TEXT,
      openedAt: DataTypes.DATE,
      completedAt: DataTypes.DATE,
      verifiedAt: DataTypes.DATE,
      acceptedAt: DataTypes.DATE,
      rejectedAt: DataTypes.DATE,
      createdBy: DataTypes.INTEGER,
      updatedBy: DataTypes.INTEGER,
      quotedAt: DataTypes.DATE,
      benchmarkRating: DataTypes.DOUBLE,
      finalRating: DataTypes.DOUBLE,
      chatbotDealId: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'Reference to the deal ID in the chatbot system',
      },
      previousContractId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null,
      },
      createdAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'Contracts',
      timestamps: true,
      underscored: false,
      updatedAt: false,
    }
  );

  return Contract;
}
