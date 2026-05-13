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

export class UserAction extends Model<
  InferAttributes<UserAction>,
  InferCreationAttributes<UserAction>
> {
  declare id: CreationOptional<number>;
  declare userId: ForeignKey<number> | null;
  declare moduleName: string | null;
  declare action: string | null;
  declare createdAt: CreationOptional<Date>;

  static associate(models: Record<string, typeof Model>): void {
    this.belongsTo(models.User as ModelStatic<Model>, {
      foreignKey: 'userId',
      as: 'User',
    });
  }
}

export default function userActionModel(sequelize: Sequelize): typeof UserAction {
  UserAction.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: DataTypes.INTEGER,
      moduleName: DataTypes.STRING,
      action: DataTypes.STRING,
      createdAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'UserActions',
      timestamps: true,
      underscored: false,
      updatedAt: false,
    }
  );

  return UserAction;
}
