'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Approvals', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      requisitionId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Requisitions',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      approvalLevel: {
        type: Sequelize.ENUM('L1', 'L2', 'L3'),
        allowNull: false,
      },
      assignedToUserId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'User',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      status: {
        type: Sequelize.ENUM('PENDING', 'APPROVED', 'REJECTED', 'ESCALATED', 'CANCELLED'),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      approvedByUserId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'User',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      rejectionReason: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      comments: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      approvedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      dueDate: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      priority: {
        type: Sequelize.ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT'),
        allowNull: false,
        defaultValue: 'MEDIUM',
      },
      amount: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: true,
      },
      escalatedFromId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'Approvals',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      emailLogId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'EmailLogs',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
    });

    try {
      await queryInterface.addIndex('Approvals', ['requisitionId'], { name: 'idx_approvals_requisition_id' });
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('Approvals', ['assignedToUserId'], { name: 'idx_approvals_assigned_to_user_id' });
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('Approvals', ['status'], { name: 'idx_approvals_status' });
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('Approvals', ['approvalLevel'], { name: 'idx_approvals_approval_level' });
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('Approvals', ['dueDate'], { name: 'idx_approvals_due_date' });
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('Approvals', ['requisitionId', 'approvalLevel'], { name: 'idx_approvals_requisition_level' });
    } catch (e) {
      // Index already exists, skip
    }
  },
  async down(queryInterface) {
    await queryInterface.dropTable('Approvals');
  },
};
