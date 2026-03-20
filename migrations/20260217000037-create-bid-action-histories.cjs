'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('bid_action_histories', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
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
      bid_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'vendor_bids',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      deal_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'chatbot_deals',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'User',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      action: {
        type: Sequelize.ENUM('SELECTED', 'REJECTED', 'RESTORED', 'VIEWED', 'EXPORTED', 'COMPARISON_GENERATED'),
        allowNull: false,
      },
      action_details: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      remarks: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    try {
      await queryInterface.addIndex('bid_action_histories', ['requisition_id']);
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('bid_action_histories', ['bid_id']);
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('bid_action_histories', ['deal_id']);
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('bid_action_histories', ['user_id']);
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('bid_action_histories', ['action']);
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('bid_action_histories', ['created_at']);
    } catch (e) {
      // Index already exists, skip
    }
  },
  async down(queryInterface) {
    await queryInterface.dropTable('bid_action_histories');
  },
};
