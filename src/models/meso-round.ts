import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  ForeignKey,
  NonAttribute,
} from 'sequelize';
import type { ChatbotDeal } from './chatbot-deal.js';

/**
 * MESO Option structure stored in options JSONB
 */
export interface MesoOptionJson {
  id: string;
  offer: {
    total_price: number | null;
    payment_terms: string | null;
    payment_terms_days?: number | null;
    delivery_days?: number | null;
    delivery_date?: string | null;
    warranty_months?: number | null;
    partial_delivery_allowed?: boolean | null;
  };
  utility: number;
  label: string;
  description: string;
  emphasis: string[];
  tradeoffs: string[];
}

/**
 * Vendor selection stored in vendor_selection JSONB
 */
export interface VendorSelectionJson {
  selectedOptionId: string;
  selectedOffer: MesoOptionJson['offer'];
  /** ISO date string when selection was made (February 2026) */
  selectedAt?: string;
  inferredPreferences?: {
    primaryPreference: string;
    confidence: number;
    preferenceAdjustments: Record<string, number>;
  };
}

/**
 * MesoRound Model
 *
 * Stores Multiple Equivalent Simultaneous Offers (MESO) rounds
 * for Pactum-style negotiation with preference discovery.
 */
export class MesoRound extends Model<
  InferAttributes<MesoRound>,
  InferCreationAttributes<MesoRound>
> {
  declare id: CreationOptional<string>;
  declare dealId: ForeignKey<string>;
  declare round: number;
  declare options: MesoOptionJson[];
  declare targetUtility: number | null;
  declare variance: number | null;
  declare vendorSelection: VendorSelectionJson | null;
  declare selectedOptionId: string | null;
  declare inferredPreferences: Record<string, number> | null;
  declare preferenceConfidence: number | null;
  declare metadata: object | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  // Associations
  declare Deal?: NonAttribute<ChatbotDeal>;

  static associate(models: Record<string, unknown>): void {
    this.belongsTo(models.ChatbotDeal as typeof ChatbotDeal, {
      foreignKey: 'dealId',
      as: 'Deal',
    });
  }
}

export function initMesoRoundModel(sequelize: Sequelize): typeof MesoRound {
  MesoRound.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      dealId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'deal_id',
        references: {
          model: 'chatbot_deals',
          key: 'id',
        },
      },
      round: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: 'Negotiation round number when MESO was generated',
      },
      options: {
        type: DataTypes.JSONB,
        allowNull: false,
        comment: 'Array of MesoOption objects presented to vendor',
      },
      targetUtility: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: true,
        field: 'target_utility',
        comment: 'Target utility score for all options',
      },
      variance: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: true,
        comment: 'Actual variance between option utilities',
      },
      vendorSelection: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: 'vendor_selection',
        comment: 'Vendor selection details',
      },
      selectedOptionId: {
        type: DataTypes.STRING,
        allowNull: true,
        field: 'selected_option_id',
        comment: 'ID of the selected MESO option',
      },
      inferredPreferences: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: 'inferred_preferences',
        comment: 'Inferred vendor preferences from selection',
      },
      preferenceConfidence: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: true,
        field: 'preference_confidence',
        comment: 'Confidence in inferred preferences (0-1)',
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'Additional metadata',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'created_at',
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'updated_at',
      },
    },
    {
      sequelize,
      tableName: 'meso_rounds',
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: 'idx_meso_rounds_deal_id',
          fields: ['deal_id'],
        },
        {
          name: 'idx_meso_rounds_round',
          fields: ['round'],
        },
        {
          name: 'idx_meso_rounds_deal_round',
          fields: ['deal_id', 'round'],
          unique: true,
        },
        {
          name: 'idx_meso_rounds_selected_option',
          fields: ['selected_option_id'],
        },
      ],
    }
  );

  return MesoRound;
}
