'use strict';

async function safeRenameColumn(queryInterface, tableName, oldColumnName, newColumnName) {
  try {
    await queryInterface.renameColumn(tableName, oldColumnName, newColumnName);
  } catch (e) {
    const msg = e.message || '';
    const origMsg = e.original?.message || '';
    const parentMsg = e.parent?.message || '';
    const combined = `${msg} ${origMsg} ${parentMsg}`;
    if (
      combined.includes('does not exist') ||
      combined.includes('Unknown column') ||
      combined.includes('column') && combined.includes('already exists')
    ) {
      return;
    }
    throw e;
  }
}

module.exports = {
  async up(queryInterface) {
    await safeRenameColumn(queryInterface, 'Requisitions', 'totalPrice', 'minTotalPrice');
    await safeRenameColumn(queryInterface, 'Requisitions', 'totalMaxPrice', 'maxTotalPrice');
    await safeRenameColumn(queryInterface, 'RequisitionProducts', 'targetPrice', 'minUnitPrice');
    await safeRenameColumn(queryInterface, 'RequisitionProducts', 'maximum_price', 'maxUnitPrice');
  },

  async down(queryInterface) {
    await safeRenameColumn(queryInterface, 'RequisitionProducts', 'maxUnitPrice', 'maximum_price');
    await safeRenameColumn(queryInterface, 'RequisitionProducts', 'minUnitPrice', 'targetPrice');
    await safeRenameColumn(queryInterface, 'Requisitions', 'maxTotalPrice', 'totalMaxPrice');
    await safeRenameColumn(queryInterface, 'Requisitions', 'minTotalPrice', 'totalPrice');
  },
};
