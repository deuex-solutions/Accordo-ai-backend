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

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

export interface ChatContext {
  negotiationPhase?: string;
  lastOffer?: object;
  [key: string]: unknown;
}

export class ChatSession extends Model<
  InferAttributes<ChatSession>,
  InferCreationAttributes<ChatSession>
> {
  declare id: CreationOptional<string>;
  declare negotiationId: ForeignKey<string> | null;
  declare userId: ForeignKey<number> | null;
  declare history: ChatMessage[];
  declare context: ChatContext;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static associate(models: Record<string, typeof Model>): void {
    this.belongsTo(models.Negotiation as ModelStatic<Model>, {
      foreignKey: 'negotiationId',
      as: 'Negotiation',
    });
    this.belongsTo(models.User as ModelStatic<Model>, {
      foreignKey: 'userId',
      as: 'User',
    });
  }
}

export default function chatSessionModel(sequelize: Sequelize): typeof ChatSession {
  ChatSession.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      negotiationId: DataTypes.UUID,
      userId: DataTypes.INTEGER,
      history: {
        type: DataTypes.JSONB,
        defaultValue: [],
      },
      context: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'ChatSessions',
      timestamps: true,
    }
  );

  return ChatSession;
}
