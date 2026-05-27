import bcrypt from 'bcrypt';
import crypto from 'crypto';
import repo from './vendor.repo.js';
import userRepo from '../user/user.repo.js';
import authRepo from '../auth/auth.repo.js';
import { CustomError } from '../../utils/custom-error.js';
import util from '../common/util.js';
import {
  validateCreateVendor,
  validateCreateVendorWithCompany,
  validateStep1,
  validateStep2,
  validateStep3,
  validateStep4,
} from './vendor.validator.js';
import type { User } from '../../models/user.js';
import type { VendorCompany } from '../../models/vendor-company.js';
import type { Company } from '../../models/company.js';
import type { Address } from '../../models/address.js';
import models, { sequelize } from '../../models/index.js';
import logger from "../../config/logger.js";

interface VendorData {
  email: string;
  name?: string;
  phone?: string;
  companyId?: number;
  roleId?: number;
  status?: string;
  [key: string]: unknown;
}

/**
 * Address data for vendor company creation
 */
interface AddressData {
  label: string;
  address: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  isDefault?: boolean;
}

/**
 * Full vendor + company creation data
 */
export interface VendorWithCompanyData {
  // Vendor user info
  name: string;
  email: string;
  phone?: string;

  // Company info
  companyName: string;
  establishmentDate?: string;
  nature?: 'Domestic' | 'Interational';
  type?: string;
  numberOfEmployees?: string;
  annualTurnover?: string;
  industryType?: string;
  companyLogo?: string;

  // Addresses
  addresses?: AddressData[];

  // Financial & Banking
  typeOfCurrency?: string;
  bankName?: string;
  beneficiaryName?: string;
  accountNumber?: string;
  iBanNumber?: string;
  swiftCode?: string;
  bankAccountType?: string;
  ifscCode?: string;

  // Compliance documents
  gstNumber?: string;
  panNumber?: string;
  msmeNumber?: string;
  ciNumber?: string;

  // Point of contact
  pocName?: string;
  pocDesignation?: string;
  pocEmail?: string;
  pocPhone?: string;
  pocWebsite?: string;

  // Escalation contact
  escalationName?: string;
  escalationDesignation?: string;
  escalationEmail?: string;
  escalationPhone?: string;
}

/**
 * Response from vendor + company creation
 */
export interface VendorWithCompanyResponse {
  vendor: User;
  company: Company;
  vendorCompany: VendorCompany;
  addresses: Address[];
}

interface FilterData {
  moduleName: string;
  filterBy: string;
  controlType: "inputText" | "rangeNumeric" | "rangeDate" | "checkbox";
  value: string | number[] | string[];
}

interface VendorServiceResponse {
  data: unknown[];
  total: number;
  page: number;
  totalPages: number;
  totalVendors: number;
  activeVendors: number;
  inactiveVendors: number;
}

/**
 * Parse range filter value to ensure it's a valid [min, max] tuple
 */
const parseRange = (value: unknown): [number, number] | null => {
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isInteger(value[0]) &&
    Number.isInteger(value[1])
  ) {
    return value as [number, number];
  }
  return null;
};

/**
 * Create a new vendor
 */
export const createVendorService = async (
  vendorData: VendorData,
  userId: number
): Promise<[User, VendorCompany]> => {
  const { error } = validateCreateVendor(vendorData);
  if (error) {
    throw new CustomError(error.details[0].message, 400);
  }

  const existing = await authRepo.findUserByEmail(vendorData.email);
  if (existing) {
    throw new CustomError(`Email ${vendorData.email} already exists`, 409);
  }

  const user = await userRepo.getUser(userId);
  if (!user) {
    throw new CustomError('User not found', 404);
  }

  const newVendor = await repo.createVendor(vendorData);
  const vendorCompany = await repo.createVendorCompany({
    vendorId: newVendor.id,
    companyId: user.companyId,
  });

  return [newVendor, vendorCompany];
};

/**
 * Get all vendors with filtering and pagination
 * Super Admin users (userType === 'super_admin') see all vendors across all companies
 */
