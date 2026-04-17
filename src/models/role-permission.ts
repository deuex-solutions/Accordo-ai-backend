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

export class RolePermission extends Model<
  InferAttributes<RolePermission>,
  InferCreationAttributes<RolePermission>
> {
  declare id: CreationOptional<number>;
  declare roleId: ForeignKey<number> | null;
  declare moduleId: ForeignKey<number> | null;
  declare permission: number | null;
  declare createdAt: CreationOptional<Date>;

  static associate(models: Record<string, typeof Model>): void {
    this.belongsTo(models.Role as ModelStatic<Model>, {
      foreignKey: 'roleId',
      as: 'Role',
    });
    this.belongsTo(models.Module as ModelStatic<Model>, {
      foreignKey: 'moduleId',
      as: 'Module',
    });
  }
}

export default function rolePermissionModel(sequelize: Sequelize): typeof RolePermission {
  RolePermission.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      roleId: DataTypes.INTEGER,
      moduleId: DataTypes.INTEGER,
      permission: DataTypes.INTEGER,
      createdAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'RolePermissions',
      timestamps: true,
      underscored: false,
      updatedAt: false,
    }
  );

  return RolePermission;
}
