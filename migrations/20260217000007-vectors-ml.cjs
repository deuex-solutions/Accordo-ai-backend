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
    // ── negotiation_patterns ──
    await safeCreateTable(queryInterface,'negotiation_patterns', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      embedding: {
        type: Sequelize.ARRAY(Sequelize.FLOAT),
        allowNull: false,
      },
      content_text: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      pattern_type: {
        type: Sequelize.ENUM('successful_negotiation', 'failed_negotiation', 'escalation', 'walkaway', 'quick_acceptance'),
        allowNull: false,
      },
      pattern_name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      scenario: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      avg_utility: {
        type: Sequelize.DECIMAL(10, 4),
        allowNull: true,
      },
      avg_rounds: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
      },
      avg_price_reduction: {
        type: Sequelize.DECIMAL(10, 4),
        allowNull: true,
      },
      success_rate: {
        type: Sequelize.DECIMAL(10, 4),
        allowNull: true,
      },
      sample_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      product_categories: {
        type: Sequelize.ARRAY(Sequelize.STRING),
        allowNull: true,
      },
      price_ranges: {
        type: Sequelize.ARRAY(Sequelize.STRING),
        allowNull: true,
      },
      vendor_types: {
        type: Sequelize.ARRAY(Sequelize.STRING),
        allowNull: true,
      },
      key_factors: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      example_deal_ids: {
        type: Sequelize.ARRAY(Sequelize.UUID),
        allowNull: true,
      },
      metadata: {
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
        defaultValue: Sequelize.NOW,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
    });

    await safeAddIndex(queryInterface,'negotiation_patterns', ['pattern_type'], { name: 'idx_negotiation_patterns_type' });
    await safeAddIndex(queryInterface,'negotiation_patterns', ['scenario'], { name: 'idx_negotiation_patterns_scenario' });
    await safeAddIndex(queryInterface,'negotiation_patterns', ['success_rate'], { name: 'idx_negotiation_patterns_success_rate' });
    await safeAddIndex(queryInterface,'negotiation_patterns', ['is_active'], { name: 'idx_negotiation_patterns_active' });
    await safeAddIndex(queryInterface,'negotiation_patterns', ['created_at'], { name: 'idx_negotiation_patterns_created_at' });

    // ── vector_migration_status ──
    await safeCreateTable(queryInterface,'vector_migration_status', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      migration_type: {
        type: Sequelize.ENUM('messages', 'deals', 'patterns', 'full'),
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('pending', 'in_progress', 'completed', 'failed'),
        allowNull: false,
        defaultValue: 'pending',
      },
      total_records: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      processed_records: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      failed_records: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      current_batch: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      total_batches: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      batch_size: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 100,
      },
      last_processed_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      error_message: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      error_details: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      started_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      completed_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      estimated_time_remaining: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      processing_rate: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
    });

    await safeAddIndex(queryInterface,'vector_migration_status', ['migration_type'], { name: 'idx_vector_migration_type' });
    await safeAddIndex(queryInterface,'vector_migration_status', ['status'], { name: 'idx_vector_migration_status' });
    await safeAddIndex(queryInterface,'vector_migration_status', ['created_at'], { name: 'idx_vector_migration_created_at' });

    // ── ApiUsageLogs ──
    await safeCreateTable(queryInterface,'ApiUsageLogs', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      provider: {
        type: Sequelize.ENUM('openai', 'ollama'),
        allowNull: false,
      },
      model: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      promptTokens: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      completionTokens: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      totalTokens: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      dealId: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
    });

    await safeAddIndex(queryInterface,'ApiUsageLogs', ['provider']);
    await safeAddIndex(queryInterface,'ApiUsageLogs', ['createdAt']);
    await safeAddIndex(queryInterface,'ApiUsageLogs', ['dealId']);
    await safeAddIndex(queryInterface,'ApiUsageLogs', ['userId']);

    // ── Negotiations ──
    await safeCreateTable(queryInterface,'Negotiations', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      rfqId: {
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
        type: Sequelize.ENUM('active', 'completed', 'failed'),
        allowNull: true,
        defaultValue: 'active',
      },
      round: {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: 1,
      },
      score: {
        type: Sequelize.FLOAT,
        allowNull: true,
        defaultValue: 0.0,
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

    // ── NegotiationRounds ──
    await safeCreateTable(queryInterface,'NegotiationRounds', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      negotiationId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'Negotiations',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      roundNumber: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      offerDetails: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      feedback: {
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

    // ── ChatSessions ──
    await safeCreateTable(queryInterface,'ChatSessions', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      negotiationId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'Negotiations',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'User',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      history: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: [],
      },
      context: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: {},
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

    // ── negotiation_training_data ──
    await safeCreateTable(queryInterface,'negotiation_training_data', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
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
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      round: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      suggestions_json: {
        type: Sequelize.JSONB,
        allowNull: false,
      },
      conversation_context: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      config_snapshot: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      llm_model: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      generation_source: {
        type: Sequelize.ENUM('llm', 'fallback'),
        allowNull: false,
        defaultValue: 'llm',
      },
      selected_scenario: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      selected_suggestion: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      deal_outcome: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
    });

    // ── deal_embeddings ──
    await safeCreateTable(queryInterface,'deal_embeddings', {
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
      embedding: {
        type: Sequelize.ARRAY(Sequelize.FLOAT),
        allowNull: false,
      },
      content_text: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      embedding_type: {
        type: Sequelize.ENUM('summary', 'pattern', 'outcome'),
        allowNull: false,
        defaultValue: 'summary',
      },
      deal_title: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      counterparty: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      final_status: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      total_rounds: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      final_utility: {
        type: Sequelize.DECIMAL(10, 4),
        allowNull: true,
      },
      anchor_price: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: true,
      },
      target_price: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: true,
      },
      final_price: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: true,
      },
      initial_terms: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      final_terms: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      product_category: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      negotiation_duration: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      success_metrics: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
    });

    await safeAddIndex(queryInterface,'deal_embeddings', ['deal_id'], { name: 'idx_deal_embeddings_deal_id' });
    await safeAddIndex(queryInterface,'deal_embeddings', ['embedding_type'], { name: 'idx_deal_embeddings_type' });
    await safeAddIndex(queryInterface,'deal_embeddings', ['final_status'], { name: 'idx_deal_embeddings_status' });
    await safeAddIndex(queryInterface,'deal_embeddings', ['final_utility'], { name: 'idx_deal_embeddings_utility' });
    await safeAddIndex(queryInterface,'deal_embeddings', ['product_category'], { name: 'idx_deal_embeddings_category' });
    await safeAddIndex(queryInterface,'deal_embeddings', ['created_at'], { name: 'idx_deal_embeddings_created_at' });

    // ── message_embeddings ──
    await safeCreateTable(queryInterface,'message_embeddings', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      message_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'chatbot_messages',
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
      embedding: {
        type: Sequelize.ARRAY(Sequelize.FLOAT),
        allowNull: false,
      },
      content_text: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      content_type: {
        type: Sequelize.ENUM('message', 'offer_extract', 'decision'),
        allowNull: false,
        defaultValue: 'message',
      },
      role: {
        type: Sequelize.ENUM('VENDOR', 'ACCORDO', 'SYSTEM'),
        allowNull: false,
      },
      round: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      outcome: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      utility_score: {
        type: Sequelize.DECIMAL(10, 4),
        allowNull: true,
      },
      decision_action: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      product_category: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      price_range: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      payment_terms: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
    });

    await safeAddIndex(queryInterface,'message_embeddings', ['deal_id'], { name: 'idx_message_embeddings_deal_id' });
    await safeAddIndex(queryInterface,'message_embeddings', ['message_id'], { name: 'idx_message_embeddings_message_id' });
    await safeAddIndex(queryInterface,'message_embeddings', ['role'], { name: 'idx_message_embeddings_role' });
    await safeAddIndex(queryInterface,'message_embeddings', ['outcome'], { name: 'idx_message_embeddings_outcome' });
    await safeAddIndex(queryInterface,'message_embeddings', ['content_type'], { name: 'idx_message_embeddings_content_type' });
    await safeAddIndex(queryInterface,'message_embeddings', ['created_at'], { name: 'idx_message_embeddings_created_at' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('message_embeddings');
    await queryInterface.dropTable('deal_embeddings');
    await queryInterface.dropTable('negotiation_training_data');
    await queryInterface.dropTable('ChatSessions');
    await queryInterface.dropTable('NegotiationRounds');
    await queryInterface.dropTable('Negotiations');
    await queryInterface.dropTable('ApiUsageLogs');
    await queryInterface.dropTable('vector_migration_status');
    await queryInterface.dropTable('negotiation_patterns');
  },
};
