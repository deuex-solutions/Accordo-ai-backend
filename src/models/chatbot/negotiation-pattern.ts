import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';

export type PatternType = 'successful_negotiation' | 'failed_negotiation' | 'escalation' | 'walkaway' | 'quick_acceptance';

export class NegotiationPattern extends Model<
  InferAttributes<NegotiationPattern>,
  InferCreationAttributes<NegotiationPattern>
> {
  declare id: CreationOptional<string>;
  declare embedding: number[];
  declare contentText: string;
  declare patternType: PatternType;
  declare patternName: string;
  declare description: string | null;
  declare scenario: string | null;
  declare avgUtility: number | null;
  declare avgRounds: number | null;
  declare avgPriceReduction: number | null;
  declare successRate: number | null;
  declare sampleCount: number;
  declare productCategories: string[] | null;
  declare priceRanges: string[] | null;
  declare vendorTypes: string[] | null;
  declare keyFactors: object | null;
  declare exampleDealIds: string[] | null;
  declare metadata: object | null;
  declare isActive: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export function initNegotiationPatternModel(sequelize: Sequelize): typeof NegotiationPattern {
  NegotiationPattern.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      embedding: {
        type: DataTypes.ARRAY(DataTypes.FLOAT),
        allowNull: false,
        comment: 'Vector embedding (1024 dimensions for bge-large-en-v1.5)',
      },
      contentText: {
        type: DataTypes.TEXT,
        allowNull: false,
        field: 'content_text',
        comment: 'Pattern description text that was embedded',
      },
      patternType: {
        type: DataTypes.ENUM('successful_negotiation', 'failed_negotiation', 'escalation', 'walkaway', 'quick_acceptance'),
        allowNull: false,
        field: 'pattern_type',
      },
      patternName: {
        type: DataTypes.STRING,
        allowNull: false,
        field: 'pattern_name',
        comment: 'Human-readable pattern name',
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Detailed description of the pattern',
      },
      scenario: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Negotiation scenario: HARD, MEDIUM, SOFT, etc.',
      },
      avgUtility: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: true,
        field: 'avg_utility',
        comment: 'Average utility score for this pattern',
      },
      avgRounds: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        field: 'avg_rounds',
        comment: 'Average number of negotiation rounds',
      },
      avgPriceReduction: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: true,
        field: 'avg_price_reduction',
        comment: 'Average price reduction percentage achieved',
      },
      successRate: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: true,
        field: 'success_rate',
        comment: 'Success rate (0-1) for negotiations following this pattern',
      },
      sampleCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'sample_count',
        comment: 'Number of deals that contributed to this pattern',
      },
      productCategories: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        allowNull: true,
        field: 'product_categories',
        comment: 'Product categories where this pattern applies',
      },
      priceRanges: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        allowNull: true,
        field: 'price_ranges',
        comment: 'Price ranges where this pattern applies',
      },
      vendorTypes: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        allowNull: true,
        field: 'vendor_types',
        comment: 'Vendor types where this pattern is effective',
      },
      keyFactors: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: 'key_factors',
        comment: 'Key factors that contributed to the pattern outcome',
      },
      exampleDealIds: {
        type: DataTypes.ARRAY(DataTypes.UUID),
        allowNull: true,
        field: 'example_deal_ids',
        comment: 'Example deal IDs that exemplify this pattern',
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'Additional metadata for analysis',
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        field: 'is_active',
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
      tableName: 'negotiation_patterns',
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: 'idx_negotiation_patterns_type',
          fields: ['pattern_type'],
        },
        {
          name: 'idx_negotiation_patterns_scenario',
          fields: ['scenario'],
        },
        {
          name: 'idx_negotiation_patterns_success_rate',
          fields: ['success_rate'],
        },
        {
          name: 'idx_negotiation_patterns_active',
          fields: ['is_active'],
        },
        {
          name: 'idx_negotiation_patterns_created_at',
          fields: ['created_at'],
        },
      ],
    }
  );
  return NegotiationPattern;
}
