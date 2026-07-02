import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';

export interface PreferenceWeights {
  price?: number;
  delivery?: number;
  quality?: number;
  [key: string]: unknown;
}

export interface PreferenceConstraints {
  minPrice?: number;
  maxPrice?: number;
  maxDeliveryDays?: number;
  [key: string]: unknown;
}

export class Preference extends Model<
  InferAttributes<Preference>,
  InferCreationAttributes<Preference>
> {
  declare id: CreationOptional<string>;
  declare entityId: number | null;
  declare entityType: string | null;
  declare context: string;
  declare weights: PreferenceWeights | null;
  declare constraints: PreferenceConstraints | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static associate(_models: Record<string, typeof Model>): void {
    // Polymorphic association could be complex, so we'll keep it simple for now
    // or add specific methods if needed.
  }
}

export default function preferenceModel(sequelize: Sequelize): typeof Preference {
  Preference.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      entityId: DataTypes.INTEGER,
      entityType: DataTypes.STRING, // 'User' or 'Company'
      context: {
        type: DataTypes.STRING,
        defaultValue: 'global',
      },
      weights: DataTypes.JSONB,
      constraints: DataTypes.JSONB,
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'Preferences',
      timestamps: true,
    }
  );

  return Preference;
}
