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

const statusEnum = ['active', 'completed', 'failed'] as const;
export type NegotiationStatus = (typeof statusEnum)[number];

export class Negotiation extends Model<
  InferAttributes<Negotiation>,
  InferCreationAttributes<Negotiation>
> {
  declare id: CreationOptional<string>;
  declare rfqId: ForeignKey<number> | null;
  declare vendorId: ForeignKey<number> | null;
  declare status: NegotiationStatus;
  declare round: number;
  declare score: number;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static associate(models: Record<string, typeof Model>): void {
    this.belongsTo(models.Requisition as ModelStatic<Model>, {
      foreignKey: 'rfqId',
      as: 'Requisition',
    });
    this.belongsTo(models.User as ModelStatic<Model>, {
      foreignKey: 'vendorId',
      as: 'Vendor',
    });
    this.hasMany(models.NegotiationRound as ModelStatic<Model>, {
      foreignKey: 'negotiationId',
      as: 'Rounds',
    });
  }
}

export default function negotiationModel(sequelize: Sequelize): typeof Negotiation {
  Negotiation.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      rfqId: DataTypes.INTEGER,
      vendorId: DataTypes.INTEGER,
      status: {
        type: DataTypes.ENUM(...statusEnum),
        defaultValue: 'active',
      },
      round: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
      },
      score: {
        type: DataTypes.FLOAT,
        defaultValue: 0.0,
      },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'Negotiations',
      timestamps: true,
    }
  );

  return Negotiation;
}
