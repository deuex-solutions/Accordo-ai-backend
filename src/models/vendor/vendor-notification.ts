import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  ForeignKey,
  ModelStatic,
  NonAttribute,
} from 'sequelize';

const notificationTypeEnum = ['SELECTION_WON', 'SELECTION_LOST'] as const;
const emailStatusEnum = ['PENDING', 'SENT', 'FAILED'] as const;

export type NotificationType = (typeof notificationTypeEnum)[number];
export type NotificationEmailStatus = (typeof emailStatusEnum)[number];

export class VendorNotification extends Model<
  InferAttributes<VendorNotification>,
  InferCreationAttributes<VendorNotification>
> {
  declare id: CreationOptional<string>;
  declare selectionId: ForeignKey<string>;
  declare vendorId: ForeignKey<number>;
  declare bidId: ForeignKey<string>;

  // Notification
  declare notificationType: NotificationType;
  declare emailLogId: ForeignKey<number> | null;
  declare emailStatus: NotificationEmailStatus;

  // Timestamps
  declare sentAt: Date | null;
  declare createdAt: CreationOptional<Date>;

  // Associations
  declare Selection?: NonAttribute<any>;
  declare Vendor?: NonAttribute<any>;
  declare Bid?: NonAttribute<any>;
  declare EmailLog?: NonAttribute<any>;

  static associate(models: Record<string, typeof Model>): void {
    this.belongsTo(models.VendorSelection as ModelStatic<Model>, {
      foreignKey: 'selectionId',
      as: 'Selection',
    });
    this.belongsTo(models.User as ModelStatic<Model>, {
      foreignKey: 'vendorId',
      as: 'Vendor',
    });
    this.belongsTo(models.VendorBid as ModelStatic<Model>, {
      foreignKey: 'bidId',
      as: 'Bid',
    });
    this.belongsTo(models.EmailLog as ModelStatic<Model>, {
      foreignKey: 'emailLogId',
      as: 'EmailLog',
    });
  }
}

export default function vendorNotificationModel(sequelize: Sequelize): typeof VendorNotification {
  VendorNotification.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      selectionId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'vendor_selections',
          key: 'id',
        },
        comment: 'Reference to the selection decision',
      },
      vendorId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'User',
          key: 'id',
        },
        comment: 'Vendor receiving this notification',
      },
      bidId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'vendor_bids',
          key: 'id',
        },
        comment: 'The bid this notification relates to',
      },
      notificationType: {
        type: DataTypes.ENUM(...notificationTypeEnum),
        allowNull: false,
      },
      emailLogId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'EmailLogs',
          key: 'id',
        },
        comment: 'Reference to email log for audit',
      },
      emailStatus: {
        type: DataTypes.ENUM(...emailStatusEnum),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      sentAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'When the notification email was sent',
      },
      createdAt: DataTypes.DATE,
    },
    {
      sequelize,
      tableName: 'vendor_notifications',
      timestamps: true,
      underscored: true,
      updatedAt: false,
      indexes: [
        { fields: ['selection_id'] },
        { fields: ['vendor_id'] },
        { fields: ['notification_type'] },
        { fields: ['email_status'] },
      ],
    }
  );

  return VendorNotification;
}
