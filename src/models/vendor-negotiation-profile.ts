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
import type { User } from './user.js';

/**
 * Vendor negotiation style enum
 */
export type VendorNegotiationStyle = 'aggressive' | 'collaborative' | 'passive' | 'unknown';

/**
 * Preferred terms structure stored in JSONB
 */
export interface PreferredTermsJson {
  /** Preferred payment terms in days */
  paymentTermsDays?: number;
  /** Preferred advance payment percentage */
  advancePaymentPercent?: number;
  /** Preferred delivery days */
  deliveryDays?: number;
  /** Preferred warranty months */
  warrantyMonths?: number;
  /** Flexibility scores per parameter (0-1) */
  flexibility?: {
    price?: number;
    paymentTerms?: number;
    delivery?: number;
    warranty?: number;
  };
}

/**
 * Response time statistics
 */
export interface ResponseTimeStatsJson {
  /** Average response time in milliseconds */
  avgMs: number;
  /** Minimum response time */
  minMs: number;
  /** Maximum response time */
  maxMs: number;
  /** Sample count */
  sampleCount: number;
}

/**
 * Concession patterns
 */
export interface ConcessionPatternsJson {
  /** Average concession per round (%) */
  avgConcessionPerRound: number;
  /** First round concession (%) */
  firstRoundConcession: number;
  /** Does concession accelerate over rounds? */
  accelerating: boolean;
  /** Typical final concession (%) */
  finalConcession: number;
  /** Round-by-round pattern */
  roundPattern?: number[];
}

/**
 * MESO preferences from selections
 */
export interface MesoPreferencesJson {
  /** Preference scores (0-1) */
  scores: {
    price: number;
    paymentTerms: number;
    delivery: number;
    warranty: number;
    quality: number;
  };
  /** Primary detected preference */
  primaryPreference: string;
  /** Confidence in detection */
  confidence: number;
  /** Number of MESO rounds analyzed */
  mesoRoundsAnalyzed: number;
}

/**
 * VendorNegotiationProfile Model
 *
 * Stores persistent vendor negotiation style tracking across deals
 * for Pactum-style behavioral learning.
 */
export class VendorNegotiationProfile extends Model<
  InferAttributes<VendorNegotiationProfile>,
  InferCreationAttributes<VendorNegotiationProfile>
> {
  declare id: CreationOptional<number>;
  declare vendorId: ForeignKey<number>;
  declare totalDeals: CreationOptional<number>;
  declare acceptedDeals: CreationOptional<number>;
  declare walkedAwayDeals: CreationOptional<number>;
  declare escalatedDeals: CreationOptional<number>;
  declare avgConcessionRate: number | null;
  declare avgRoundsToClose: number | null;
  declare avgFinalUtility: number | null;
  declare avgPriceReduction: number | null;
  declare preferredTerms: PreferredTermsJson | null;
  declare negotiationStyle: VendorNegotiationStyle;
  declare styleConfidence: number | null;
  declare successRate: number | null;
  declare behaviorEmbedding: number[] | null;
  declare responseTimeStats: ResponseTimeStatsJson | null;
  declare concessionPatterns: ConcessionPatternsJson | null;
  declare mesoPreferences: MesoPreferencesJson | null;
  declare metadata: object | null;
  declare lastDealAt: Date | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  // Associations
  declare Vendor?: NonAttribute<User>;

  static associate(models: Record<string, unknown>): void {
    this.belongsTo(models.User as typeof User, {
      foreignKey: 'vendorId',
      as: 'Vendor',
    });
  }
}

export function initVendorNegotiationProfileModel(
  sequelize: Sequelize
): typeof VendorNegotiationProfile {
  VendorNegotiationProfile.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      vendorId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
        field: 'vendor_id',
        references: {
          model: 'User',
          key: 'id',
        },
      },
      totalDeals: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'total_deals',
        comment: 'Total number of deals analyzed',
      },
      acceptedDeals: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'accepted_deals',
        comment: 'Deals ended in acceptance',
      },
      walkedAwayDeals: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'walked_away_deals',
        comment: 'Deals ended in walk-away',
      },
      escalatedDeals: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'escalated_deals',
        comment: 'Deals escalated',
      },
      avgConcessionRate: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: true,
        field: 'avg_concession_rate',
        comment: 'Average concession rate per round',
      },
      avgRoundsToClose: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        field: 'avg_rounds_to_close',
        comment: 'Average rounds to close',
      },
      avgFinalUtility: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: true,
        field: 'avg_final_utility',
        comment: 'Average final utility',
      },
      avgPriceReduction: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: true,
        field: 'avg_price_reduction',
        comment: 'Average price reduction %',
      },
      preferredTerms: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: 'preferred_terms',
        comment: 'Preferred negotiation terms',
      },
      negotiationStyle: {
        // Use STRING instead of ENUM to avoid sync issues - actual ENUM is in DB from migration
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'unknown',
        field: 'negotiation_style',
        comment: 'Detected negotiation style',
        validate: {
          isIn: [['aggressive', 'collaborative', 'passive', 'unknown']],
        },
      },
      styleConfidence: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: true,
        field: 'style_confidence',
        comment: 'Confidence in style detection',
      },
      successRate: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: true,
        field: 'success_rate',
        comment: 'Overall success rate',
      },
      behaviorEmbedding: {
        type: DataTypes.ARRAY(DataTypes.FLOAT),
        allowNull: true,
        field: 'behavior_embedding',
        comment: 'Vector embedding for similarity',
      },
      responseTimeStats: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: 'response_time_stats',
        comment: 'Response time statistics',
      },
      concessionPatterns: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: 'concession_patterns',
        comment: 'Concession patterns',
      },
      mesoPreferences: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: 'meso_preferences',
        comment: 'MESO selection preferences',
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'Additional metadata',
      },
      lastDealAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'last_deal_at',
        comment: 'Last deal timestamp',
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
      tableName: 'vendor_negotiation_profiles',
      timestamps: true,
      underscored: true,
      // Note: Indexes are created by migration, not by Sequelize sync
      // This prevents "USING" syntax errors with ENUM columns during sync
      indexes: [],
    }
  );

  return VendorNegotiationProfile;
}
