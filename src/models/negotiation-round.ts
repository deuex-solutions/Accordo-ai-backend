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

export interface OfferDetails {
  price?: number;
  deliveryDate?: string;
  paymentTerms?: string;
  [key: string]: unknown;
}

export interface RoundFeedback {
  score?: number;
  message?: string;
  [key: string]: unknown;
}

export class NegotiationRound extends Model<
  InferAttributes<NegotiationRound>,
  InferCreationAttributes<NegotiationRound>
> {
  declare id: CreationOptional<string>;
  declare negotiationId: ForeignKey<string> | null;
  declare roundNumber: number | null;
  declare offerDetails: OfferDetails | null;
  declare feedback: RoundFeedback | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static associate(models: Record<string, typeof Model>): void {
    this.belongsTo(models.Negotiation as ModelStatic<Model>, {
      foreignKey: 'negotiationId',
      as: 'Negotiation',
    });
  }
}

export default function negotiationRoundModel(sequelize: Sequelize): typeof NegotiationRound {
  NegotiationRound.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      negotiationId: DataTypes.UUID,
      roundNumber: DataTypes.INTEGER,
      offerDetails: DataTypes.JSONB,
      feedback: DataTypes.JSONB,
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'NegotiationRounds',
      timestamps: true,
    }
  );

  return NegotiationRound;
}
