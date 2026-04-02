'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    // ── Companies ──
    await queryInterface.createTable('Companies', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      companyName: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      companyLogo: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      apiKey: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      apiSecret: {
        type: Sequelize.STRING(150),
        allowNull: true,
      },
      establishmentDate: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      nature: {
        type: Sequelize.ENUM('Domestic', 'Interational', 'International'),
        allowNull: true,
      },
      type: {
        type: Sequelize.STRING(150),
        allowNull: true,
      },
      numberOfEmployees: {
        type: Sequelize.ENUM('0-10', '10-100', '100-1000', '1000+'),
        allowNull: true,
      },
      annualTurnover: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      industryType: {
        type: Sequelize.ENUM(
          'Construction',
          'Healthcare',
          'Transportation',
          'Information Technology',
          'Oil and Gas',
          'Defence',
          'Renewable Energy',
          'Telecommunication',
          'Agriculture',
          'Other'
        ),
        allowNull: true,
      },
      customIndustryType: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      gstNumber: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      gstFileUrl: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      panNumber: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      panFileUrl: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      msmeNumber: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      msmeFileUrl: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      ciNumber: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      ciFileUrl: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      pocName: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      pocDesignation: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      pocEmail: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      pocPhone: {
        type: Sequelize.STRING(20),
        allowNull: true,
      },
      pocWebsite: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      escalationName: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      escalationDesignation: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      escalationEmail: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      escalationPhone: {
        type: Sequelize.STRING(20),
        allowNull: true,
      },
      typeOfCurrency: {
        type: Sequelize.ENUM('INR', 'USD', 'EUR'),
        allowNull: true,
      },
      bankName: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      beneficiaryName: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      accountNumber: {
        type: Sequelize.STRING(20),
        allowNull: true,
      },
      iBanNumber: {
        type: Sequelize.STRING(34),
        allowNull: true,
      },
      swiftCode: {
        type: Sequelize.STRING(11),
        allowNull: true,
      },
      bankAccountType: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      cancelledCheque: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      cancelledChequeURL: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      ifscCode: {
        type: Sequelize.STRING(11),
        allowNull: true,
      },
      taxInPercentage: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      fullAddress: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      createdBy: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    // ── Modules ──
    await queryInterface.createTable('Modules', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      name: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      isArchived: {
        type: Sequelize.BOOLEAN,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    // ── Roles ── (createdBy/updatedBy FKs added after User table)
    await queryInterface.createTable('Roles', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      name: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      createdBy: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      companyId: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      updatedBy: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      isArchived: {
        type: Sequelize.BOOLEAN,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });

    // ── User ──
    await queryInterface.createTable('User', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      name: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      profilePic: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      email: {
        type: Sequelize.STRING,
        allowNull: true,
        unique: true,
      },
      phone: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      password: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      userType: {
        type: Sequelize.ENUM('super_admin', 'admin', 'procurement', 'vendor'),
        allowNull: true,
        defaultValue: 'procurement',
      },
      companyId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Companies',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      roleId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Roles',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      status: {
        type: Sequelize.STRING,
        allowNull: true,
        defaultValue: 'active',
      },
      approvalLevel: {
        type: Sequelize.ENUM('NONE', 'L1', 'L2', 'L3'),
        allowNull: false,
        defaultValue: 'NONE',
      },
      approvalLimit: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: true,
        defaultValue: null,
      },
      isProtected: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    // ── Deferred FKs: Roles.createdBy / updatedBy → User.id ──
    await queryInterface.addConstraint('Roles', {
      fields: ['createdBy'],
      type: 'foreign key',
      name: 'fk_roles_created_by_user',
      references: {
        table: 'User',
        field: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    await queryInterface.addConstraint('Roles', {
      fields: ['updatedBy'],
      type: 'foreign key',
      name: 'fk_roles_updated_by_user',
      references: {
        table: 'User',
        field: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    // ── authTokens ──
    await queryInterface.createTable('authTokens', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
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
      token: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      email: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    // ── Otps ──
    await queryInterface.createTable('Otps', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
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
      otp: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      for: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    // ── RolePermissions ──
    await queryInterface.createTable('RolePermissions', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      roleId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Roles',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      moduleId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Modules',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      permission: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    // ── UserActions ──
    await queryInterface.createTable('UserActions', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'User',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      moduleName: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      action: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    // ── Addresses ──
    await queryInterface.createTable('Addresses', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      companyId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Companies',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      label: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      address: {
        type: Sequelize.STRING(500),
        allowNull: false,
      },
      city: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      state: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      country: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      postalCode: {
        type: Sequelize.STRING(20),
        allowNull: true,
      },
      isDefault: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('Addresses', ['companyId']);
    await queryInterface.addIndex('Addresses', ['companyId', 'isDefault']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('Addresses');
    await queryInterface.dropTable('UserActions');
    await queryInterface.dropTable('RolePermissions');
    await queryInterface.dropTable('Otps');
    await queryInterface.dropTable('authTokens');
    await queryInterface.removeConstraint('Roles', 'fk_roles_created_by_user');
    await queryInterface.removeConstraint('Roles', 'fk_roles_updated_by_user');
    await queryInterface.dropTable('User');
    await queryInterface.dropTable('Roles');
    await queryInterface.dropTable('Modules');
    await queryInterface.dropTable('Companies');
  },
};
