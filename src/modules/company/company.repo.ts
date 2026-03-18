import { QueryTypes } from 'sequelize';
import models, { sequelize } from '../../models/index.js';
import type { Company } from '../../models/company.js';
import type { User } from '../../models/user.js';
import type { Transaction, FindOptions } from 'sequelize';

/**
 * Company repository for database operations
 * Provides type-safe CRUD operations for Company entity
 */
interface CompanyQueryOptions extends FindOptions<Company> {
  where?: Record<string, unknown>;
  limit?: number;
  offset?: number;
}

interface CompanyRepository {
  getCompanyByUser: (userId: number) => Promise<Company | null>;
  createCompany: (companyData: Partial<Company>, transaction?: Transaction | null) => Promise<Company>;
  getAllCompanies: (queryOptions: CompanyQueryOptions) => Promise<{ rows: Company[]; count: number }>;
  getCompany: (companyId: number) => Promise<Company | null>;
  updateCompany: (companyId: number, companyData: Partial<Company>, transaction?: Transaction | null) => Promise<[affectedCount: number]>;
  deleteCompany: (companyId: number) => Promise<number>;
  getAddresses: (userId: number) => Promise<{
    id: string;
    name: string;
    address: string;
    type: 'company' | 'project';
    isDefault: boolean;
  }[]>;
}

const repo: CompanyRepository = {
  getCompanyByUser: async (userId: number): Promise<Company | null> => {
    return models.Company.findOne({ where: { userId } as any });
  },

  createCompany: async (companyData: Partial<Company> = {}, transaction: Transaction | null = null): Promise<Company> => {
    return models.Company.create(companyData, { transaction });
  },

  getAllCompanies: async (queryOptions: CompanyQueryOptions): Promise<{ rows: Company[]; count: number }> => {
    return models.Company.findAndCountAll(queryOptions);
  },

  getCompany: async (companyId: number): Promise<Company | null> => {
    const company = await models.Company.findByPk(companyId, {
      include: [
        {
          model: models.User,
          as: 'Users',
        },
        {
          model: models.VendorCompany,
          as: 'VendorCompanies',
          required: false,
          include: [
            {
              model: models.User,
              as: 'Vendor',
              where: { userType: 'vendor' },
              required: false,
            },
          ],
        },
        {
          model: models.Address,
          as: 'Addresses',
          required: false,
        },
      ],
    });

    if (!company) {
      return null;
    }

    // Manually fetch vendor users for this company
    const vendors = await models.User.findAll({
      where: {
        companyId: companyId,
        userType: 'vendor',
      },
    });

    // Get plain object and manually add Vendor array
    const companyData = company.get({ plain: true }) as any;
    companyData.Vendor = vendors.map(v => v.get({ plain: true }));

    // Return the enhanced plain object cast as Company
    return companyData as Company;
  },

  updateCompany: async (
    companyId: number,
    companyData: Partial<Company>,
    transaction: Transaction | null = null
  ): Promise<[affectedCount: number]> => {
    return models.Company.update(companyData, { where: { id: companyId }, transaction });
  },

  deleteCompany: async (companyId: number): Promise<number> => {
    return models.Company.destroy({ where: { id: companyId } });
  },

  /**
   * Get delivery addresses from companies and projects
   * Returns a combined list of addresses from the user's company and associated projects
   */
  getAddresses: async (userId: number): Promise<{
    id: string;
    name: string;
    address: string;
    type: 'company' | 'project';
    isDefault: boolean;
  }[]> => {
    const user = await models.User.findByPk(userId);
    const isAdmin = user?.userType === 'super_admin';

    // Build company filter
    const companyFilter = (!isAdmin && user?.companyId) ? `AND c.id = ${user.companyId}` : '';
    const projectFilter = (!isAdmin && user?.companyId) ? `AND p."companyId" = ${user.companyId}` : '';

    // Get company addresses
    const companyQuery = `
      SELECT
        'company-' || c.id as id,
        COALESCE(c."companyName", 'Company Address') as name,
        c."fullAddress" as address,
        'company' as type,
        true as "isDefault"
      FROM "Companies" c
      WHERE c."fullAddress" IS NOT NULL
      AND c."fullAddress" != ''
      ${companyFilter}
    `;

    // Get project addresses
    const projectQuery = `
      SELECT
        'project-' || p.id as id,
        COALESCE(p."projectName", 'Project Address') as name,
        p."projectAddress" as address,
        'project' as type,
        false as "isDefault"
      FROM "Projects" p
      WHERE p."projectAddress" IS NOT NULL
      AND p."projectAddress" != ''
      ${projectFilter}
    `;

    const [companyAddresses, projectAddresses] = await Promise.all([
      sequelize.query(companyQuery, { type: QueryTypes.SELECT }),
      sequelize.query(projectQuery, { type: QueryTypes.SELECT }),
    ]);

    // Combine and return unique addresses
    const addresses = [...companyAddresses, ...projectAddresses] as {
      id: string;
      name: string;
      address: string;
      type: 'company' | 'project';
      isDefault: boolean;
    }[];

    return addresses;
  },
};

export default repo;
