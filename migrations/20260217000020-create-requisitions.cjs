'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Requisitions', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      projectId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Projects',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      rfqId: {
        type: Sequelize.STRING,
        allowNull: true,
        unique: true,
      },
      subject: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      category: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      deliveryDate: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      negotiationClosureDate: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      typeOfCurrency: {
        type: Sequelize.ENUM('USD', 'INR', 'EUR', 'GBP', 'AUD'),
        allowNull: true,
      },
      totalQuantity: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      totalPrice: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      totalMaxPrice: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      finalPrice: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM(
          'Draft', 'Created', 'Fulfilled', 'Benchmarked', 'InitialQuotation',
          'Closed', 'Awarded', 'Cancelled', 'Expired', 'NegotiationStarted'
        ),
        allowNull: true,
      },
      savingsInPrice: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      createdBy: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      fulfilledAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      fulfilledBy: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      payment_terms: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      net_payment_day: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      pre_payment_percentage: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      post_payment_percentage: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      maxDeliveryDate: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      batna: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      discountedValue: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      maxDiscount: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      approvalStatus: {
        type: Sequelize.ENUM(
          'NOT_SUBMITTED', 'PENDING_L1', 'APPROVED_L1', 'PENDING_L2',
          'APPROVED_L2', 'PENDING_L3', 'APPROVED_L3', 'FULLY_APPROVED', 'REJECTED'
        ),
        allowNull: false,
        defaultValue: 'NOT_SUBMITTED',
      },
      currentApprovalLevel: {
        type: Sequelize.ENUM('L1', 'L2', 'L3'),
        allowNull: true,
        defaultValue: null,
      },
      totalEstimatedAmount: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: true,
        defaultValue: null,
      },
      requiredApprovalLevel: {
        type: Sequelize.ENUM('L1', 'L2', 'L3'),
        allowNull: true,
        defaultValue: null,
      },
      submittedForApprovalAt: {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: null,
      },
      submittedByUserId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: null,
        references: {
          model: 'User',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      archivedAt: {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: null,
      },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('Requisitions');
  },
};