export const getVendorsService = async (
  userId: number,
  search?: string,
  page: string | number = 1,
  limit: string | number = 10,
  filters?: string
): Promise<VendorServiceResponse> => {
  const parsedPage = Number.parseInt(String(page), 10) || 1;
  const parsedLimit = Number.parseInt(String(limit), 10) || 10;
  const offset = (parsedPage - 1) * parsedLimit;

  const queryOptions: {
    limit: number;
    offset: number;
    search?: string;
    filters?: Record<string, unknown>;
    totalContractsRange?: [number, number];
    completedContractsRange?: [number, number];
    vendorStatusList?: string[];
  } = {
    limit: parsedLimit,
    offset,
    search,
  };

  if (filters) {
    try {
      const filterData = JSON.parse(decodeURIComponent(filters)) as FilterData[];
      const transformedFilters = util.filterUtil(filterData);
      if (Object.keys(transformedFilters).length) {
        queryOptions.filters = transformedFilters;
      }

      const totalContractsFilter = filterData.find((item) => item.filterBy === 'totalContracts');
      const completedContractsFilter = filterData.find(
        (item) => item.filterBy === 'completedContracts'
      );
      const vendorStatusFilter = filterData.find((item) => item.filterBy === 'vendorStatus');

      const totalRange = parseRange(totalContractsFilter?.value);
      if (totalRange) {
        queryOptions.totalContractsRange = totalRange;
      }

      const completedRange = parseRange(completedContractsFilter?.value);
      if (completedRange) {
        queryOptions.completedContractsRange = completedRange;
      }

      if (Array.isArray(vendorStatusFilter?.value) && vendorStatusFilter.value.length) {
        const cleaned = vendorStatusFilter.value.filter((val): val is string => typeof val === 'string');
        if (cleaned.length) {
          queryOptions.vendorStatusList = cleaned;
        }
      }
    } catch (error) {
      throw new CustomError('Invalid filters format', 400);
    }
  }

  const user = await userRepo.getUserProfile(userId);

  // Super Admin users see all vendors across all companies
  const isAdmin = user?.userType === 'super_admin';

  if (isAdmin) {
    // For admin users, get all vendors from all companies
    const { response, vendorCount } = await repo.getAllVendorsForAdmin(queryOptions);
    const { rows, count } = response;

    const total = count;
    const totalPages = parsedLimit ? Math.ceil(total / parsedLimit) : 1;

    return {
      data: rows,
      total,
      page: parsedPage,
      totalPages,
      totalVendors: vendorCount.totalVendors,
      activeVendors: vendorCount.activeVendors,
      inactiveVendors: vendorCount.totalInactiveVendors,
    };
  }

  // Non-admin users only see their company's vendors
  if (!user?.companyId) {
    throw new CustomError('Unable to determine company for user', 400);
  }

  const { response, vendorCount } = await repo.getAllVendorCompany(user.companyId, queryOptions);
  const { rows, count } = response;

  const total = count;
  const totalPages = parsedLimit ? Math.ceil(total / parsedLimit) : 1;

  return {
    data: rows,
    total,
    page: parsedPage,
    totalPages,
    totalVendors: vendorCount.totalVendors,
    activeVendors: vendorCount.activeVendors,
    inactiveVendors: vendorCount.totalInactiveVendors,
  };
};

/**
 * Get a specific vendor by ID
 */
export const getVendorService = async (vendorData: { id: number }): Promise<User | null> => {
  try {
    return await repo.getVendor(vendorData);
  } catch (error) {
    throw new CustomError((error as Error).message || String(error), 400);
  }
};

/**
 * Update a vendor's data
 */
export const updateVendorService = async (
  vendorId: string | number,
  vendorData: Partial<VendorData>
): Promise<[number]> => {
  try {
    const id = typeof vendorId === 'string' ? Number.parseInt(vendorId, 10) : vendorId;

    // If email is being updated, check if it's already in use by another vendor
    if (vendorData.email) {
      const existing = await authRepo.findUserByEmail(vendorData.email);
      if (existing && (existing as any).id !== id) {
        throw new CustomError(`Email ${vendorData.email} already exists`, 409);
      }
    }

    return await repo.updateVendor(id, vendorData);
  } catch (error) {
    // If it's already a CustomError, re-throw it with original status code
    if (error instanceof CustomError) {
      throw error;
    }
    throw new CustomError((error as Error).message || String(error), 400);
  }
};

