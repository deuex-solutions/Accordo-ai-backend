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

export class VendorCompany extends Model<
  InferAttributes<VendorCompany>,
  InferCreationAttributes<VendorCompany>
> {
  declare id: CreationOptional<number>;
  declare vendorId: ForeignKey<number> | null;
  declare companyId: ForeignKey<number> | null;
  declare createdAt: CreationOptional<Date>;

  static associate(models: Record<string, typeof Model>): void {
    this.belongsTo(models.User as ModelStatic<Model>, {
      foreignKey: 'vendorId',
      as: 'Vendor',
    });
    this.belongsTo(models.Company as ModelStatic<Model>, {
      foreignKey: 'companyId',
      as: 'Company',
    });
  }
}

export default function vendorCompanyModel(sequelize: Sequelize): typeof VendorCompany {
  VendorCompany.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      vendorId: DataTypes.INTEGER,
      companyId: DataTypes.INTEGER,
      createdAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'VendorCompanies',
      timestamps: true,
      underscored: false,
      updatedAt: false,
    }
  );

  return VendorCompany;
}
