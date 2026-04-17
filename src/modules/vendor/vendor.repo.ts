import { QueryTypes } from 'sequelize';
import models, { sequelize } from '../../models/index.js';
import type { User } from '../../models/user.js';
import type { VendorCompany } from '../../models/vendor-company.js';

interface VendorData {
  email: string;
  name?: string;
  phone?: string;
  companyId?: number;
  roleId?: number;
  status?: string;
  [key: string]: unknown;
}

interface VendorCompanyData {
  vendorId: number;
  companyId: number;
}

interface QueryOptions {
  limit?: number;
  offset?: number;
  search?: string;
  filters?: Record<string, unknown>;
  totalContractsRange?: [number, number];
  completedContractsRange?: [number, number];
  vendorStatusList?: string[];
}

interface VendorWithCounts {
  id: number;
  vendorId: number | null;
  Vendor: {
    id: number;
    name: string;
    email: string;
    phone: string;
    companyId?: number;
    roleId?: number;
    status: string;
    contractCount: number;
    approvedContractCount: number;
    Company: {
      id: number;
      companyName: string;
    } | null;
  };
}

interface VendorCountResult {
  vendorId: number;
  contractCount: string;
  approvedContractCount: string;
}

interface VendorStatsResult {
  totalVendors: string;
  activeVendors: string;
  totalInactiveVendors: string;
}

interface VendorCountStats {
  totalVendors: number;
  activeVendors: number;
  totalInactiveVendors: number;
}

interface GetAllVendorCompanyResult {
  response: {
    rows: VendorWithCounts[];
    count: number;
  };
  vendorCount: VendorCountStats;
}

/**
 * Apply filters to vendor rows
 */
const applyFilters = (rows: VendorWithCounts[], queryOptions: QueryOptions): VendorWithCounts[] => {
  let filtered = rows.slice();

  if (queryOptions.search) {
    const term = queryOptions.search.toLowerCase();
    // Multi-field OR search: Vendor ID, Name, Email
    filtered = filtered.filter((row) =>
      String(row.Vendor?.id || '').toLowerCase().includes(term) ||
      row.Vendor?.name?.toLowerCase().includes(term) ||
      row.Vendor?.email?.toLowerCase().includes(term)
    );
  }

  if (queryOptions.vendorStatusList?.length) {
    const statuses = queryOptions.vendorStatusList.map((s) => s.toLowerCase());
    filtered = filtered.filter((row) =>
      statuses.includes((row.Vendor?.status || '').toLowerCase())
    );
  }

  if (queryOptions.totalContractsRange) {
    const [min, max] = queryOptions.totalContractsRange;
    filtered = filtered.filter((row) => {
      const count = row.Vendor?.contractCount ?? 0;
      return count >= min && count <= max;
    });
  }

  if (queryOptions.completedContractsRange) {
    const [min, max] = queryOptions.completedContractsRange;
    filtered = filtered.filter((row) => {
      const count = row.Vendor?.approvedContractCount ?? 0;
      return count >= min && count <= max;
    });
  }

  return filtered;
};

/**
 * Paginate vendor rows
 */
const paginateRows = (rows: VendorWithCounts[], limit?: number, offset?: number): VendorWithCounts[] => {
  if (!limit || !Number.isInteger(limit) || limit <= 0) {
    return rows;
  }
  const start = Number.isInteger(offset) && offset && offset > 0 ? offset : 0;
  return rows.slice(start, start + limit);
};

