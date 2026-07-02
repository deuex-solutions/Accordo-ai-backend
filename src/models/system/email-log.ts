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

const emailStatusEnum = ['pending', 'sent', 'failed', 'bounced'] as const;
const emailTypeEnum = ['vendor_attached', 'status_change', 'reminder', 'other'] as const;

export type EmailStatus = (typeof emailStatusEnum)[number];
export type EmailType = (typeof emailTypeEnum)[number];

export interface EmailMetadata {
  oldStatus?: string;
  newStatus?: string;
  [key: string]: unknown;
}

export class EmailLog extends Model<
  InferAttributes<EmailLog>,
  InferCreationAttributes<EmailLog>
> {
  declare id: CreationOptional<number>;
  declare recipientEmail: string;
  declare recipientId: ForeignKey<number> | null;
  declare subject: string;
  declare emailType: EmailType;
  declare status: EmailStatus;
  declare contractId: ForeignKey<number> | null;
  declare requisitionId: ForeignKey<number> | null;
  declare metadata: EmailMetadata | null;
  declare errorMessage: string | null;
  declare retryCount: number;
  declare sentAt: Date | null;
  declare messageId: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  static associate(models: Record<string, typeof Model>): void {
    this.belongsTo(models.User as ModelStatic<Model>, {
      foreignKey: 'recipientId',
      as: 'Recipient',
    });
    this.belongsTo(models.Contract as ModelStatic<Model>, {
      foreignKey: 'contractId',
      as: 'Contract',
    });
    this.belongsTo(models.Requisition as ModelStatic<Model>, {
      foreignKey: 'requisitionId',
      as: 'Requisition',
    });
  }
}

export default function emailLogModel(sequelize: Sequelize): typeof EmailLog {
  EmailLog.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      recipientEmail: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      recipientId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      subject: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      emailType: {
        type: DataTypes.ENUM(...emailTypeEnum),
        allowNull: false,
        defaultValue: 'other',
      },
      status: {
        type: DataTypes.ENUM(...emailStatusEnum),
        allowNull: false,
        defaultValue: 'pending',
      },
      contractId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      requisitionId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'Additional email metadata (old status, new status, etc.)',
      },
      errorMessage: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      retryCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      sentAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      messageId: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'SMTP message ID for tracking',
      },
      createdAt: DataTypes.DATE,
      updatedAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'EmailLogs',
      timestamps: true,
      indexes: [
        { fields: ['recipientEmail'] },
        { fields: ['status'] },
        { fields: ['emailType'] },
        { fields: ['contractId'] },
        { fields: ['requisitionId'] },
        { fields: ['createdAt'] },
      ],
    }
  );

  return EmailLog;
}
