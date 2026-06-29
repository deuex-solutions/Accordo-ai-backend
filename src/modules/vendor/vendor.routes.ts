import { Router, type Request, type Response, type NextFunction } from 'express';
import Joi from 'joi';
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
  type VendorWithCompanyData,
  type Step1Data,
  type Step2Data,
  type Step3Data,
  type Step4Data,
} from './vendor.service.js';
import {
  authMiddleware,
  checkPermission,
} from '../../middlewares/auth.middleware.js';
import { CustomError } from '../../utils/custom-error.js';
import { getParam, getNumericParam } from '../../utils/types.js';

const vendorRouter = Router();
const moduleId = 5;

// ============================================================================
// Validators & Schemas
// ============================================================================

const options: Joi.ValidationOptions = { errors: { wrap: { label: '' } } };

export const validateCreateVendor = (userData: unknown) => {
  return Joi.object({
    email: Joi.string().email().required().messages({ 'string.email': 'Email format is invalid', 'any.required': 'Email is required' }),
  }).unknown(true).validate(userData, options);
};

const addressSchema = Joi.object({
  label: Joi.string().max(100).required(),
  address: Joi.string().max(500).required(),
  city: Joi.string().max(100).allow('', null),
  state: Joi.string().max(100).allow('', null),
  country: Joi.string().max(100).allow('', null),
  postalCode: Joi.string().max(20).allow('', null),
  isDefault: Joi.boolean().default(false),
});

export const validateCreateVendorWithCompany = (data: unknown) => {
  return Joi.object({
    name: Joi.string().max(255).required(),
    email: Joi.string().email().required(),
    phone: Joi.string().max(20).allow('', null),
    companyName: Joi.string().max(255).required(),
    establishmentDate: Joi.string().allow('', null),
    nature: Joi.string().valid('Domestic', 'International').allow('', null),
    type: Joi.string().max(150).allow('', null),
    numberOfEmployees: Joi.string().valid('0-10', '10-100', '100-1000', '1000+').allow('', null),
    annualTurnover: Joi.string().allow('', null),
    industryType: Joi.string().allow('', null),
    companyLogo: Joi.string().allow('', null),
    addresses: Joi.array().items(addressSchema).allow(null),
    typeOfCurrency: Joi.string().valid('INR', 'USD', 'EUR').allow('', null),
    bankName: Joi.string().max(100).allow('', null),
    beneficiaryName: Joi.string().max(100).allow('', null),
    accountNumber: Joi.string().max(20).allow('', null),
    iBanNumber: Joi.string().max(34).allow('', null),
    swiftCode: Joi.string().max(11).allow('', null),
    bankAccountType: Joi.string().max(50).allow('', null),
    ifscCode: Joi.string().max(11).allow('', null),
    gstNumber: Joi.string().max(100).allow('', null),
    panNumber: Joi.string().max(100).allow('', null),
    msmeNumber: Joi.string().max(100).allow('', null),
    ciNumber: Joi.string().max(100).allow('', null),
    pocName: Joi.string().max(100).allow('', null),
    pocDesignation: Joi.string().max(100).allow('', null),
    pocEmail: Joi.string().email().allow('', null),
    pocPhone: Joi.string().max(20).allow('', null),
    pocWebsite: Joi.string().allow('', null),
    escalationName: Joi.string().max(100).allow('', null),
    escalationDesignation: Joi.string().max(100).allow('', null),
    escalationEmail: Joi.string().email().allow('', null),
    escalationPhone: Joi.string().max(20).allow('', null),
  }).validate(data, options);
};

export const validateStep1 = (data: unknown) => {
  return Joi.object({
    name: Joi.string().max(255).required(),
    email: Joi.string().email().required(),
    phone: Joi.string().max(20).allow('', null),
    companyName: Joi.string().max(255).required(),
    establishmentDate: Joi.string().allow('', null),
    nature: Joi.string().valid('Domestic', 'International').allow('', null),
    type: Joi.string().max(150).allow('', null),
    numberOfEmployees: Joi.string().valid('0-10', '10-100', '100-1000', '1000+').allow('', null),
    annualTurnover: Joi.string().allow('', null),
    industryType: Joi.string().allow('', null),
    companyLogo: Joi.string().allow('', null),
  }).validate(data, options);
};

export const validateStep2 = (data: unknown) => {
  return Joi.object({
    address: Joi.string().max(500).required(),
    city: Joi.string().max(100).required(),
    state: Joi.string().max(100).required(),
    country: Joi.string().max(100).required(),
    zipCode: Joi.string().max(20).required(),
  }).validate(data, options);
};

export const validateStep3 = (data: unknown) => {
  return Joi.object({
    typeOfCurrency: Joi.string().valid('INR', 'USD', 'EUR', 'GBP', 'AUD').allow('', null),
    bankName: Joi.string().max(100).allow('', null),
    beneficiaryName: Joi.string().max(100).allow('', null),
    accountNumber: Joi.string().max(20).allow('', null),
    iBanNumber: Joi.string().max(34).allow('', null),
    swiftCode: Joi.string().max(11).allow('', null),
    bankAccountType: Joi.string().max(50).allow('', null),
    ifscCode: Joi.string().max(11).allow('', null),
    fullAddress: Joi.string().max(500).allow('', null),
    gstNumber: Joi.string().max(100).allow('', null),
    panNumber: Joi.string().max(100).allow('', null),
    msmeNumber: Joi.string().max(100).allow('', null),
    ciNumber: Joi.string().max(100).allow('', null),
  }).validate(data, options);
};

