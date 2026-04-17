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

export type GenerationSource = 'llm' | 'fallback';

export class NegotiationTrainingData extends Model<
  InferAttributes<NegotiationTrainingData>,
  InferCreationAttributes<NegotiationTrainingData>
> {
  declare id: CreationOptional<number>;
  declare dealId: ForeignKey<string>;
  declare userId: number;
  declare round: number;
  declare suggestionsJson: object;
  declare conversationContext: string | null;
  declare configSnapshot: object | null;
  declare llmModel: string | null;
  declare generationSource: GenerationSource;
  declare selectedScenario: string | null;
  declare selectedSuggestion: string | null;
  declare dealOutcome: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  // Associations
  declare Deal?: NonAttribute<ChatbotDeal>;

  static associate(models: any): void {
    this.belongsTo(models.ChatbotDeal, {
      foreignKey: 'dealId',
      as: 'Deal',
    });
  }
}

export function initNegotiationTrainingDataModel(
  sequelize: Sequelize
): typeof NegotiationTrainingData {
  NegotiationTrainingData.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      dealId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'deal_id',
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'user_id',
      },
      round: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      suggestionsJson: {
        type: DataTypes.JSONB,
        allowNull: false,
        field: 'suggestions_json',
      },
      conversationContext: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'conversation_context',
      },
      configSnapshot: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: 'config_snapshot',
      },
      llmModel: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: 'llm_model',
      },
      generationSource: {
        type: DataTypes.ENUM('llm', 'fallback'),
        allowNull: false,
        defaultValue: 'llm',
        field: 'generation_source',
      },
      selectedScenario: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: 'selected_scenario',
      },
      selectedSuggestion: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'selected_suggestion',
      },
      dealOutcome: {
        type: DataTypes.STRING(50),
        allowNull: true,
        field: 'deal_outcome',
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
      tableName: 'negotiation_training_data',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      underscored: true,
    }
  );
  return NegotiationTrainingData;
}
