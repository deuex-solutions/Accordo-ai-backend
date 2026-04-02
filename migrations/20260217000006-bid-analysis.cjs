'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    // ── vendor_bids ──
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

    await queryInterface.addIndex('vendor_bids', ['requisition_id']);
    await queryInterface.addIndex('vendor_bids', ['vendor_id']);
    await queryInterface.addIndex('vendor_bids', ['bid_status']);
    await queryInterface.addIndex('vendor_bids', ['final_price']);
    await queryInterface.addIndex('vendor_bids', ['deal_id']);
    await queryInterface.addIndex('vendor_bids', ['contract_id']);

    // ── bid_comparisons ──
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

    await queryInterface.addIndex('bid_comparisons', ['requisition_id']);
    await queryInterface.addIndex('bid_comparisons', ['triggered_by']);
    await queryInterface.addIndex('bid_comparisons', ['generated_at']);
    await queryInterface.addIndex('bid_comparisons', ['email_status']);

    // ── bid_action_histories ──
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

    await queryInterface.addIndex('bid_action_histories', ['requisition_id']);
    await queryInterface.addIndex('bid_action_histories', ['bid_id']);
    await queryInterface.addIndex('bid_action_histories', ['deal_id']);
    await queryInterface.addIndex('bid_action_histories', ['user_id']);
    await queryInterface.addIndex('bid_action_histories', ['action']);
    await queryInterface.addIndex('bid_action_histories', ['created_at']);

    // ── vendor_selections ──
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

    await queryInterface.addIndex('vendor_selections', ['requisition_id']);
    await queryInterface.addIndex('vendor_selections', ['selected_vendor_id']);
    await queryInterface.addIndex('vendor_selections', ['selected_by_user_id']);
    await queryInterface.addIndex('vendor_selections', ['selected_at']);

    // ── vendor_notifications ──
    await queryInterface.createTable('vendor_notifications', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      selection_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'vendor_selections',
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
      bid_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'vendor_bids',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      notification_type: {
        type: Sequelize.ENUM('SELECTION_WON', 'SELECTION_LOST'),
        allowNull: false,
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
      email_status: {
        type: Sequelize.ENUM('PENDING', 'SENT', 'FAILED'),
        allowNull: false,
        defaultValue: 'PENDING',
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

    await queryInterface.addIndex('vendor_notifications', ['selection_id']);
    await queryInterface.addIndex('vendor_notifications', ['vendor_id']);
    await queryInterface.addIndex('vendor_notifications', ['notification_type']);
    await queryInterface.addIndex('vendor_notifications', ['email_status']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('vendor_notifications');
    await queryInterface.dropTable('vendor_selections');
    await queryInterface.dropTable('bid_action_histories');
    await queryInterface.dropTable('bid_comparisons');
    await queryInterface.dropTable('vendor_bids');
  },
};
