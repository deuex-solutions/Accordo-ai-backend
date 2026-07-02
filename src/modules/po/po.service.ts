import { Op } from 'sequelize';
import { CustomError } from '../../utils/custom-error.js';
import repo from './po.repo.js';
import companyRepo from '../company/company.repo.js';
import vendorRepo from '../vendor/vendor.repo.js';
import productRepo from '../product/product.repo.js';
import userRepo from '../user/user.repo.js';
import util from '../common/util.js';
import type { Po } from '../../models/procurement/po.js';
import type { PoData } from './po.repo.js';
import type { Company } from '../../models/auth/company.js';
import type { User } from '../../models/auth/user.js';

export interface LineItem {
  productId: number;
  qty: number;
  price: number;
}

export interface PaginatedPosResponse {
  data: Po[];
  total: number;
  page: number;
  totalPages: number;
}

const pad = (num: number, size: number): string => {
  let str = `${num}`;
  while (str.length < size) str = `0${str}`;
  return str;
};

const generatePoNumber = (
  company: Company | null = null,
  vendor: User | null = null,
  companyVendorPos: Po[]
): string => {
  const prefix = (company?.companyName || '').substring(0, 3).toUpperCase();
  const middle = (vendor?.name || '').substring(0, 3).toUpperCase();
  if (companyVendorPos?.length) {
    const lastPo = companyVendorPos[companyVendorPos.length - 1];
    if (lastPo.poNumber) {
      const parts = lastPo.poNumber.split('/');
      const last = Number.parseInt(parts[parts.length - 1], 10) + 1;
      return `${prefix}/${middle}/${pad(last, 3)}`;
    }
  }
  return `${prefix}/${middle}/${pad(1, 3)}`;
};

export const getPoService = async (poId: number): Promise<Po | null> => {
  try {
    return repo.getPo(poId);
  } catch (error) {
    throw new CustomError(String(error), 400);
  }
};

export const downloadPoService = async (poId: number): Promise<Buffer> => {
  try {
    const po = await repo.getPo(poId);
    if (!po) {
      throw new CustomError('Po not found', 404);
    }
    let lineItems: LineItem[];
    try {
      lineItems = JSON.parse(po.lineItems || '[]');
    } catch (error) {
      throw new CustomError('Invalid lineItems format in PO', 400);
    }
    const products = [];
    if (!Array.isArray(lineItems) || !lineItems.length) {
      throw new CustomError('At least one line item is required', 400);
    }

    for (const item of lineItems) {
      const product = await productRepo.getProduct({ id: item.productId });
      products.push(product);
    }
    // TODO: Implement po.create.ts file for PDF generation
    throw new CustomError('PDF generation not yet implemented', 501);
  } catch (error) {
    throw new CustomError(String(error), 400);
  }
};

export const getAllPoService = async (
  search: string | undefined,
  page: number | string = 1,
  limit: number | string = 10,
  userId: number,
  filters?: string
): Promise<PaginatedPosResponse> => {
  try {
    const parsedPage = Number.parseInt(String(page), 10) || 1;
    const parsedLimit = Number.parseInt(String(limit), 10) || 10;
    const offset = (parsedPage - 1) * parsedLimit;

    const queryOptions: any = {
      limit: parsedLimit,
      offset,
      where: {},
    };

    if (userId) {
      const user = await userRepo.getUser(userId);
      if (user?.companyId) {
        queryOptions.where.companyId = user.companyId;
      }
    }

    if (search) {
      queryOptions.where.poNumber = {
        [Op.like]: `%${search}%`,
      };
    }

    if (filters) {
      try {
        const filterData = JSON.parse(decodeURIComponent(filters));
        queryOptions.where = {
          ...util.filterUtil(filterData),
          ...queryOptions.where,
        };
      } catch (error) {
        throw new CustomError('Invalid filters format', 400);
      }
    }

    const { rows, count } = await repo.getPos(queryOptions);
    return {
      data: rows,
      total: count,
      page: parsedPage,
      totalPages: Math.ceil(count / parsedLimit),
    };
  } catch (error) {
    throw new CustomError(`Service ${error}`, 400);
  }
};

export const createPoService = async (poData: PoData): Promise<Po> => {
  try {
    let lineItems: LineItem[];
    if (typeof poData.lineItems === 'string') {
      try {
        lineItems = JSON.parse(poData.lineItems);
        if (!Array.isArray(lineItems)) {
          throw new CustomError('lineItems must be an array', 400);
        }
      } catch (error) {
        if (error instanceof CustomError) {
          throw error;
        }
        throw new CustomError('Invalid lineItems format', 400);
      }
    } else {
      lineItems = (poData.lineItems as LineItem[]) || [];
    }

    poData.subTotal = 0;
    poData.taxTotal = 0;
    poData.total = 0;

    for (const item of lineItems) {
      if (item.productId && item.qty && item.price) {
        const product = await productRepo.getProduct({ id: item.productId });
        const taxPercentage =
          product?.gstType === 'GST' ? product.gstPercentage : 0;
        const subTotal = item.price * item.qty;
        const taxTotal = (subTotal * (taxPercentage || 0)) / 100;
        const total = subTotal + taxTotal;

        poData.subTotal += subTotal;
        poData.taxTotal += taxTotal;
        poData.total += total;
      } else {
        throw new CustomError('Line item data missing', 400);
      }
    }

    const creator = await vendorRepo.getVendor({ id: poData.addedBy! });
    if (!creator) {
      throw new CustomError('Creator not found', 404);
    }
    poData.companyId = creator.companyId ?? undefined;
    const vendor = await vendorRepo.getVendor({ id: poData.vendorId! });
    const company = poData.companyId ? await companyRepo.getCompany(poData.companyId) : null;

    if (!vendor) {
      throw new CustomError('Vendor not found', 404);
    }
    if (!company) {
      throw new CustomError('Company not found', 404);
    }

    const companyVendorPos = await repo.getAllPo(poData);
    poData.poNumber = generatePoNumber(company, vendor, companyVendorPos);
    poData.status = 'Created';
    poData.lineItems = JSON.stringify(lineItems);

    return repo.createPo(poData);
  } catch (error) {
    throw new CustomError(`Service ${error}`, 400);
  }
};

export const cancelPoService = async (
  poId: number
): Promise<[affectedCount: number]> => {
  try {
    return repo.updatePo(poId, { status: 'Cancelled' });
  } catch (error) {
    throw new CustomError(String(error), 400);
  }
};