const repo = {
  /**
   * Create a new vendor user
   */
  createVendor: async (vendorData: VendorData): Promise<User> => {
    return models.User.create({ ...vendorData, userType: 'vendor' } as any);
  },

  /**
   * Get all vendors for admin users (across all companies)
   */
  getAllVendorsForAdmin: async (queryOptions: QueryOptions = {}): Promise<GetAllVendorCompanyResult> => {
    const include = {
      model: models.Vendor,
      as: 'Vendor',
      attributes: ['id', 'name', 'email', 'phone', 'companyId', 'roleId', 'status'],
      include: [
        {
          model: models.Company,
          as: 'Company',
          attributes: ['id', 'companyName', 'fullAddress', 'pocPhone', 'pocEmail'],
        },
      ],
    };

    // Get ALL vendor companies (no companyId filter)
    const vendorCompanies = await models.VendorCompany.findAll({
      include,
    });

    const countQuery = `
      SELECT
        vc.id,
        vc."vendorId",
        COUNT(DISTINCT c.id) AS "contractCount",
        COUNT(DISTINCT CASE WHEN c.status = 'Accepted' THEN c.id END) AS "approvedContractCount"
      FROM "VendorCompanies" vc
      LEFT JOIN "User" v ON v.id = vc."vendorId"
      LEFT JOIN "Contracts" c ON c."vendorId" = v.id
      GROUP BY vc.id, vc."vendorId";
    `;

    const vendorCounts = await sequelize.query(countQuery, {
      type: QueryTypes.SELECT,
    }) as VendorCountResult[];

    const countMap: Record<number, { contractCount: number; approvedContractCount: number }> =
      vendorCounts.reduce((acc, curr) => {
        acc[curr.vendorId] = {
          contractCount: Number.parseInt(curr.contractCount, 10) || 0,
          approvedContractCount: Number.parseInt(curr.approvedContractCount, 10) || 0,
        };
        return acc;
      }, {} as Record<number, { contractCount: number; approvedContractCount: number }>);

    const rows: VendorWithCounts[] = vendorCompanies.map((item) => {
      const vendor = (item as any).Vendor;
      return {
        id: item.id,
        vendorId: item.vendorId,
        Vendor: {
          id: vendor?.id ?? 0,
          name: vendor?.name ?? '',
          email: vendor?.email ?? '',
          phone: vendor?.phone ?? '',
          companyId: vendor?.companyId,
          roleId: vendor?.roleId,
          status: vendor?.status ?? '',
          contractCount: countMap[vendor?.id]?.contractCount ?? 0,
          approvedContractCount: countMap[vendor?.id]?.approvedContractCount ?? 0,
          Company: vendor?.Company
            ? {
                id: vendor.Company.id,
                companyName: vendor.Company.companyName,
              }
            : null,
        },
      };
    });

    const filteredRows = applyFilters(rows, queryOptions);
    const total = filteredRows.length;
    const paginatedRows = paginateRows(filteredRows, queryOptions.limit, queryOptions.offset);

    // Get overall stats (all vendors across all companies)
    const statsQuery = `
      SELECT
        COALESCE(COUNT(*), 0) AS "totalVendors",
        COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS "activeVendors",
        COALESCE(SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END), 0) AS "totalInactiveVendors"
      FROM "User"
      WHERE "userType" = 'vendor';
    `;

    const [stats] = await sequelize.query(statsQuery, {
      type: QueryTypes.SELECT,
    }) as VendorStatsResult[];

    return {
      response: {
        rows: paginatedRows,
        count: total,
      },
      vendorCount: {
        totalVendors: Number.parseInt(stats?.totalVendors, 10) || 0,
        activeVendors: Number.parseInt(stats?.activeVendors, 10) || 0,
        totalInactiveVendors: Number.parseInt(stats?.totalInactiveVendors, 10) || 0,
      },
    };
  },

  /**
   * Create a vendor-company association
   */
  createVendorCompany: async (vendorData: VendorCompanyData): Promise<VendorCompany> => {
    return models.VendorCompany.create(vendorData);
  },

  /**
   * Get all vendors for a company with filtering and pagination
   */
  getAllVendorCompany: async (companyId: number, queryOptions: QueryOptions = {}): Promise<GetAllVendorCompanyResult> => {
    const include = {
      model: models.Vendor,
      as: 'Vendor',
      attributes: ['id', 'name', 'email', 'phone', 'companyId', 'roleId', 'status'],
      include: [
        {
          model: models.Company,
          as: 'Company',
          attributes: ['id', 'companyName', 'fullAddress', 'pocPhone', 'pocEmail'],
        },
      ],
    };

    const vendorCompanies = await models.VendorCompany.findAll({
      where: { companyId },
      include,
    });

    const countQuery = `
      SELECT
        vc.id,
        vc."vendorId",
        COUNT(DISTINCT c.id) AS "contractCount",
        COUNT(DISTINCT CASE WHEN c.status = 'Accepted' THEN c.id END) AS "approvedContractCount"
      FROM "VendorCompanies" vc
      LEFT JOIN "User" v ON v.id = vc."vendorId"
      LEFT JOIN "Contracts" c ON c."vendorId" = v.id
      WHERE vc."companyId" = :companyId
      GROUP BY vc.id, vc."vendorId";
    `;

    const vendorCounts = await sequelize.query(countQuery, {
      replacements: { companyId },
      type: QueryTypes.SELECT,
    }) as VendorCountResult[];

    const countMap: Record<number, { contractCount: number; approvedContractCount: number }> =
      vendorCounts.reduce((acc, curr) => {
        acc[curr.vendorId] = {
          contractCount: Number.parseInt(curr.contractCount, 10) || 0,
          approvedContractCount: Number.parseInt(curr.approvedContractCount, 10) || 0,
        };
        return acc;
      }, {} as Record<number, { contractCount: number; approvedContractCount: number }>);

    const rows: VendorWithCounts[] = vendorCompanies.map((item) => {
      const vendor = (item as any).Vendor;
      return {
        id: item.id,
        vendorId: item.vendorId,
        Vendor: {
          id: vendor?.id ?? 0,
          name: vendor?.name ?? '',
          email: vendor?.email ?? '',
          phone: vendor?.phone ?? '',
          companyId: vendor?.companyId,
          roleId: vendor?.roleId,
          status: vendor?.status ?? '',
          contractCount: countMap[vendor?.id]?.contractCount ?? 0,
          approvedContractCount: countMap[vendor?.id]?.approvedContractCount ?? 0,
          Company: vendor?.Company
            ? {
                id: vendor.Company.id,
                companyName: vendor.Company.companyName,
              }
            : null,
        },
      };
    });

    const filteredRows = applyFilters(rows, queryOptions);
    const total = filteredRows.length;
    const paginatedRows = paginateRows(filteredRows, queryOptions.limit, queryOptions.offset);

    const statsQuery = `
      SELECT
        COALESCE(COUNT(*), 0) AS "totalVendors",
        COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS "activeVendors",
        COALESCE(SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END), 0) AS "totalInactiveVendors"
      FROM "User"
      WHERE "companyId" = :companyId AND "userType" = 'vendor';
    `;

    const [stats] = await sequelize.query(statsQuery, {
      replacements: { companyId },
      type: QueryTypes.SELECT,
    }) as VendorStatsResult[];

    return {
      response: {
        rows: paginatedRows,
        count: total,
      },
      vendorCount: {
        totalVendors: Number.parseInt(stats?.totalVendors, 10) || 0,
        activeVendors: Number.parseInt(stats?.activeVendors, 10) || 0,
        totalInactiveVendors: Number.parseInt(stats?.totalInactiveVendors, 10) || 0,
      },
    };
  },

  /**
   * Get all vendors for a company
   */
  getVendors: async (companyId: number): Promise<User[]> => {
    return models.User.findAll({
      where: { companyId, userType: 'vendor' },
      include: {
        model: models.Company,
        as: 'Company',
      },
    });
  },

  /**
   * Get a specific vendor by ID
   */
  getVendor: async ({ id }: { id: number }): Promise<User | null> => {
    return models.User.findByPk(id, {
      include: {
        model: models.Company,
        as: 'Company',
      },
    });
  },

  /**
   * Delete a vendor by ID
   */
  deleteVendor: async ({ id }: { id: number }): Promise<number> => {
    return models.User.destroy({ where: { id } });
  },

  /**
   * Update a vendor's data
   */
  updateVendor: async (vendorId: number, vendorData: Partial<VendorData>): Promise<[number]> => {
    return models.User.update(vendorData, { where: { id: vendorId } });
  },
};

export default repo;
