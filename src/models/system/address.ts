import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  ModelStatic,
} from 'sequelize';

export class Address extends Model<
  InferAttributes<Address>,
  InferCreationAttributes<Address>
> {
  declare id: CreationOptional<number>;
  declare companyId: number;
  declare label: string;
  declare address: string;
  declare city: string | null;
  declare state: string | null;
  declare country: string | null;
  declare postalCode: string | null;
  declare isDefault: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static associate(models: Record<string, typeof Model>): void {
    this.belongsTo(models.Company as ModelStatic<Model>, {
      foreignKey: 'companyId',
      as: 'Company',
    });
  }
}

export default function addressModel(sequelize: Sequelize): typeof Address {
  Address.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      companyId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'Companies',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      label: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      address: {
        type: DataTypes.STRING(500),
        allowNull: false,
      },
      city: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      state: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      country: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      postalCode: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      isDefault: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'Addresses',
      timestamps: true,
      underscored: false,
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
      indexes: [
        { fields: ['companyId'] },
        { fields: ['companyId', 'isDefault'] },
      ],
    }
  );

  return Address;
}
