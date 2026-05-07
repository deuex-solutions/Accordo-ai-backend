import {
  Model,
  DataTypes,
  Sequelize,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  ForeignKey,
  NonAttribute,
  ModelStatic,
} from 'sequelize';
import type { User } from './user.js';
import type { Requisition } from './requisition.js';
import type { EmailLog } from './email-log.js';

const approvalLevelEnum = ['L1', 'L2', 'L3'] as const;
export type ApprovalLevelType = (typeof approvalLevelEnum)[number];

const approvalStatusEnum = ['PENDING', 'APPROVED', 'REJECTED', 'ESCALATED', 'CANCELLED'] as const;
export type ApprovalStatusType = (typeof approvalStatusEnum)[number];

const priorityEnum = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type PriorityType = (typeof priorityEnum)[number];

export class Approval extends Model<
  InferAttributes<Approval>,
  InferCreationAttributes<Approval>
> {
  declare id: CreationOptional<string>;
  declare requisitionId: ForeignKey<number>;
  declare approvalLevel: ApprovalLevelType;
  declare assignedToUserId: ForeignKey<number>;
  declare status: ApprovalStatusType;
  declare approvedByUserId: ForeignKey<number> | null;
  declare rejectionReason: string | null;
  declare comments: string | null;
  declare approvedAt: Date | null;
  declare dueDate: Date | null;
  declare priority: PriorityType;
  declare amount: number | null;
  declare escalatedFromId: string | null;
  declare emailLogId: ForeignKey<number> | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  // Associations
  declare Requisition?: NonAttribute<Requisition>;
  declare AssignedTo?: NonAttribute<User>;
  declare ApprovedBy?: NonAttribute<User>;
  declare EmailLog?: NonAttribute<EmailLog>;
  declare EscalatedFrom?: NonAttribute<Approval>;

  static associate(models: Record<string, typeof Model>): void {
    this.belongsTo(models.Requisition as ModelStatic<Model>, {
      foreignKey: 'requisitionId',
      as: 'Requisition',
    });
    this.belongsTo(models.User as ModelStatic<Model>, {
      foreignKey: 'assignedToUserId',
      as: 'AssignedTo',
    });
    this.belongsTo(models.User as ModelStatic<Model>, {
      foreignKey: 'approvedByUserId',
      as: 'ApprovedBy',
    });
    this.belongsTo(models.EmailLog as ModelStatic<Model>, {
      foreignKey: 'emailLogId',
      as: 'EmailLog',
    });
    this.belongsTo(models.Approval as ModelStatic<Model>, {
      foreignKey: 'escalatedFromId',
      as: 'EscalatedFrom',
    });
    this.hasMany(models.Approval as ModelStatic<Model>, {
      foreignKey: 'escalatedFromId',
      as: 'EscalatedTo',
    });
  }
}

export function initApprovalModel(sequelize: Sequelize): typeof Approval {
  Approval.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      requisitionId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      approvalLevel: {
        type: DataTypes.ENUM(...approvalLevelEnum),
        allowNull: false,
      },
      assignedToUserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM(...approvalStatusEnum),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      approvedByUserId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      rejectionReason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      comments: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      approvedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      dueDate: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      priority: {
        type: DataTypes.ENUM(...priorityEnum),
        allowNull: false,
        defaultValue: 'MEDIUM',
      },
      amount: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true,
      },
      escalatedFromId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      emailLogId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      tableName: 'Approvals',
      timestamps: true,
      underscored: false,
      indexes: [
        { fields: ['requisitionId'], name: 'idx_approvals_requisition_id' },
        { fields: ['assignedToUserId'], name: 'idx_approvals_assigned_to_user_id' },
        { fields: ['status'], name: 'idx_approvals_status' },
        { fields: ['approvalLevel'], name: 'idx_approvals_approval_level' },
        { fields: ['dueDate'], name: 'idx_approvals_due_date' },
        { fields: ['requisitionId', 'approvalLevel'], name: 'idx_approvals_requisition_level' },
      ],
    }
  );

  return Approval;
}

export default initApprovalModel;
