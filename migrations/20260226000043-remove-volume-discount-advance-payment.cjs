'use strict';

/**
 * Migration: Remove volumeDiscountExpectation and advancePaymentLimit from deal configs
 *
 * Cleans up existing negotiation_config_json JSONB data in chatbot_deals table:
 * 1. Removes volumeDiscountExpectation from wizardConfig.priceQuantity
 * 2. Removes advancePaymentLimit from wizardConfig.paymentTerms
 * 3. Removes these keys from wizardConfig.parameterWeights
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Step 1: Remove volumeDiscountExpectation from wizardConfig.priceQuantity
    await queryInterface.sequelize.query(`
      UPDATE chatbot_deals
      SET negotiation_config_json = jsonb_set(
        negotiation_config_json,
        '{wizardConfig,priceQuantity}',
        (negotiation_config_json #> '{wizardConfig,priceQuantity}') - 'volumeDiscountExpectation'
      )
      WHERE negotiation_config_json IS NOT NULL
        AND negotiation_config_json #> '{wizardConfig,priceQuantity}' ? 'volumeDiscountExpectation';
    `);

    // Step 2: Remove advancePaymentLimit from wizardConfig.paymentTerms
    await queryInterface.sequelize.query(`
      UPDATE chatbot_deals
      SET negotiation_config_json = jsonb_set(
        negotiation_config_json,
        '{wizardConfig,paymentTerms}',
        (negotiation_config_json #> '{wizardConfig,paymentTerms}') - 'advancePaymentLimit'
      )
      WHERE negotiation_config_json IS NOT NULL
        AND negotiation_config_json #> '{wizardConfig,paymentTerms}' ? 'advancePaymentLimit';
    `);

    // Step 3: Remove from wizardConfig.parameterWeights
    await queryInterface.sequelize.query(`
      UPDATE chatbot_deals
      SET negotiation_config_json = jsonb_set(
        negotiation_config_json,
        '{wizardConfig,parameterWeights}',
        (negotiation_config_json #> '{wizardConfig,parameterWeights}') - 'volumeDiscountExpectation' - 'advancePaymentLimit'
      )
      WHERE negotiation_config_json IS NOT NULL
        AND negotiation_config_json #> '{wizardConfig,parameterWeights}' IS NOT NULL;
    `);

    console.log('[Migration] Removed volumeDiscountExpectation and advancePaymentLimit from existing deal configs');
  },

  async down() {
    // Cannot reliably restore removed values - this is a one-way cleanup
    console.log('[Migration] Down: No action - cannot restore removed volumeDiscountExpectation/advancePaymentLimit values');
  },
};