export const validateStep4 = (data: unknown) => {
  return Joi.object({
    pocName: Joi.string().max(100).allow('', null),
    pocDesignation: Joi.string().max(100).allow('', null),
    pocEmail: Joi.string().email().allow('', null),
    pocPhone: Joi.string().max(20).allow('', null),
    pocWebsite: Joi.string().max(500).allow('', null),
    escalationName: Joi.string().max(100).allow('', null),
    escalationDesignation: Joi.string().max(100).allow('', null),
    escalationEmail: Joi.string().email().allow('', null),
    escalationPhone: Joi.string().max(20).allow('', null),
  }).validate(data, options);
};

// ============================================================================
// Route Handlers & Endpoints
// ============================================================================

vendorRouter.post('/create-vendor', authMiddleware, (req, res, next) => checkPermission(req, res, next, moduleId, 3), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const step = req.query.step as string;
    if (step !== '1') throw new CustomError('POST only allowed for step=1. Use PUT for other steps.', 400);
    const { error } = validateStep1(req.body);
    if (error) throw new CustomError(error.details[0].message, 400);
    const data = await createVendorStep1Service(req.body as Step1Data, req.context.userId);
    res.status(201).json({ message: 'Vendor and company created successfully (Step 1)', step: 1, data });
  } catch (err) { next(err); }
});

vendorRouter.put('/create-vendor/:companyId', authMiddleware, (req, res, next) => checkPermission(req, res, next, moduleId, 3), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const companyId = getNumericParam(req.params.companyId);
    const step = req.query.step as string;
    if (Number.isNaN(companyId)) throw new CustomError('Invalid company ID', 400);

    let data; let message;
    switch (step) {
      case '2':
        { const { error } = validateStep2(req.body); if (error) throw new CustomError(error.details[0].message, 400); }
        data = await updateVendorStep2Service(companyId, req.body as Step2Data);
        message = 'Location details updated (Step 2)';
        break;
      case '3':
        { const { error } = validateStep3(req.body); if (error) throw new CustomError(error.details[0].message, 400); }
        data = await updateVendorStep3Service(companyId, req.body as Step3Data);
        message = 'Financial and banking info updated (Step 3)';
        break;
      case '4':
        { const { error } = validateStep4(req.body); if (error) throw new CustomError(error.details[0].message, 400); }
        data = await updateVendorStep4Service(companyId, req.body as Step4Data);
        message = 'Contact information updated (Step 4)';
        break;
      default:
        throw new CustomError('Invalid step. Use step=2, 3, or 4 for PUT requests.', 400);
    }
    res.status(200).json({ message, step: Number.parseInt(step, 10), data });
  } catch (err) { next(err); }
});

vendorRouter.get('/create-vendor/:companyId', authMiddleware, (req, res, next) => checkPermission(req, res, next, moduleId, 1), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const companyId = getNumericParam(req.params.companyId);
    const step = req.query.step as string;
    if (Number.isNaN(companyId)) throw new CustomError('Invalid company ID', 400);
    if (step !== '5') throw new CustomError('GET request is only for step=5 (review)', 400);
    const data = await getVendorForReviewService(companyId);
    res.status(200).json({ message: 'Vendor data for review (Step 5)', step: 5, data });
  } catch (err) { next(err); }
});

vendorRouter.post('/company/create', authMiddleware, (req, res, next) => checkPermission(req, res, next, moduleId, 3), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { error } = validateCreateVendorWithCompany(req.body);
    if (error) throw new CustomError(error.details[0].message, 400);
    const data = await createVendorWithCompanyService(req.body as VendorWithCompanyData, req.context.userId);
    res.status(201).json({ message: 'Vendor and company created successfully', data: { vendor: { id: data.vendor.id, name: data.vendor.name, email: data.vendor.email, phone: data.vendor.phone }, company: { id: data.company.id, companyName: data.company.companyName }, vendorCompany: { id: data.vendorCompany.id, vendorId: data.vendorCompany.vendorId, companyId: data.vendorCompany.companyId }, addresses: data.addresses } });
  } catch (err) { next(err); }
});

vendorRouter.post('/', authMiddleware, (req, res, next) => checkPermission(req, res, next, moduleId, 3), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { error } = validateCreateVendor(req.body);
    if (error) throw new CustomError(error.details[0].message, 400);
    const data = await createVendorService(req.body, req.context.userId);
    res.status(201).json({ message: 'Vendor created successfully', data });
  } catch (err) { next(err); }
});

vendorRouter.get('/', authMiddleware, (req, res, next) => checkPermission(req, res, next, moduleId, 1), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { search, page = 1, limit = 10, filters } = req.query;
    const data = await getVendorsService(req.context.userId, search as string | undefined, page as string | number, limit as string | number, filters as string | undefined);
    res.status(200).json({ message: 'Vendors', ...data });
  } catch (err) { next(err); }
});

vendorRouter.get('/:vendorId', authMiddleware, (req, res, next) => checkPermission(req, res, next, moduleId, 1), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const vendorId = getNumericParam(req.params.vendorId);
    const data = await getVendorService({ id: vendorId });
    res.status(200).json({ message: 'Vendor', data });
  } catch (err) { next(err); }
});

vendorRouter.put('/:vendorId', authMiddleware, (req, res, next) => checkPermission(req, res, next, moduleId, 2), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await updateVendorService(getParam(req.params.vendorId), req.body);
    res.status(200).json({ message: 'Vendor updated successfully', data });
  } catch (err) { next(err); }
});

vendorRouter.delete('/:vendorId', authMiddleware, (req, res, next) => checkPermission(req, res, next, moduleId, 3), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = await deleteVendorService(getParam(req.params.vendorId));
    res.status(200).json({ message: 'Vendor deleted successfully', data });
  } catch (err) { next(err); }
});

export default vendorRouter;
