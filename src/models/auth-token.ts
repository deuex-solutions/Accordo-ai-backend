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

export class AuthToken extends Model<
  InferAttributes<AuthToken>,
  InferCreationAttributes<AuthToken>
> {
  declare id: CreationOptional<number>;
  declare user_id: ForeignKey<number> | null;
  declare token: string | null;
  declare email: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static associate(models: Record<string, typeof Model>): void {
    this.belongsTo(models.User as ModelStatic<Model>, {
      foreignKey: 'user_id',
      as: 'User',
      constraints: false,
    });
  }
}

export default function authTokenModel(sequelize: Sequelize): typeof AuthToken {
  AuthToken.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      user_id: DataTypes.INTEGER,
      token: DataTypes.TEXT, // TEXT to accommodate long JWT tokens
      email: DataTypes.STRING,
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'authTokens',
      timestamps: true,
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    }
  );

  return AuthToken;
}
