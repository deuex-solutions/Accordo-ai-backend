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

const gstTypeEnum = ['GST', 'Non-GST'] as const;
export type GSTType = (typeof gstTypeEnum)[number];

export class Product extends Model<
  InferAttributes<Product>,
  InferCreationAttributes<Product>
> {
  declare id: CreationOptional<number>;
  declare productName: string | null;
  declare category: string | null;
  declare brandName: string | null;
  declare gstType: GSTType | null;
  declare gstPercentage: number | null;
  declare tds: number | null;
  declare type: string | null;
  declare UOM: string | null;
  declare companyId: ForeignKey<number> | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static associate(models: Record<string, typeof Model>): void {
    this.belongsTo(models.Company as ModelStatic<Model>, {
      foreignKey: 'companyId',
      as: 'Company',
    });
    this.hasMany(models.RequisitionProduct as ModelStatic<Model>, {
      foreignKey: 'productId',
      as: 'RequisitionProducts',
    });
  }
}

export default function productModel(sequelize: Sequelize): typeof Product {
  Product.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      productName: DataTypes.STRING,
      category: DataTypes.STRING,
      brandName: DataTypes.STRING,
      gstType: DataTypes.ENUM(...gstTypeEnum),
      gstPercentage: DataTypes.INTEGER,
      tds: DataTypes.DOUBLE,
      type: DataTypes.STRING,
      UOM: DataTypes.STRING,
      companyId: DataTypes.INTEGER,
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'Products',
      timestamps: true,
      underscored: false,
    }
  );

  return Product;
}
