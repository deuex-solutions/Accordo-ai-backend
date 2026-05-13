/**
 * API Usage Log Model
 *
 * Tracks token usage for OpenAI and Ollama API calls
 * for cost monitoring and analytics.
 */

import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database.js';

export interface ApiUsageLogAttributes {
  id: number;
  provider: 'openai' | 'ollama';
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  dealId: string | null;
  userId: number | null;
  createdAt: Date;
}

export interface ApiUsageLogCreationAttributes
  extends Optional<ApiUsageLogAttributes, 'id' | 'createdAt'> {}

class ApiUsageLog
  extends Model<ApiUsageLogAttributes, ApiUsageLogCreationAttributes>
  implements ApiUsageLogAttributes
{
  declare id: number;
  declare provider: 'openai' | 'ollama';
  declare model: string;
  declare promptTokens: number;
  declare completionTokens: number;
  declare totalTokens: number;
  declare dealId: string | null;
  declare userId: number | null;
  declare createdAt: Date;
}

ApiUsageLog.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    provider: {
      type: DataTypes.ENUM('openai', 'ollama'),
      allowNull: false,
    },
    model: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    promptTokens: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    completionTokens: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    totalTokens: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    dealId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: 'ApiUsageLogs',
    timestamps: false,
    indexes: [
      {
        fields: ['provider'],
      },
      {
        fields: ['createdAt'],
      },
      {
        fields: ['dealId'],
      },
      {
        fields: ['userId'],
      },
    ],
  }
);

export default ApiUsageLog;
