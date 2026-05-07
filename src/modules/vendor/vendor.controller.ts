import type { Request, Response, NextFunction } from 'express';
import {
  createVendorService,
  createVendorWithCompanyService,
  createVendorStep1Service,
  updateVendorStep2Service,
  updateVendorStep3Service,
  updateVendorStep4Service,
  getVendorForReviewService,
  getVendorService,
  getVendorsService,
  updateVendorService,
  deleteVendorService,
} from './vendor.service.js';
import type { VendorWithCompanyData, Step1Data, Step2Data, Step3Data, Step4Data } from './vendor.service.js';
import { CustomError } from '../../utils/custom-error.js';
import { getParam, getNumericParam } from '../../types/index.js';

/**
 * Create a new vendor
 */
export const createVendor = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const data = await createVendorService(req.body, req.context.userId);
    res.status(201).json({ message: 'Vendor created successfully', data });
  } catch (error) {
    next(error);
  }
};

/**
 * Get a specific vendor by ID
 */
export const getVendor = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const vendorId = getNumericParam(req.params.vendorId);
    const data = await getVendorService({ id: vendorId });
    res.status(200).json({ message: 'Vendor', data });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all vendors with filtering and pagination
 */
export const getAllVendors = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { search, page = 1, limit = 10, filters } = req.query;
    const data = await getVendorsService(
      req.context.userId,
      search as string | undefined,
      page as string | number,
      limit as string | number,
      filters as string | undefined
    );
    res.status(200).json({ message: 'Vendors', ...data });
  } catch (error) {
    next(error);
  }
};

/**
 * Update a vendor's data
 */
export const updateVendor = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const data = await updateVendorService(getParam(req.params.vendorId), req.body);
    res.status(200).json({ message: 'Vendor updated successfully', data });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a vendor by ID
 */
export const deleteVendor = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const data = await deleteVendorService(getParam(req.params.vendorId));
    res.status(200).json({ message: 'Vendor deleted successfully', data });
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new vendor with company in a single transaction
 * POST /api/vendor/company/create
 *
 * This unified endpoint handles the complete vendor onboarding:
 * - Creates the vendor's company
 * - Creates the vendor user account
 * - Links vendor to the customer company (VendorCompany)
 * - Creates company addresses
 */
export const createVendorWithCompany = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const vendorData: VendorWithCompanyData = req.body;
    const creatorUserId = req.context.userId;

    const data = await createVendorWithCompanyService(vendorData, creatorUserId);

    res.status(201).json({
      message: 'Vendor and company created successfully',
      data: {
        vendor: {
          id: data.vendor.id,
          name: data.vendor.name,
          email: data.vendor.email,
          phone: data.vendor.phone,
        },
        company: {
          id: data.company.id,
          companyName: data.company.companyName,
        },
        vendorCompany: {
          id: data.vendorCompany.id,
          vendorId: data.vendorCompany.vendorId,
          companyId: data.vendorCompany.companyId,
        },
        addresses: data.addresses.map((addr) => ({
          id: addr.id,
          label: addr.label,
          address: addr.address,
          city: addr.city,
          state: addr.state,
          country: addr.country,
          postalCode: addr.postalCode,
          isDefault: addr.isDefault,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Step-based vendor creation - Step 1 (POST)
 * POST /api/vendor-management/create-vendor?step=1
 * Creates vendor user + company with basic info
 */
export const createVendorStep = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const step = req.query.step as string;

    if (step !== '1') {
      throw new CustomError('POST only allowed for step=1. Use PUT for other steps.', 400);
    }

    const stepData: Step1Data = req.body;
    const creatorUserId = req.context.userId;

    const data = await createVendorStep1Service(stepData, creatorUserId);

    res.status(201).json({
      message: 'Vendor and company created successfully (Step 1)',
      step: 1,
      data,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Step-based vendor creation - Steps 2, 3, 4 (PUT)
 * PUT /api/vendor-management/create-vendor/:companyId?step=2|3|4
 * Updates company with additional data
 */
export const updateVendorStep = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const companyId = getNumericParam(req.params.companyId);
    const step = req.query.step as string;

    if (Number.isNaN(companyId)) {
      throw new CustomError('Invalid company ID', 400);
    }

    let data;
    let message;

    switch (step) {
      case '2':
        data = await updateVendorStep2Service(companyId, req.body as Step2Data);
        message = 'Location details updated (Step 2)';
        break;

      case '3':
        data = await updateVendorStep3Service(companyId, req.body as Step3Data);
        message = 'Financial and banking info updated (Step 3)';
        break;

      case '4':
        data = await updateVendorStep4Service(companyId, req.body as Step4Data);
        message = 'Contact information updated (Step 4)';
        break;

      default:
        throw new CustomError('Invalid step. Use step=2, 3, or 4 for PUT requests.', 400);
    }

    res.status(200).json({
      message,
      step: Number.parseInt(step, 10),
      data,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Step-based vendor creation - Step 5 (GET)
 * GET /api/vendor-management/create-vendor/:companyId?step=5
 * Returns vendor data for review
 */
export const getVendorForReview = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const companyId = getNumericParam(req.params.companyId);
    const step = req.query.step as string;

    if (Number.isNaN(companyId)) {
      throw new CustomError('Invalid company ID', 400);
    }

    if (step !== '5') {
      throw new CustomError('GET request is only for step=5 (review)', 400);
    }

    const data = await getVendorForReviewService(companyId);

    res.status(200).json({
      message: 'Vendor data for review (Step 5)',
      step: 5,
      data,
    });
  } catch (error) {
    next(error);
  }
};
