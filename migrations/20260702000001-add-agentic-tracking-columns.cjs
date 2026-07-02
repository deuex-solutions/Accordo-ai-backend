"use strict";

async function safeAddColumn(queryInterface, table, column, definition) {
  try {
    const desc = await queryInterface.describeTable(table);
    if (desc[column]) return;
    await queryInterface.addColumn(table, column, definition);
  } catch (e) {
    // Ignore if column already exists (e.g. from partial runs)
    if (e.message && e.message.includes("already exists")) return;
    throw e;
  }
}

async function safeRemoveColumn(queryInterface, table, column) {
  try {
    const desc = await queryInterface.describeTable(table);
    if (!desc[column]) return;
    await queryInterface.removeColumn(table, column);
  } catch (e) {
    // Ignore if column doesn't exist
    throw e;
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    // ── chatbot_deals ──
    await safeAddColumn(queryInterface, "chatbot_deals", "target_effective_cost", {
      type: Sequelize.DECIMAL(15, 2),
      allowNull: true,
    });
    await safeAddColumn(queryInterface, "chatbot_deals", "max_effective_cost", {
      type: Sequelize.DECIMAL(15, 2),
      allowNull: true,
    });
    await safeAddColumn(queryInterface, "chatbot_deals", "cost_of_capital", {
      type: Sequelize.DECIMAL(5, 4),
      allowNull: false,
      defaultValue: 0.1000, // 10%
    });
    await safeAddColumn(queryInterface, "chatbot_deals", "meso_options_sent", {
      type: Sequelize.JSONB,
      allowNull: true,
    });
    await safeAddColumn(queryInterface, "chatbot_deals", "vendor_term_pref", {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await safeAddColumn(queryInterface, "chatbot_deals", "effective_cost_trajectory", {
      type: Sequelize.JSONB,
      allowNull: true,
    });

    // ── chatbot_messages ──
    await safeAddColumn(queryInterface, "chatbot_messages", "message_type", {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await safeAddColumn(queryInterface, "chatbot_messages", "classification_route", {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await safeAddColumn(queryInterface, "chatbot_messages", "classification_confidence", {
      type: Sequelize.DECIMAL(5, 4),
      allowNull: true,
    });
    await safeAddColumn(queryInterface, "chatbot_messages", "effective_cost", {
      type: Sequelize.DECIMAL(15, 2),
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    // ── chatbot_messages ──
    await safeRemoveColumn(queryInterface, "chatbot_messages", "message_type");
    await safeRemoveColumn(queryInterface, "chatbot_messages", "classification_route");
    await safeRemoveColumn(queryInterface, "chatbot_messages", "classification_confidence");
    await safeRemoveColumn(queryInterface, "chatbot_messages", "effective_cost");

    // ── chatbot_deals ──
    await safeRemoveColumn(queryInterface, "chatbot_deals", "target_effective_cost");
    await safeRemoveColumn(queryInterface, "chatbot_deals", "max_effective_cost");
    await safeRemoveColumn(queryInterface, "chatbot_deals", "cost_of_capital");
    await safeRemoveColumn(queryInterface, "chatbot_deals", "meso_options_sent");
    await safeRemoveColumn(queryInterface, "chatbot_deals", "vendor_term_pref");
    await safeRemoveColumn(queryInterface, "chatbot_deals", "effective_cost_trajectory");
  },
};
