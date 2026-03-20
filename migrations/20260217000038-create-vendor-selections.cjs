'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('vendor_selections', {
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
      comparison_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'bid_comparisons',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      selected_vendor_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'User',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      selected_bid_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'vendor_bids',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      selected_price: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: false,
      },
      selected_by_user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'User',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      selection_reason: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      selection_method: {
        type: Sequelize.ENUM('EMAIL_LINK', 'PORTAL', 'API'),
        allowNull: false,
      },
      po_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Pos',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      selected_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    try {
      await queryInterface.addIndex('vendor_selections', ['requisition_id']);
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('vendor_selections', ['selected_vendor_id']);
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('vendor_selections', ['selected_by_user_id']);
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('vendor_selections', ['selected_at']);
    } catch (e) {
      // Index already exists, skip
    }
  },
  async down(queryInterface) {
    await queryInterface.dropTable('vendor_selections');
  },
};