/**
 * Delete a vendor by ID
 */
export const deleteVendorService = async (vendorId: string | number): Promise<number> => {
  try {
    const id = typeof vendorId === 'string' ? Number.parseInt(vendorId, 10) : vendorId;
    return await repo.deleteVendor({ id });
  } catch (error) {
    throw new CustomError((error as Error).message || String(error), 400);
  }
};

/**
 * Generate a random temporary password
 */
const generateTempPassword = (): string => {
  return crypto.randomBytes(8).toString('hex') + 'A1!';
};

/**
 * Create a vendor with company in a single atomic transaction
 * This handles the complete vendor onboarding flow:
 * 1. Create vendor's company (the company the vendor works for)
 * 2. Create vendor user account
 * 3. Create VendorCompany association (links vendor to the customer company)
 * 4. Create addresses for the vendor's company
 */
export const createVendorWithCompanyService = async (
  data: VendorWithCompanyData,
  creatorUserId: number
): Promise<VendorWithCompanyResponse> => {
  // Validate input
  const { error } = validateCreateVendorWithCompany(data);
  if (error) {
    throw new CustomError(error.details[0].message, 400);
  }

  // Check if email already exists
  const existingUser = await authRepo.findUserByEmail(data.email);
  if (existingUser) {
    throw new CustomError(`Email ${data.email} already exists`, 409);
  }

  // Get the creator user to determine their company
  const creatorUser = await userRepo.getUser(creatorUserId);
  if (!creatorUser) {
    throw new CustomError('Creator user not found', 404);
  }
  if (!creatorUser.companyId) {
    throw new CustomError('Creator user has no associated company', 400);
  }

  // Start transaction
  const transaction = await sequelize.transaction();

  try {
    // 1. Create the vendor's company (the company the vendor belongs to)
    const company = await models.Company.create(
      {
        companyName: data.companyName,
        establishmentDate: data.establishmentDate ? new Date(data.establishmentDate) : null,
        nature: data.nature || null,
        type: data.type || null,
        numberOfEmployees: data.numberOfEmployees as any || null,
        annualTurnover: data.annualTurnover || null,
        industryType: data.industryType as any || null,
        companyLogo: data.companyLogo || null,
        typeOfCurrency: data.typeOfCurrency as any || null,
        bankName: data.bankName || null,
        beneficiaryName: data.beneficiaryName || null,
        accountNumber: data.accountNumber || null,
        iBanNumber: data.iBanNumber || null,
        swiftCode: data.swiftCode || null,
        bankAccountType: data.bankAccountType || null,
        ifscCode: data.ifscCode || null,
        gstNumber: data.gstNumber || null,
        panNumber: data.panNumber || null,
        msmeNumber: data.msmeNumber || null,
        ciNumber: data.ciNumber || null,
        pocName: data.pocName || null,
        pocDesignation: data.pocDesignation || null,
        pocEmail: data.pocEmail || null,
        pocPhone: data.pocPhone || null,
        pocWebsite: data.pocWebsite || null,
        escalationName: data.escalationName || null,
        escalationDesignation: data.escalationDesignation || null,
        escalationEmail: data.escalationEmail || null,
        escalationPhone: data.escalationPhone || null,
        createdBy: creatorUserId,
      },
      { transaction }
    );

    // 2. Create vendor user account with temporary password
    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    const vendor = await models.User.create(
      {
        name: data.name,
        email: data.email,
        phone: data.phone || null,
        password: hashedPassword,
        userType: 'vendor',
        companyId: company.id, // Vendor belongs to their own company
        roleId: 6, // Vendor role
        status: 'active',
        approvalLevel: 'NONE', // Explicitly set to avoid NOT NULL constraint error
      } as any,
      { transaction }
    );

    // 3. Create VendorCompany association (links vendor to the customer's company)
    const vendorCompany = await models.VendorCompany.create(
      {
        vendorId: vendor.id,
        companyId: creatorUser.companyId, // Link to customer's company
      },
      { transaction }
    );

    // 4. Create addresses for the vendor's company
    let addresses: Address[] = [];
    if (data.addresses && data.addresses.length > 0) {
      const addressRecords = data.addresses.map((addr, index) => ({
        companyId: company.id,
        label: addr.label || `Address ${index + 1}`,
        address: addr.address,
        city: addr.city || null,
        state: addr.state || null,
        country: addr.country || null,
        postalCode: addr.postalCode || null,
        isDefault: addr.isDefault ?? (index === 0), // First address is default if not specified
      }));

      addresses = await models.Address.bulkCreate(addressRecords, { transaction });
    }

    // Commit transaction
    await transaction.commit();

    // TODO: Send welcome email to vendor with temporary password
    // This can be done asynchronously after commit
    // await sendVendorWelcomeEmail(vendor.email, vendor.name, tempPassword);

    return {
      vendor: vendor as User,
      company: company as Company,
      vendorCompany: vendorCompany as VendorCompany,
      addresses: addresses as Address[],
    };
  } catch (error) {
    // Rollback transaction on any error
    await transaction.rollback();

    if (error instanceof CustomError) {
      throw error;
    }
    throw new CustomError(
      `Failed to create vendor: ${(error as Error).message || String(error)}`,
      500
    );
  }
};

