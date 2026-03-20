'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('vendor_bids', {
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
      contract_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Contracts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      deal_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'chatbot_deals',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      vendor_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'User',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      final_price: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: true,
      },
      unit_price: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: true,
      },
      payment_terms: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      delivery_date: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      utility_score: {
        type: Sequelize.DECIMAL(10, 4),
        allowNull: true,
      },
      bid_status: {
        type: Sequelize.ENUM('PENDING', 'COMPLETED', 'EXCLUDED', 'SELECTED', 'REJECTED'),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      deal_status: {
        type: Sequelize.ENUM('NEGOTIATING', 'ACCEPTED', 'WALKED_AWAY', 'ESCALATED'),
        allowNull: false,
        defaultValue: 'NEGOTIATING',
      },
      chat_summary_metrics: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      chat_summary_narrative: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      chat_link: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      completed_at: {
        type: Sequelize.DATE,
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
      await queryInterface.addIndex('vendor_bids', ['requisition_id']);
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('vendor_bids', ['vendor_id']);
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('vendor_bids', ['bid_status']);
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('vendor_bids', ['final_price']);
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('vendor_bids', ['deal_id']);
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('vendor_bids', ['contract_id']);
    } catch (e) {
      // Index already exists, skip
    }
  },
  async down(queryInterface) {
    await queryInterface.dropTable('vendor_bids');
  },
};
