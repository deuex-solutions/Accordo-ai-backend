'use strict';

/**
 * Migration: Create MESO Rounds Table
 *
 * Stores Multiple Equivalent Simultaneous Offers (MESO) rounds for
 * Pactum-style negotiation with preference discovery.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('meso_rounds', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
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
      round: {
        type: Sequelize.INTEGER,
        allowNull: false,
        comment: 'Negotiation round number when MESO was generated',
      },
      options: {
        type: Sequelize.JSONB,
        allowNull: false,
        comment: 'Array of MesoOption objects presented to vendor',
      },
      target_utility: {
        type: Sequelize.DECIMAL(10, 4),
        allowNull: true,
        comment: 'Target utility score for all options',
      },
      variance: {
        type: Sequelize.DECIMAL(10, 4),
        allowNull: true,
        comment: 'Actual variance between option utilities',
      },
      vendor_selection: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'Vendor selection details (option ID, offer, inferred preferences)',
      },
      selected_option_id: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'ID of the selected MESO option',
      },
      inferred_preferences: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'Inferred vendor preferences from selection',
      },
      preference_confidence: {
        type: Sequelize.DECIMAL(10, 4),
        allowNull: true,
        comment: 'Confidence in inferred preferences (0-1)',
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'Additional metadata (strategy used, etc.)',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    // Indexes
    try {
      await queryInterface.addIndex('meso_rounds', ['deal_id'], {
        name: 'idx_meso_rounds_deal_id',
      });
    } catch (e) {
      // Index already exists, skip
    }

    try {
      await queryInterface.addIndex('meso_rounds', ['round'], {
        name: 'idx_meso_rounds_round',
      });
    } catch (e) {
      // Index already exists, skip
    }

    try {
      await queryInterface.addIndex('meso_rounds', ['deal_id', 'round'], {
        name: 'idx_meso_rounds_deal_round',
        unique: true,
      });
    } catch (e) {
      // Index already exists, skip
    }

    try {
      await queryInterface.addIndex('meso_rounds', ['selected_option_id'], {
        name: 'idx_meso_rounds_selected_option',
      });
    } catch (e) {
      // Index already exists, skip
    }

    try {
      await queryInterface.addIndex('meso_rounds', ['created_at'], {
        name: 'idx_meso_rounds_created_at',
      });
    } catch (e) {
      // Index already exists, skip
    }

    console.log('✅ Created meso_rounds table with indexes');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('meso_rounds');
    console.log('✅ Dropped meso_rounds table');
  },
};