/**
 * Step 1: Create vendor user + company with basic info
 * POST /vendor-management/create-vendor?step=1
 */
export interface Step1Data {
  name: string;
  email: string;
  phone?: string;
  companyName: string;
  establishmentDate?: string;
  nature?: string;
  type?: string;
  numberOfEmployees?: string;
  annualTurnover?: string;
  industryType?: string;
  companyLogo?: string;
}

export interface Step1Response {
  vendor: {
    id: number;
    name: string;
    email: string;
    phone: string | null;
  };
  company: {
    id: number;
    companyName: string;
  };
  vendorCompany: {
    id: number;
    vendorId: number;
    companyId: number;
  };
}

export const createVendorStep1Service = async (
  data: Step1Data,
  creatorUserId: number
): Promise<Step1Response> => {
  // Validate input
  const { error } = validateStep1(data);
  if (error) {
    throw new CustomError(error.details[0].message, 400);
  }

  // Check if email already exists - if so, return existing vendor data to allow continuing
  const existingUser = await authRepo.findUserByEmail(data.email) as any;
  if (existingUser) {
    // If vendor already exists, return their data so frontend can continue to step 2
    // This handles the case where step 1 succeeded but navigation failed
    if (existingUser.userType === 'vendor' && existingUser.companyId) {
      // Find the VendorCompany association
      const vendorCompany = await models.VendorCompany.findOne({
        where: { vendorId: existingUser.id },
      });

      return {
        vendor: {
          id: existingUser.id,
          name: existingUser.name || '',
          email: existingUser.email || '',
          phone: existingUser.phone || null,
        },
        company: {
          id: existingUser.companyId,
          companyName: data.companyName, // Use the submitted company name
        },
        vendorCompany: {
          id: vendorCompany?.id || 0,
          vendorId: existingUser.id,
          companyId: vendorCompany?.companyId || 0,
        },
      };
    }
    // If email exists but is not a vendor, throw error
    throw new CustomError(`Email ${data.email} is already in use by another user type`, 409);
  }

  // Get the creator user to determine their company
  const creatorUser = await userRepo.getUser(creatorUserId);
  if (!creatorUser) {
    throw new CustomError('Creator user not found', 404);
  }
  if (!creatorUser.companyId) {
    throw new CustomError('Creator user has no associated company', 400);
  }

  // Start transaction
  const transaction = await sequelize.transaction();

  try {
    // 1. Create the vendor's company
    const company = await models.Company.create(
      {
        companyName: data.companyName,
        establishmentDate: data.establishmentDate ? new Date(data.establishmentDate) : null,
        nature: data.nature as any || null,
        type: data.type || null,
        numberOfEmployees: data.numberOfEmployees as any || null,
        annualTurnover: data.annualTurnover || null,
        industryType: data.industryType as any || null,
        companyLogo: data.companyLogo || null,
        createdBy: creatorUserId,
      },
      { transaction }
    );

    // 2. Create vendor user account with temporary password
    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    const vendor = await models.User.create(
      {
        name: data.name,
        email: data.email,
        phone: data.phone || null,
        password: hashedPassword,
        userType: 'vendor',
        companyId: company.id,
        roleId: 6,
        status: 'active',
        approvalLevel: 'NONE', // Explicitly set to avoid NOT NULL constraint error
      } as any,
      { transaction }
    );

    // 3. Create VendorCompany association (links vendor to the customer's company)
    const vendorCompany = await models.VendorCompany.create(
      {
        vendorId: vendor.id,
        companyId: creatorUser.companyId,
      },
      { transaction }
    );

    // Commit transaction
    await transaction.commit();

    return {
      vendor: {
        id: vendor.id,
        name: vendor.name || '',
        email: vendor.email || '',
        phone: vendor.phone || null,
      },
      company: {
        id: company.id,
        companyName: company.companyName || '',
      },
      vendorCompany: {
        id: vendorCompany.id,
        vendorId: vendorCompany.vendorId || 0,
        companyId: vendorCompany.companyId || 0,
      },
    };
  } catch (error: any) {
    await transaction.rollback();

    logger.error('Step 1 Error:', {
      name: error.name,
      message: error.message,
      errors: error.errors,
      stack: error.stack,
    });

    if (error instanceof CustomError) {
      throw error;
    }

    // Handle Sequelize validation errors with more detail
    if (error.name === 'SequelizeValidationError' || error.name === 'SequelizeUniqueConstraintError') {
      const messages = error.errors?.map((e: any) => `${e.path}: ${e.message}`).join(', ') || error.message;
      throw new CustomError(`Validation failed: ${messages}`, 400);
    }

    // Handle Sequelize database errors
    if (error.name === 'SequelizeDatabaseError') {
      throw new CustomError(`Database error: ${error.message}`, 500);
    }

    throw new CustomError(
      `Failed to create vendor (Step 1): ${error.name}: ${(error as Error).message || String(error)}`,
      500
    );
  }
};

