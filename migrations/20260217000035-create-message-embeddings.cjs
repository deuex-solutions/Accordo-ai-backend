'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('message_embeddings', {
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

    try {
      await queryInterface.addIndex('message_embeddings', ['deal_id'], { name: 'idx_message_embeddings_deal_id' });
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('message_embeddings', ['message_id'], { name: 'idx_message_embeddings_message_id' });
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('message_embeddings', ['role'], { name: 'idx_message_embeddings_role' });
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('message_embeddings', ['outcome'], { name: 'idx_message_embeddings_outcome' });
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('message_embeddings', ['content_type'], { name: 'idx_message_embeddings_content_type' });
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('message_embeddings', ['created_at'], { name: 'idx_message_embeddings_created_at' });
    } catch (e) {
      // Index already exists, skip
    }
  },
  async down(queryInterface) {
    await queryInterface.dropTable('message_embeddings');
  },
};
