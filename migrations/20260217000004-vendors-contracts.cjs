'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    // ── VendorCompanies ──
    await queryInterface.createTable('VendorCompanies', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      vendorId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'User',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      companyId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Companies',
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

    // ── Contracts ──
    await queryInterface.createTable('Contracts', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      companyId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Companies',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      requisitionId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Requisitions',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      vendorId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'User',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      status: {
        type: Sequelize.ENUM(
          'Created', 'Active', 'Opened', 'Completed', 'Verified',
          'Accepted', 'Rejected', 'Expired', 'Escalated', 'InitialQuotation'
        ),
        allowNull: true,
        defaultValue: 'Created',
      },
      uniqueToken: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      contractDetails: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      finalContractDetails: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      openedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      completedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      verifiedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      acceptedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      rejectedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      createdBy: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      updatedBy: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      quotedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      benchmarkRating: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      finalRating: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      chatbotDealId: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      previousContractId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: null,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    // ── Pos ──
    await queryInterface.createTable('Pos', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      contractId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Contracts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      requisitionId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Requisitions',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      companyId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Companies',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      vendorId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'User',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      lineItems: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      subTotal: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      taxTotal: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      total: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      deliveryDate: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      paymentTerms: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM('Created', 'Cancelled'),
        allowNull: true,
      },
      poNumber: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      poUrl: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      addedBy: {
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

    // ── EmailLogs ──
    await queryInterface.createTable('EmailLogs', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      recipientEmail: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      recipientId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'User',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      subject: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      emailType: {
        type: Sequelize.ENUM('vendor_attached', 'status_change', 'reminder', 'other'),
        allowNull: false,
        defaultValue: 'other',
      },
      status: {
        type: Sequelize.ENUM('pending', 'sent', 'failed', 'bounced'),
        allowNull: false,
        defaultValue: 'pending',
      },
      contractId: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      requisitionId: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      errorMessage: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      retryCount: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      sentAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      messageId: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('EmailLogs', ['recipientEmail']);
    await queryInterface.addIndex('EmailLogs', ['status']);
    await queryInterface.addIndex('EmailLogs', ['emailType']);
    await queryInterface.addIndex('EmailLogs', ['contractId']);
    await queryInterface.addIndex('EmailLogs', ['requisitionId']);
    await queryInterface.addIndex('EmailLogs', ['createdAt']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('EmailLogs');
    await queryInterface.dropTable('Pos');
    await queryInterface.dropTable('Contracts');
    await queryInterface.dropTable('VendorCompanies');
  },
};
