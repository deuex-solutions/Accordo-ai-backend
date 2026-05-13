import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  NonAttribute,
} from 'sequelize';
import type { ChatbotTemplateParameter } from './chatbot-template-parameter.js';
import type { ChatbotDeal } from './chatbot-deal.js';

export class ChatbotTemplate extends Model<
  InferAttributes<ChatbotTemplate>,
  InferCreationAttributes<ChatbotTemplate>
> {
  declare id: CreationOptional<string>;
  declare name: string;
  declare description: string | null;
  declare configJson: object | null;
  declare isActive: boolean;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  // Associations
  declare Parameters?: NonAttribute<ChatbotTemplateParameter[]>;
  declare Deals?: NonAttribute<ChatbotDeal[]>;

  static associate(models: any): void {
    this.hasMany(models.ChatbotTemplateParameter, {
      foreignKey: 'templateId',
      as: 'Parameters',
    });
    this.hasMany(models.ChatbotDeal, {
      foreignKey: 'templateId',
      as: 'Deals',
    });
  }
}

export function initChatbotTemplateModel(sequelize: Sequelize): typeof ChatbotTemplate {
  ChatbotTemplate.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      configJson: {
        type: DataTypes.JSONB,
        allowNull: true,
        field: 'config_json',
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false,
        field: 'is_active',
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
      tableName: 'chatbot_templates',
      timestamps: true,
      underscored: true,
    }
  );
  return ChatbotTemplate;
}
