'use strict';

async function safeAddConstraint(queryInterface, table, options) {
  try {
    await queryInterface.addConstraint(table, options);
  } catch (e) {
    if (e.message && e.message.includes('already exists')) return;
    throw e;
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    // ── Deferred FK: Approvals.emailLogId → EmailLogs.id ──
    // (Approvals created in migration 3, EmailLogs created in migration 4)
    await safeAddConstraint(queryInterface, 'Approvals', {
      fields: ['emailLogId'],
      type: 'foreign key',
      name: 'fk_approvals_email_log_id',
      references: {
        table: 'EmailLogs',
        field: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeConstraint('Approvals', 'fk_approvals_email_log_id');
  },
};
