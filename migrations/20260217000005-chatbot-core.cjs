'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    // ── chatbot_templates ──
    await queryInterface.createTable('chatbot_templates', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      config_json: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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

    // ── Preferences ──
    await queryInterface.createTable('Preferences', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      entityId: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      entityType: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      context: {
        type: Sequelize.STRING,
        allowNull: true,
        defaultValue: 'global',
      },
      weights: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      constraints: {
        type: Sequelize.JSONB,
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

    // ── chatbot_template_parameters ──
    await queryInterface.createTable('chatbot_template_parameters', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      template_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'chatbot_templates',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      parameter_key: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      parameter_type: {
        type: Sequelize.ENUM('number', 'string', 'boolean', 'date'),
        allowNull: false,
        defaultValue: 'number',
      },
      weight: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: true,
      },
      min_value: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: true,
      },
      max_value: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: true,
      },
      default_value: {
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

    // ── chatbot_deals ──
    await queryInterface.createTable('chatbot_deals', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      title: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      counterparty: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM('NEGOTIATING', 'ACCEPTED', 'WALKED_AWAY', 'ESCALATED'),
        allowNull: false,
        defaultValue: 'NEGOTIATING',
      },
      round: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      mode: {
        type: Sequelize.ENUM('INSIGHTS', 'CONVERSATION'),
        allowNull: false,
        defaultValue: 'CONVERSATION',
      },
      latest_offer_json: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      latest_vendor_offer: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      latest_decision_action: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      latest_utility: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
      },
      convo_state_json: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      negotiation_config_json: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      template_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'chatbot_templates',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      requisition_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Requisitions',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      contract_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Contracts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'User',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      vendor_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'User',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      archived_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      deleted_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      last_accessed: {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: Sequelize.NOW,
      },
      last_message_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      view_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
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

    // ── chatbot_messages ──
    await queryInterface.createTable('chatbot_messages', {
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
      role: {
        type: Sequelize.ENUM('VENDOR', 'ACCORDO', 'SYSTEM'),
        allowNull: false,
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      extracted_offer: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      engine_decision: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      decision_action: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      utility_score: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
      },
      counter_offer: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      explainability_json: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      round: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
    });

    // ── meso_rounds ──
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

    await queryInterface.addIndex('meso_rounds', ['deal_id'], {
      name: 'idx_meso_rounds_deal_id',
    });
    await queryInterface.addIndex('meso_rounds', ['round'], {
      name: 'idx_meso_rounds_round',
    });
    await queryInterface.addIndex('meso_rounds', ['deal_id', 'round'], {
      name: 'idx_meso_rounds_deal_round',
      unique: true,
    });
    await queryInterface.addIndex('meso_rounds', ['selected_option_id'], {
      name: 'idx_meso_rounds_selected_option',
    });
    await queryInterface.addIndex('meso_rounds', ['created_at'], {
      name: 'idx_meso_rounds_created_at',
    });

    // ── vendor_negotiation_profiles ──
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

    await queryInterface.addIndex('vendor_negotiation_profiles', ['vendor_id'], {
      name: 'idx_vendor_negotiation_profiles_vendor_id',
      unique: true,
    });
    await queryInterface.addIndex('vendor_negotiation_profiles', ['negotiation_style'], {
      name: 'idx_vendor_negotiation_profiles_style',
    });
    await queryInterface.addIndex('vendor_negotiation_profiles', ['success_rate'], {
      name: 'idx_vendor_negotiation_profiles_success_rate',
    });
    await queryInterface.addIndex('vendor_negotiation_profiles', ['total_deals'], {
      name: 'idx_vendor_negotiation_profiles_total_deals',
    });
    await queryInterface.addIndex('vendor_negotiation_profiles', ['last_deal_at'], {
      name: 'idx_vendor_negotiation_profiles_last_deal',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('vendor_negotiation_profiles');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_vendor_negotiation_profiles_negotiation_style";');
    await queryInterface.dropTable('meso_rounds');
    await queryInterface.dropTable('chatbot_messages');
    await queryInterface.dropTable('chatbot_deals');
    await queryInterface.dropTable('chatbot_template_parameters');
    await queryInterface.dropTable('Preferences');
    await queryInterface.dropTable('chatbot_templates');
  },
};
