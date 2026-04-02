import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  ForeignKey,
  NonAttribute,
  ModelStatic,
} from 'sequelize';
import type { Company } from './company.js';
import type { Role } from './role.js';

const userTypeEnum = ['super_admin', 'admin', 'procurement', 'vendor'] as const;
export type UserType = (typeof userTypeEnum)[number];

const approvalLevelEnum = ['NONE', 'L1', 'L2', 'L3'] as const;
export type ApprovalLevel = (typeof approvalLevelEnum)[number];

export class User extends Model<
  InferAttributes<User>,
  InferCreationAttributes<User>
> {
  declare id: CreationOptional<number>;
  declare name: string | null;
  declare profilePic: string | null;
  declare email: string | null;
  declare phone: string | null;
  declare password: string | null;
  declare userType: UserType;
  declare companyId: ForeignKey<number> | null;
  declare roleId: ForeignKey<number> | null;
  declare status: string;
  declare approvalLevel: CreationOptional<ApprovalLevel>;
  declare approvalLimit: number | null;
  declare isProtected: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  // Associations
  declare Company?: NonAttribute<Company>;
  declare Role?: NonAttribute<Role>;

  static associate(models: Record<string, typeof Model>): void {
    this.belongsTo(models.Company as ModelStatic<Model>, {
      foreignKey: 'companyId',
      as: 'Company',
    });
    this.belongsTo(models.Role as ModelStatic<Model>, {
      foreignKey: 'roleId',
      as: 'Role',
    });
    this.hasMany(models.Contract as ModelStatic<Model>, {
      foreignKey: 'vendorId',
      as: 'Contract',
    });
    this.hasMany(models.Otp as ModelStatic<Model>, {
      foreignKey: 'user_id',
      as: 'Otp',
    });
    this.hasMany(models.UserAction as ModelStatic<Model>, {
      foreignKey: 'userId',
      as: 'Actions',
    });
    this.hasMany(models.Po as ModelStatic<Model>, {
      foreignKey: 'vendorId',
      as: 'PurchaseOrders',
    });
    this.hasMany(models.Po as ModelStatic<Model>, {
      foreignKey: 'addedBy',
      as: 'CreatedPurchaseOrders',
    });
  }
}

export default function userModel(sequelize: Sequelize): typeof User {
  User.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      name: DataTypes.STRING,
      profilePic: DataTypes.STRING,
      email: {
        type: DataTypes.STRING,
        unique: true,
      },
      phone: DataTypes.STRING,
      password: DataTypes.STRING,
      userType: {
        type: DataTypes.ENUM(...userTypeEnum),
        defaultValue: 'procurement',
      },
      companyId: DataTypes.INTEGER,
      roleId: DataTypes.INTEGER,
      status: {
        type: DataTypes.STRING,
        defaultValue: 'active',
      },
      approvalLevel: {
        type: DataTypes.ENUM(...approvalLevelEnum),
        allowNull: false,
        defaultValue: 'NONE',
      },
      approvalLimit: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true,
        defaultValue: null,
      },
      isProtected: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'User',
      timestamps: true,
      underscored: false,
      defaultScope: {
        attributes: { exclude: ['password'] },
      },
      scopes: {
        withPassword: {
          attributes: { include: [] },
        },
      },
    }
  );

  return User;
}