/**
 * Step 2: Update company with address/location data
 * PUT /vendor-management/create-vendor/:companyId?step=2
 */
export interface Step2Data {
  address: string;
  city?: string;
  state?: string;
  country?: string;
  zipCode?: string;
}

export const updateVendorStep2Service = async (
  companyId: number,
  data: Step2Data
): Promise<{ success: boolean; company: { id: number }; address: { id: number } }> => {
  // Validate input
  const { error } = validateStep2(data);
  if (error) {
    throw new CustomError(error.details[0].message, 400);
  }

  // Find the company
  const company = await models.Company.findByPk(companyId);
  if (!company) {
    throw new CustomError('Company not found', 404);
  }

  try {
    // Check if address already exists for this company
    const existingAddress = await models.Address.findOne({
      where: { companyId, isDefault: true },
    });

    let address;
    if (existingAddress) {
      // Update existing address
      await existingAddress.update({
        address: data.address,
        city: data.city || null,
        state: data.state || null,
        country: data.country || null,
        postalCode: data.zipCode || null,
      });
      address = existingAddress;
    } else {
      // Create new address
      address = await models.Address.create({
        companyId,
        label: 'Primary Address',
        address: data.address,
        city: data.city || null,
        state: data.state || null,
        country: data.country || null,
        postalCode: data.zipCode || null,
        isDefault: true,
      });
    }

    return {
      success: true,
      company: { id: company.id },
      address: { id: address.id },
    };
  } catch (error: any) {
    logger.error('Step 2 Error:', {
      name: error.name,
      message: error.message,
      errors: error.errors,
      stack: error.stack,
    });

    if (error instanceof CustomError) {
      throw error;
    }

    // Handle Sequelize validation errors with more detail
    if (error.name === 'SequelizeValidationError' || error.name === 'SequelizeUniqueConstraintError') {
      const messages = error.errors?.map((e: any) => `${e.path}: ${e.message}`).join(', ') || error.message;
      throw new CustomError(`Validation failed: ${messages}`, 400);
    }

    // Handle Sequelize database errors
    if (error.name === 'SequelizeDatabaseError') {
      throw new CustomError(`Database error: ${error.message}`, 500);
    }

    throw new CustomError(
      `Failed to update location (Step 2): ${error.message || String(error)}`,
      500
    );
  }
};

/**
 * Step 3: Update company with financial/banking data
 * PUT /vendor-management/create-vendor/:companyId?step=3
 */
