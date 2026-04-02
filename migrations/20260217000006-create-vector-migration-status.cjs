'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('vector_migration_status', {
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

    try {
      await queryInterface.addIndex('vector_migration_status', ['migration_type'], { name: 'idx_vector_migration_type' });
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('vector_migration_status', ['status'], { name: 'idx_vector_migration_status' });
    } catch (e) {
      // Index already exists, skip
    }
    try {
      await queryInterface.addIndex('vector_migration_status', ['created_at'], { name: 'idx_vector_migration_created_at' });
    } catch (e) {
      // Index already exists, skip
    }
  },
  async down(queryInterface) {
    await queryInterface.dropTable('vector_migration_status');
  },
};
