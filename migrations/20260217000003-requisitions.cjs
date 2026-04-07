'use strict';

async function safeCreateTable(queryInterface, tableName, attributes, options) {
  try {
    await queryInterface.createTable(tableName, attributes, options);
  } catch (e) {
    if (e.message && e.message.includes('already exists')) return;
    throw e;
  }
}

async function safeAddIndex(queryInterface, table, fields, options) {
  try {
    await queryInterface.addIndex(table, fields, options);
  } catch (e) {
    if (e.message && e.message.includes('already exists')) return;
    throw e;
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    // ── Requisitions ──
    await safeCreateTable(queryInterface,'Requisitions', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      projectId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Projects',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      rfqId: {
        type: Sequelize.STRING,
        allowNull: true,
        unique: true,
      },
      subject: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      category: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      deliveryDate: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      negotiationClosureDate: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      typeOfCurrency: {
        type: Sequelize.ENUM('USD', 'INR', 'EUR', 'GBP', 'AUD'),
        allowNull: true,
      },
      totalQuantity: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      totalPrice: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      totalMaxPrice: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      finalPrice: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM(
          'Draft', 'Created', 'Fulfilled', 'Benchmarked', 'InitialQuotation',
          'Closed', 'Awarded', 'Cancelled', 'Expired', 'NegotiationStarted'
        ),
        allowNull: true,
      },
      savingsInPrice: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      createdBy: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      fulfilledAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      fulfilledBy: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      payment_terms: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      net_payment_day: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      pre_payment_percentage: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      post_payment_percentage: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      maxDeliveryDate: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      batna: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      discountedValue: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      maxDiscount: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      approvalStatus: {
        type: Sequelize.ENUM(
          'NOT_SUBMITTED', 'PENDING_L1', 'APPROVED_L1', 'PENDING_L2',
          'APPROVED_L2', 'PENDING_L3', 'APPROVED_L3', 'FULLY_APPROVED', 'REJECTED'
        ),
        allowNull: false,
        defaultValue: 'NOT_SUBMITTED',
      },
      currentApprovalLevel: {
        type: Sequelize.ENUM('L1', 'L2', 'L3'),
        allowNull: true,
        defaultValue: null,
      },
      totalEstimatedAmount: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: true,
        defaultValue: null,
      },
      requiredApprovalLevel: {
        type: Sequelize.ENUM('L1', 'L2', 'L3'),
        allowNull: true,
        defaultValue: null,
      },
      submittedForApprovalAt: {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: null,
      },
      submittedByUserId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: null,
        references: {
          model: 'User',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      archivedAt: {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: null,
      },
    });

    // ── RequisitionProducts ──
    await safeCreateTable(queryInterface,'RequisitionProducts', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      requisitionId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Requisitions',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      productId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Products',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      targetPrice: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      maximum_price: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      qty: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      createdBy: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    // ── RequisitionAttachments ──
    await safeCreateTable(queryInterface,'RequisitionAttachments', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      requisitionId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Requisitions',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      attachmentUrl: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      createdBy: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'User',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    // ── Approvals ──
    // NOTE: emailLogId FK to EmailLogs is added in the indexes-and-constraints migration
    await safeCreateTable(queryInterface,'Approvals', {
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

    await safeAddIndex(queryInterface,'Approvals', ['requisitionId'], { name: 'idx_approvals_requisition_id' });
    await safeAddIndex(queryInterface,'Approvals', ['assignedToUserId'], { name: 'idx_approvals_assigned_to_user_id' });
    await safeAddIndex(queryInterface,'Approvals', ['status'], { name: 'idx_approvals_status' });
    await safeAddIndex(queryInterface,'Approvals', ['approvalLevel'], { name: 'idx_approvals_approval_level' });
    await safeAddIndex(queryInterface,'Approvals', ['dueDate'], { name: 'idx_approvals_due_date' });
    await safeAddIndex(queryInterface,'Approvals', ['requisitionId', 'approvalLevel'], { name: 'idx_approvals_requisition_level' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('Approvals');
    await queryInterface.dropTable('RequisitionAttachments');
    await queryInterface.dropTable('RequisitionProducts');
    await queryInterface.dropTable('Requisitions');
  },
};
