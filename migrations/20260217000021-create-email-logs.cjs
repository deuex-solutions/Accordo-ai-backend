'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
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

    try {
      await queryInterface.addIndex('EmailLogs', ['recipientEmail']);
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('EmailLogs', ['status']);
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('EmailLogs', ['emailType']);
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('EmailLogs', ['contractId']);
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('EmailLogs', ['requisitionId']);
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('EmailLogs', ['createdAt']);
    } catch (e) {
      // Index already exists, skip
    }
  },
  async down(queryInterface) {
    await queryInterface.dropTable('EmailLogs');
  },
};