export interface Step3Data {
  typeOfCurrency?: string;
  bankName?: string;
  beneficiaryName?: string;
  accountNumber?: string;
  iBanNumber?: string;
  swiftCode?: string;
  bankAccountType?: string;
  ifscCode?: string;
  fullAddress?: string;
  gstNumber?: string;
  panNumber?: string;
  msmeNumber?: string;
  ciNumber?: string;
}

export const updateVendorStep3Service = async (
  companyId: number,
  data: Step3Data
): Promise<{ success: boolean; company: { id: number } }> => {
  // Validate input
  const { error } = validateStep3(data);
  if (error) {
    throw new CustomError(error.details[0].message, 400);
  }

  // Find the company
  const company = await models.Company.findByPk(companyId);
  if (!company) {
    throw new CustomError('Company not found', 404);
  }

  // Update company with financial/banking data
  await company.update({
    typeOfCurrency: data.typeOfCurrency as any || null,
    bankName: data.bankName || null,
    beneficiaryName: data.beneficiaryName || null,
    accountNumber: data.accountNumber || null,
    iBanNumber: data.iBanNumber || null,
    swiftCode: data.swiftCode || null,
    bankAccountType: data.bankAccountType || null,
    ifscCode: data.ifscCode || null,
    fullAddress: data.fullAddress || null,
    gstNumber: data.gstNumber || null,
    panNumber: data.panNumber || null,
    msmeNumber: data.msmeNumber || null,
    ciNumber: data.ciNumber || null,
  });

  return {
    success: true,
    company: { id: company.id },
  };
};

/**
 * Step 4: Update company with contact information
 * PUT /vendor-management/create-vendor/:companyId?step=4
 */
export interface Step4Data {
  pocName?: string;
  pocDesignation?: string;
  pocEmail?: string;
  pocPhone?: string;
  pocWebsite?: string;
  escalationName?: string;
  escalationDesignation?: string;
  escalationEmail?: string;
  escalationPhone?: string;
}

export const updateVendorStep4Service = async (
  companyId: number,
  data: Step4Data
): Promise<{ success: boolean; company: { id: number } }> => {
  // Validate input
  const { error } = validateStep4(data);
  if (error) {
    throw new CustomError(error.details[0].message, 400);
  }

  // Find the company
  const company = await models.Company.findByPk(companyId);
  if (!company) {
    throw new CustomError('Company not found', 404);
  }

  // Update company with contact data
  await company.update({
    pocName: data.pocName || null,
    pocDesignation: data.pocDesignation || null,
    pocEmail: data.pocEmail || null,
    pocPhone: data.pocPhone || null,
    pocWebsite: data.pocWebsite || null,
    escalationName: data.escalationName || null,
    escalationDesignation: data.escalationDesignation || null,
    escalationEmail: data.escalationEmail || null,
    escalationPhone: data.escalationPhone || null,
  });

  return {
    success: true,
    company: { id: company.id },
  };
};

/**
 * Step 5: Get vendor data for review
 * GET /vendor-management/create-vendor/:companyId?step=5
 */
export const getVendorForReviewService = async (
  companyId: number
): Promise<any> => {
  try {
    // Find the company with vendor association
    // Note: Company model has 'Users' (plural) and 'Vendor' (singular) associations
    const company = await models.Company.findByPk(companyId, {
      include: [
        {
          model: models.User,
          as: 'Users',  // Using 'Users' alias from Company model
          where: { userType: 'vendor' },
          required: false,
        },
        {
          model: models.Address,
          as: 'Addresses',
          required: false,
        },
      ],
    });

    if (!company) {
      throw new CustomError('Company not found', 404);
    }

    // Transform the response to match frontend expectations
    // Frontend expects 'User' array, but we're getting 'Users'
    const companyData = company.toJSON() as any;
    if (companyData.Users) {
      companyData.User = companyData.Users;
      delete companyData.Users;
    }

    return companyData;
  } catch (error: any) {
    logger.error('Step 5 (Review) Error:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
    });

    if (error instanceof CustomError) {
      throw error;
    }

    throw new CustomError(
      `Failed to get vendor for review: ${error.message || String(error)}`,
      500
    );
  }
};
