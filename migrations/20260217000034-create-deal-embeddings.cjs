'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('deal_embeddings', {
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

    try {
      await queryInterface.addIndex('deal_embeddings', ['deal_id'], { name: 'idx_deal_embeddings_deal_id' });
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('deal_embeddings', ['embedding_type'], { name: 'idx_deal_embeddings_type' });
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('deal_embeddings', ['final_status'], { name: 'idx_deal_embeddings_status' });
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('deal_embeddings', ['final_utility'], { name: 'idx_deal_embeddings_utility' });
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('deal_embeddings', ['product_category'], { name: 'idx_deal_embeddings_category' });
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('deal_embeddings', ['created_at'], { name: 'idx_deal_embeddings_created_at' });
    } catch (e) {
      // Index already exists, skip
    }
  },
  async down(queryInterface) {
    await queryInterface.dropTable('deal_embeddings');
  },
};
