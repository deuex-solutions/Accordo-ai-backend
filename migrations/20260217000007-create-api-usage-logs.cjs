'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ApiUsageLogs', {
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

    try {
      await queryInterface.addIndex('ApiUsageLogs', ['provider']);
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('ApiUsageLogs', ['createdAt']);
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('ApiUsageLogs', ['dealId']);
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('ApiUsageLogs', ['userId']);
    } catch (e) {
      // Index already exists, skip
    }
  },
  async down(queryInterface) {
    await queryInterface.dropTable('ApiUsageLogs');
  },
};
