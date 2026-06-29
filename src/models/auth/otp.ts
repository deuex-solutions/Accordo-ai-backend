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

export class Otp extends Model<InferAttributes<Otp>, InferCreationAttributes<Otp>> {
  declare id: CreationOptional<number>;
  declare user_id: ForeignKey<number> | null;
  declare otp: string | null;
  declare for: string | null;
  declare createdAt: CreationOptional<Date>;

  static associate(models: Record<string, typeof Model>): void {
    this.belongsTo(models.User as ModelStatic<Model>, {
      foreignKey: 'user_id',
      as: 'User',
    });
  }
}

export default function otpModel(sequelize: Sequelize): typeof Otp {
  Otp.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      user_id: DataTypes.INTEGER,
      otp: DataTypes.STRING,
      for: DataTypes.STRING,
      createdAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'Otps',
      timestamps: false,
    }
  );

  return Otp;
}
