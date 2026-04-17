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

export class RequisitionProduct extends Model<
  InferAttributes<RequisitionProduct>,
  InferCreationAttributes<RequisitionProduct>
> {
  declare id: CreationOptional<number>;
  declare requisitionId: ForeignKey<number> | null;
  declare productId: ForeignKey<number> | null;
  declare targetPrice: number | null;
  declare maximum_price: number | null;
  declare qty: number | null;
  declare createdBy: number | null;
  declare createdAt: CreationOptional<Date>;

  static associate(models: Record<string, typeof Model>): void {
    this.belongsTo(models.Requisition as ModelStatic<Model>, {
      foreignKey: 'requisitionId',
      as: 'Requisition',
    });
    this.belongsTo(models.Product as ModelStatic<Model>, {
      foreignKey: 'productId',
      as: 'Product',
    });
  }
}

export default function requisitionProductModel(sequelize: Sequelize): typeof RequisitionProduct {
  RequisitionProduct.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      requisitionId: DataTypes.INTEGER,
      productId: DataTypes.INTEGER,
      targetPrice: DataTypes.DOUBLE,
      maximum_price: DataTypes.DOUBLE,
      qty: DataTypes.INTEGER,
      createdBy: DataTypes.INTEGER,
      createdAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'RequisitionProducts',
      timestamps: true,
      underscored: false,
      updatedAt: false,
    }
  );

  return RequisitionProduct;
}
