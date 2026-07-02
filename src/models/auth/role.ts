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

export class Role extends Model<
  InferAttributes<Role>,
  InferCreationAttributes<Role>
> {
  declare id: CreationOptional<number>;
  declare name: string | null;
  declare createdBy: ForeignKey<number> | null;
  declare companyId: ForeignKey<number> | null;
  declare updatedBy: ForeignKey<number> | null;
  declare isArchived: boolean | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static associate(models: Record<string, typeof Model>): void {
    this.hasMany(models.RolePermission as ModelStatic<Model>, {
      foreignKey: 'roleId',
      as: 'RolePermission',
    });
    this.belongsTo(models.User as ModelStatic<Model>, {
      foreignKey: 'createdBy',
      as: 'Creator',
    });
    this.belongsTo(models.User as ModelStatic<Model>, {
      foreignKey: 'updatedBy',
      as: 'Updator',
    });
    this.hasMany(models.User as ModelStatic<Model>, {
      foreignKey: 'roleId',
      as: 'Users',
    });
  }
}

export default function roleModel(sequelize: Sequelize): typeof Role {
  Role.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      name: DataTypes.STRING,
      createdBy: DataTypes.INTEGER,
      companyId: DataTypes.INTEGER,
      updatedBy: DataTypes.INTEGER,
      isArchived: DataTypes.BOOLEAN,
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'Roles',
      timestamps: true,
      underscored: false,
      updatedAt: false,
    }
  );

  return Role;
}
