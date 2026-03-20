'use strict';

/**
 * Migration: Create Vendor Negotiation Profiles Table
 *
 * Stores persistent vendor negotiation style tracking across deals
 * for Pactum-style behavioral learning.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('vendor_negotiation_profiles', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      vendor_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        unique: true,
        references: {
          model: 'User',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      total_deals: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Total number of deals analyzed for this vendor',
      },
      accepted_deals: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Number of deals that ended in acceptance',
      },
      walked_away_deals: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Number of deals that ended in walk-away',
      },
      escalated_deals: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Number of deals that were escalated',
      },
      avg_concession_rate: {
        type: Sequelize.DECIMAL(10, 4),
        allowNull: true,
        comment: 'Average price concession rate per round',
      },
      avg_rounds_to_close: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
        comment: 'Average number of rounds to close a deal',
      },
      avg_final_utility: {
        type: Sequelize.DECIMAL(10, 4),
        allowNull: true,
        comment: 'Average final utility score achieved',
      },
      avg_price_reduction: {
        type: Sequelize.DECIMAL(10, 4),
        allowNull: true,
        comment: 'Average price reduction percentage achieved',
      },
      preferred_terms: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'Preferred negotiation terms (payment, delivery, etc.)',
      },
      negotiation_style: {
        type: Sequelize.ENUM('aggressive', 'collaborative', 'passive', 'unknown'),
        allowNull: false,
        defaultValue: 'unknown',
        comment: 'Detected negotiation style',
      },
      style_confidence: {
        type: Sequelize.DECIMAL(10, 4),
        allowNull: true,
        comment: 'Confidence in style detection (0-1)',
      },
      success_rate: {
        type: Sequelize.DECIMAL(10, 4),
        allowNull: true,
        comment: 'Overall negotiation success rate (0-1)',
      },
      behavior_embedding: {
        type: Sequelize.ARRAY(Sequelize.FLOAT),
        allowNull: true,
        comment: 'Vector embedding of vendor behavior for similarity search',
      },
      response_time_stats: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'Statistics on vendor response times (avg, min, max)',
      },
      concession_patterns: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'Patterns in how vendor makes concessions',
      },
      meso_preferences: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'Inferred preferences from MESO selections',
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'Additional metadata for analysis',
      },
      last_deal_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'Timestamp of last deal with this vendor',
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
      await queryInterface.addIndex('vendor_negotiation_profiles', ['vendor_id'], {
        name: 'idx_vendor_negotiation_profiles_vendor_id',
        unique: true,
      });
    } catch (e) {
      // Index already exists, skip
    }

    try {
      await queryInterface.addIndex('vendor_negotiation_profiles', ['negotiation_style'], {
        name: 'idx_vendor_negotiation_profiles_style',
      });
    } catch (e) {
      // Index already exists, skip
    }

    try {
      await queryInterface.addIndex('vendor_negotiation_profiles', ['success_rate'], {
        name: 'idx_vendor_negotiation_profiles_success_rate',
      });
    } catch (e) {
      // Index already exists, skip
    }

    try {
      await queryInterface.addIndex('vendor_negotiation_profiles', ['total_deals'], {
        name: 'idx_vendor_negotiation_profiles_total_deals',
      });
    } catch (e) {
      // Index already exists, skip
    }

    try {
      await queryInterface.addIndex('vendor_negotiation_profiles', ['last_deal_at'], {
        name: 'idx_vendor_negotiation_profiles_last_deal',
      });
    } catch (e) {
      // Index already exists, skip
    }

    console.log('✅ Created vendor_negotiation_profiles table with indexes');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('vendor_negotiation_profiles');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_vendor_negotiation_profiles_negotiation_style";');
    console.log('✅ Dropped vendor_negotiation_profiles table');
  },
};
