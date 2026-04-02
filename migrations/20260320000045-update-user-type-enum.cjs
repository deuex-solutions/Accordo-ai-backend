'use strict';
module.exports = {
  async up(queryInterface) {
    // Add 'super_admin' and 'procurement' to the userType enum
    // and keep existing values ('admin', 'customer', 'vendor')
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_User_userType" ADD VALUE IF NOT EXISTS 'super_admin';
    `);
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_User_userType" ADD VALUE IF NOT EXISTS 'procurement';
    `);
  },
  async down() {
    // PostgreSQL doesn't support removing enum values easily
    // No-op for down migration
  },
};
