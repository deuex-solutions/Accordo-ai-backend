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
import type { ChatbotTemplate } from './chatbot-template.js';

export type ParameterType = 'number' | 'string' | 'boolean' | 'date';

export class ChatbotTemplateParameter extends Model<
  InferAttributes<ChatbotTemplateParameter>,
  InferCreationAttributes<ChatbotTemplateParameter>
> {
  declare id: CreationOptional<string>;
  declare templateId: ForeignKey<string>;
  declare parameterKey: string;
  declare parameterType: ParameterType;
  declare weight: number | null;
  declare minValue: number | null;
  declare maxValue: number | null;
  declare defaultValue: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  // Associations
  declare Template?: NonAttribute<ChatbotTemplate>;

  static associate(models: any): void {
    this.belongsTo(models.ChatbotTemplate, {
      foreignKey: 'templateId',
      as: 'Template',
    });
  }
}

export function initChatbotTemplateParameterModel(
  sequelize: Sequelize
): typeof ChatbotTemplateParameter {
  ChatbotTemplateParameter.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      templateId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'template_id',
      },
      parameterKey: {
        type: DataTypes.STRING,
        allowNull: false,
        field: 'parameter_key',
      },
      parameterType: {
        type: DataTypes.ENUM('number', 'string', 'boolean', 'date'),
        allowNull: false,
        defaultValue: 'number',
        field: 'parameter_type',
      },
      weight: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: true,
      },
      minValue: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true,
        field: 'min_value',
      },
      maxValue: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true,
        field: 'max_value',
      },
      defaultValue: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'default_value',
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'created_at',
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'updated_at',
      },
    },
    {
      sequelize,
      tableName: 'chatbot_template_parameters',
      timestamps: true,
      underscored: true,
    }
  );
  return ChatbotTemplateParameter;
}
