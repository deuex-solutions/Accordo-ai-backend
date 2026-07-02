import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  ForeignKey,
  ModelStatic,
} from 'sequelize';

const statusEnum = ['Created', 'Cancelled'] as const;
export type PoStatus = (typeof statusEnum)[number];

export class Po extends Model<InferAttributes<Po>, InferCreationAttributes<Po>> {
  declare id: CreationOptional<number>;
  declare contractId: ForeignKey<number> | null;
  declare requisitionId: ForeignKey<number> | null;
  declare companyId: ForeignKey<number> | null;
  declare vendorId: ForeignKey<number> | null;
  declare lineItems: string | null;
  declare subTotal: number | null;
  declare taxTotal: number | null;
  declare total: number | null;
  declare deliveryDate: Date | null;
  declare paymentTerms: string | null;
  declare status: PoStatus | null;
  declare poNumber: string | null;
  declare poUrl: string | null;
  declare addedBy: ForeignKey<number> | null;
  declare createdAt: CreationOptional<Date>;

  static associate(models: Record<string, typeof Model>): void {
    this.belongsTo(models.Contract as ModelStatic<Model>, {
      foreignKey: 'contractId',
      as: 'Contract',
    });
    this.belongsTo(models.Requisition as ModelStatic<Model>, {
      foreignKey: 'requisitionId',
      as: 'Requisition',
    });
    this.belongsTo(models.Company as ModelStatic<Model>, {
      foreignKey: 'companyId',
      as: 'Company',
    });
    this.belongsTo(models.User as ModelStatic<Model>, {
      foreignKey: 'addedBy',
      as: 'Creator',
    });
    this.belongsTo(models.User as ModelStatic<Model>, {
      foreignKey: 'vendorId',
      as: 'Vendor',
    });
  }
}

export default function poModel(sequelize: Sequelize): typeof Po {
  Po.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      contractId: DataTypes.INTEGER,
      requisitionId: DataTypes.INTEGER,
      companyId: DataTypes.INTEGER,
      vendorId: DataTypes.INTEGER,
      lineItems: DataTypes.STRING,
      subTotal: DataTypes.DOUBLE,
      taxTotal: DataTypes.DOUBLE,
      total: DataTypes.DOUBLE,
      deliveryDate: DataTypes.DATE,
      paymentTerms: DataTypes.STRING,
      status: DataTypes.ENUM(...statusEnum),
      poNumber: DataTypes.STRING,
      poUrl: DataTypes.STRING,
      addedBy: DataTypes.INTEGER,
      createdAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'Pos',
      timestamps: true,
      underscored: false,
      updatedAt: false,
    }
  );

  return Po;
}
