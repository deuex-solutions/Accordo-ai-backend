import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  ModelStatic,
} from 'sequelize';

export class Module extends Model<
  InferAttributes<Module>,
  InferCreationAttributes<Module>
> {
  declare id: CreationOptional<number>;
  declare name: string | null;
  declare isArchived: boolean | null;
  declare createdAt: CreationOptional<Date>;

  static associate(models: Record<string, typeof Model>): void {
    this.hasMany(models.RolePermission as ModelStatic<Model>, {
      foreignKey: 'moduleId',
      as: 'RolePermissions',
    });
  }
}

export default function moduleModel(sequelize: Sequelize): typeof Module {
  Module.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      name: DataTypes.STRING,
      isArchived: DataTypes.BOOLEAN,
      createdAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'Modules',
      timestamps: true,
      updatedAt: false,
    }
  );

  return Module;
}
