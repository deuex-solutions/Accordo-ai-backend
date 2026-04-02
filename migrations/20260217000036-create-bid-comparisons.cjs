'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('bid_comparisons', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      requisition_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Requisitions',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      triggered_by: {
        type: Sequelize.ENUM('ALL_COMPLETED', 'DEADLINE_REACHED', 'MANUAL'),
        allowNull: false,
      },
      total_vendors: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      completed_vendors: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      excluded_vendors: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      top_bids_json: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      pdf_url: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      sent_to_user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'User',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      sent_to_email: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      email_status: {
        type: Sequelize.ENUM('PENDING', 'SENT', 'FAILED'),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      email_log_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'EmailLogs',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      generated_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      sent_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    try {
      await queryInterface.addIndex('bid_comparisons', ['requisition_id']);
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('bid_comparisons', ['triggered_by']);
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('bid_comparisons', ['generated_at']);
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('bid_comparisons', ['email_status']);
    } catch (e) {
      // Index already exists, skip
    }
  },
  async down(queryInterface) {
    await queryInterface.dropTable('bid_comparisons');
  },
};
