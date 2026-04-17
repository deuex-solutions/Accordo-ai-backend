import { Op } from 'sequelize';
import repo from './requisition.repo.js';
import userRepo from '../user/user.repo.js';
import { CustomError } from '../../utils/custom-error.js';
import type { Requisition } from '../../models/requisition.js';
import type { RequisitionData, RequisitionProductData, RequisitionAttachmentData } from './requisition.repo.js';
import util from '../common/util.js';
import models from '../../models/index.js';
import { calculateRequisitionDiff, generateChangeSummary, type RequisitionDiff } from './requisition-diff.js';
import { sendRequisitionUpdatedEmail } from '../../services/email.service.js';
import { buildConfigFromRequisition, createSystemMessageService } from '../chatbot/chatbot.service.js';
import logger from '../../config/logger.js';

export interface ProductData {
  productId: number | string;
  qty?: number | string;
  quantity?: number | string; // Alternative name for qty
  targetPrice?: number | string;
  maximum_price?: number | string;
  unitPrice?: number;
  gstType?: string;
  gstPercentage?: number;
  tds?: number;
  specification?: string;
}

export interface PaginatedRequisitionsResponse {
  data: Requisition[];
  total: number;
  page: number;
  totalPages: number;
}

export interface RequisitionFilters {
  status?: string;
  projectId?: number;
  vendorCount?: string;
  startDate?: string;
  endDate?: string;
}

export interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  destination: string;
  filename: string;
  path: string;
  size: number;
}

export const createRequisionService = async (
  requisitionData: RequisitionData,
  userId: number,
  attachmentFiles: MulterFile[] = []
): Promise<Requisition> => {
  try {
    console.log('=== CREATE REQUISITION SERVICE ===');
    console.log('Received requisitionData keys:', Object.keys(requisitionData));
    console.log('Received requisitionData:', JSON.stringify(requisitionData, null, 2));
    console.log('userId:', userId);

    const user = await userRepo.getUser(userId);
    if (!user?.companyId) {
      throw new CustomError('User company not found', 400);
    }
    console.log('User found with companyId:', user.companyId);

    // Parse productData from various formats (multipart form data can send it differently)
    let productData: ProductData[] = [];
    if (requisitionData.productData) {
      if (Array.isArray(requisitionData.productData)) {
        productData = requisitionData.productData;
      } else if (typeof requisitionData.productData === 'string') {
        try {
          productData = JSON.parse(requisitionData.productData);
        } catch (parseError) {
          console.error('Error parsing productData JSON:', parseError);
          productData = [];
        }
      } else if (typeof requisitionData.productData === 'object') {
        // Handle object format from multipart form (e.g., { '0': {...}, '1': {...} })
        productData = Object.values(requisitionData.productData);
      }
    }

    // Clean requisitionData before creating (remove fields that shouldn't be in Requisition table)
    const cleanedData = { ...requisitionData };
    delete cleanedData.productData;
    delete cleanedData.files;
    delete cleanedData.selectedProduct;

    // Handle field name mapping: frontend might send maximum_delivery_date but backend expects maxDeliveryDate
    if (cleanedData.maximum_delivery_date !== undefined && cleanedData.maxDeliveryDate === undefined) {
      cleanedData.maxDeliveryDate = cleanedData.maximum_delivery_date;
    }
    delete cleanedData.maximum_delivery_date;

    // Parse and validate date fields - multipart form data sends dates as strings
    const dateFields = ['deliveryDate', 'negotiationClosureDate', 'maxDeliveryDate'];
    for (const field of dateFields) {
      if (cleanedData[field]) {
        // Handle empty strings
        if (cleanedData[field] === '' || cleanedData[field] === 'null') {
          cleanedData[field] = null;
        } else if (typeof cleanedData[field] === 'string') {
          // Parse string dates
          const parsedDate = new Date(cleanedData[field]);
          if (isNaN(parsedDate.getTime())) {
            console.error(`Invalid date for ${field}:`, cleanedData[field]);
            cleanedData[field] = null;
          } else {
            cleanedData[field] = parsedDate;
          }
        }
      }
    }

    // Ensure projectId is a number (multipart form data can send it as string)
    if (cleanedData.projectId !== undefined) {
      cleanedData.projectId = typeof cleanedData.projectId === 'string'
        ? parseInt(cleanedData.projectId, 10)
        : cleanedData.projectId;
    }

    // Validate required field: projectId
    if (!cleanedData.projectId) {
      throw new CustomError('Project ID is required', 400);
    }

    // Validate typeOfCurrency if provided
    const validCurrencies = ['USD', 'INR', 'EUR', 'GBP', 'AUD'];
    if (cleanedData.typeOfCurrency && !validCurrencies.includes(cleanedData.typeOfCurrency)) {
      console.error('Invalid currency:', cleanedData.typeOfCurrency);
      throw new CustomError(`Invalid currency: ${cleanedData.typeOfCurrency}. Valid values: ${validCurrencies.join(', ')}`, 400);
    }

    const payload: RequisitionData = {
      ...cleanedData,
      companyId: user.companyId,
    };

    console.log('Creating requisition with payload:', JSON.stringify(payload, null, 2));
    console.log('projectId value:', payload.projectId, 'type:', typeof payload.projectId);

    let requisition;
    try {
      requisition = await repo.createRequisition(payload);
      console.log('Requisition created successfully with id:', requisition.id);
    } catch (createError: any) {
      console.error('=== REQUISITION CREATION ERROR ===');
      console.error('Error:', createError);
      console.error('Error name:', createError.name);
      console.error('Error message:', createError.message);
      console.error('Error SQL:', createError.sql);
      console.error('Error parent:', createError.parent?.message);
      console.error('Error detail:', createError.parent?.detail);
      if (createError.errors) {
        console.error('Validation errors:', createError.errors.map((e: any) => ({
          field: e.path,
          message: e.message,
          value: e.value,
          type: e.type
        })));
      }
      console.error('=== END REQUISITION CREATION ERROR ===');
      throw createError;
    }

    if (productData.length > 0) {
      // Helper function to safely parse integer, returning null for invalid values
      const safeParseInt = (value: any): number | null => {
        if (value === undefined || value === null || value === '') return null;
        const parsed = typeof value === 'string' ? parseInt(value, 10) : value;
        return isNaN(parsed) ? null : parsed;
      };

      // Helper function to safely parse float, returning null for invalid values
      const safeParseFloat = (value: any): number | null => {
        if (value === undefined || value === null || value === '') return null;
        const parsed = typeof value === 'string' ? parseFloat(value) : value;
        return isNaN(parsed) ? null : parsed;
      };

      await Promise.all(
        productData.map((product: ProductData) => {
          // Normalize product data - convert string values to numbers
          const normalizedProduct = {
            requisitionId: requisition.id,
            productId: safeParseInt(product.productId),
            qty: safeParseInt(product.qty) ?? safeParseInt(product.quantity),
            targetPrice: safeParseFloat(product.targetPrice),
            maximum_price: safeParseFloat(product.maximum_price),
            createdBy: userId, // Required field for RequisitionProduct
          };
          return repo.createRequisitionProduct(normalizedProduct);
        })
      );
    }

    // Handle file attachments
    if (attachmentFiles && attachmentFiles.length > 0) {
      await Promise.all(
        attachmentFiles.map((file: MulterFile) =>
          repo.createRequisitionAttachment({
            requisitionId: requisition.id,
            filename: file.originalname,
            filepath: file.path,
            mimetype: file.mimetype,
            size: file.size,
          })
        )
      );
    }

    return requisition;
  } catch (error: any) {
    console.error('Error in createRequisionService:', error);

    // Extract detailed validation error info
    let message = error instanceof Error ? error.message : String(error);

    // Check for Sequelize validation errors and include field details
    if (error.name === 'SequelizeValidationError' && error.errors) {
      const fieldErrors = error.errors.map((e: any) => `${e.path}: ${e.message} (value: ${JSON.stringify(e.value)})`).join('; ');
      message = `Validation error: ${fieldErrors}`;
    } else if (error.name === 'SequelizeForeignKeyConstraintError') {
      message = `Foreign key error: ${error.table} - ${error.fields?.join(', ')} (${error.parent?.detail || error.message})`;
    } else if (error.name === 'SequelizeDatabaseError') {
      message = `Database error: ${error.parent?.message || error.message}`;
    }

    throw new CustomError(`Failed to create requisition: ${message}`, 400);
  }
};

export const getRequisitionService = async (
  requisitionId: number
): Promise<Requisition | null> => {
  try {
    return repo.getRequisition({ id: requisitionId });
  } catch (error) {
    throw new CustomError(String(error), 400);
  }
};

export const getRequisitionsService = async (
  search: string | undefined,
  page: number | string = 1,
  limit: number | string = 10,
  projectId: number | undefined,
  userId: number,
  filters?: RequisitionFilters
): Promise<PaginatedRequisitionsResponse> => {
  try {
    const parsedPage = Number.parseInt(String(page), 10) || 1;
    const parsedLimit = Number.parseInt(String(limit), 10) || 10;
    const offset = (parsedPage - 1) * parsedLimit;

    const queryOptions: any = {
      where: {},
      limit: parsedLimit,
      offset,
    };

    if (search) {
      // Multi-field OR search: Project ID (via Project), RFQ ID, Name (subject), Category
      // Note: Vendor search is handled via Contract -> Vendor include in repo
      queryOptions.where = {
        [Op.or]: [
          { rfqId: { [Op.iLike]: `%${search}%` } },
          { subject: { [Op.iLike]: `%${search}%` } },
          { category: { [Op.iLike]: `%${search}%` } },
        ],
      };
      // Store search term for vendor name search in repo
      (queryOptions as any).searchTerm = search;
    }

    if (projectId) {
      queryOptions.where.projectId = projectId;
    }

    // Apply additional filters
    if (filters) {
      if (filters.status) {
        queryOptions.where.status = filters.status;
      }
      if (filters.startDate || filters.endDate) {
        queryOptions.where.deliveryDate = {};
        if (filters.startDate) {
          queryOptions.where.deliveryDate.$gte = new Date(filters.startDate);
        }
        if (filters.endDate) {
          queryOptions.where.deliveryDate.$lte = new Date(filters.endDate);
        }
      }
    }

    // Handle vendor count filter (requires special handling in repo)
    if (filters?.vendorCount) {
      // This will be handled by the repository's contract counting logic
    }

    const { rows, count } = await repo.getRequisitions(queryOptions, userId);

    return {
      data: rows,
      total: count,
      page: parsedPage,
      totalPages: parsedLimit ? Math.ceil(count / parsedLimit) : 1,
    };
  } catch (error) {
    throw new CustomError((error as Error).message || String(error), 400);
  }
};

export const updateRequisitionService = async (
  requisitionId: number,
  requisitionData: RequisitionData,
  userId: number,
  attachmentFiles: MulterFile[] = []
): Promise<[affectedCount: number]> => {
  try {
    // Validate userId exists
    if (!userId) {
      throw new CustomError('User ID is required', 401);
    }

    // Verify user exists in database (required for createdBy foreign key)
    const user = await userRepo.getUser(userId);
    if (!user) {
      throw new CustomError('User not found', 401);
    }

    console.log('updateRequisitionService called with:', {
      requisitionId,
      userId,
      requisitionDataKeys: Object.keys(requisitionData),
      productDataType: typeof requisitionData.productData,
      productDataValue: requisitionData.productData,
    });

    // ============================================
    // STEP 1: Capture old state BEFORE update
    // ============================================
    const oldRequisition = await repo.getRequisition({ id: requisitionId });
    if (!oldRequisition) {
      throw new CustomError('Requisition not found', 404);
    }
    const oldProducts = oldRequisition.RequisitionProduct || [];
    const oldState = {
      subject: oldRequisition.subject,
      deliveryDate: oldRequisition.deliveryDate,
      negotiationClosureDate: oldRequisition.negotiationClosureDate,
      totalPrice: oldRequisition.totalPrice,
      totalMaxPrice: oldRequisition.totalMaxPrice,
      maxDeliveryDate: oldRequisition.maxDeliveryDate,
      payment_terms: oldRequisition.payment_terms,
      net_payment_day: oldRequisition.net_payment_day,
      pre_payment_percentage: oldRequisition.pre_payment_percentage,
      post_payment_percentage: oldRequisition.post_payment_percentage,
    };

    // Handle field name mapping: frontend might send maximum_delivery_date but backend expects maxDeliveryDate
    if (requisitionData.maximum_delivery_date !== undefined && requisitionData.maxDeliveryDate === undefined) {
      requisitionData.maxDeliveryDate = requisitionData.maximum_delivery_date;
    }
    delete requisitionData.maximum_delivery_date;

    // Parse productData from various formats (multipart form data can send it differently)
    let productData: ProductData[] = [];
    if (requisitionData.productData) {
      if (Array.isArray(requisitionData.productData)) {
        productData = requisitionData.productData;
      } else if (typeof requisitionData.productData === 'string') {
        try {
          const parsed = JSON.parse(requisitionData.productData);
          // Ensure parsed result is an array
          productData = Array.isArray(parsed) ? parsed : [];
        } catch (parseError) {
          console.error('Error parsing productData JSON:', parseError);
          productData = [];
        }
      } else if (typeof requisitionData.productData === 'object') {
        // Handle object format from multipart form (e.g., { '0': {...}, '1': {...} })
        productData = Object.values(requisitionData.productData);
      }
    }
    console.log('Parsed productData:', productData, 'length:', productData.length);

    // Only allow valid Requisition model fields to be updated
    const allowedFields = [
      'subject', 'category', 'deliveryDate', 'negotiationClosureDate', 'typeOfCurrency',
      'totalQuantity', 'totalPrice', 'totalMaxPrice', 'finalPrice', 'status', 'payment_terms', 'net_payment_day',
      'pre_payment_percentage', 'post_payment_percentage', 'maxDeliveryDate',
      'batna', 'discountedValue', 'maxDiscount'
    ];

    // Fields that are DOUBLE/numeric type - empty strings should become null
    const numericFields = [
      'totalQuantity', 'totalPrice', 'totalMaxPrice', 'finalPrice', 'pre_payment_percentage', 'post_payment_percentage',
      'batna', 'discountedValue', 'maxDiscount'
    ];

    const cleanedData: Record<string, any> = {};
    for (const field of allowedFields) {
      if (requisitionData[field] !== undefined) {
        let value = requisitionData[field];

        // Convert empty strings to null for numeric fields
        if (numericFields.includes(field)) {
          if (value === '' || value === null) {
            value = null;
          } else if (typeof value === 'string') {
            const parsed = parseFloat(value);
            value = isNaN(parsed) ? null : parsed;
          }
        }

        // Convert empty strings to null for net_payment_day (stored as string but can be empty)
        if (field === 'net_payment_day' && value === '') {
          value = null;
        }

        cleanedData[field] = value;
      }
    }

    // Parse and validate date fields - multipart form data sends dates as strings
    const dateFields = ['deliveryDate', 'negotiationClosureDate', 'maxDeliveryDate'];
    for (const field of dateFields) {
      if (cleanedData[field] !== undefined) {
        // Handle empty strings
        if (cleanedData[field] === '' || cleanedData[field] === 'null') {
          cleanedData[field] = null;
        } else if (typeof cleanedData[field] === 'string') {
          // Parse string dates
          const parsedDate = new Date(cleanedData[field]);
          if (isNaN(parsedDate.getTime())) {
            console.error(`Invalid date for ${field}:`, cleanedData[field]);
            cleanedData[field] = null;
          } else {
            cleanedData[field] = parsedDate;
          }
        }
      }
    }

    console.log('Cleaned data for update:', cleanedData);
    console.log('Product data parsed:', productData);

    let result;
    try {
      result = await repo.updateRequisition(requisitionId, cleanedData);
      console.log('Requisition update result:', result);
    } catch (updateError: any) {
      console.error('Error updating requisition fields:', updateError);
      console.error('Update error name:', updateError.name);
      console.error('Update error message:', updateError.message);
      throw updateError;
    }

    // Filter out invalid products and create valid ones
    const validProducts = productData.filter((product: ProductData) => {
      const productId = typeof product.productId === 'string' ? parseInt(product.productId, 10) : product.productId;
      return productId && !isNaN(productId) && productId > 0;
    });

    if (validProducts.length > 0) {
      // Check if all products exist in the database before proceeding
      const productIds = validProducts.map((p: ProductData) =>
        typeof p.productId === 'string' ? parseInt(p.productId, 10) : p.productId
      );
      const missingProductIds = await repo.checkProductsExist(productIds);
      if (missingProductIds.length > 0) {
        throw new CustomError(`Products with IDs [${missingProductIds.join(', ')}] do not exist`, 400);
      }

      // Delete existing products and recreate
      console.log('Deleting existing products for requisition:', requisitionId);
      await repo.deleteRequisitionProducts(requisitionId);

      console.log('Creating new products:', validProducts.length);
      for (const product of validProducts) {
        // Helper function to safely parse integer, returning null for invalid values
        const safeParseInt = (value: any): number | null => {
          if (value === undefined || value === null || value === '') return null;
          const parsed = typeof value === 'string' ? parseInt(value, 10) : value;
          return isNaN(parsed) ? null : parsed;
        };

        // Helper function to safely parse float, returning null for invalid values
        const safeParseFloat = (value: any): number | null => {
          if (value === undefined || value === null || value === '') return null;
          const parsed = typeof value === 'string' ? parseFloat(value) : value;
          return isNaN(parsed) ? null : parsed;
        };

        // IMPORTANT: Only include fields that should be inserted
        // Do NOT include 'id', 'createdAt', or other auto-generated fields
        // These come from existing RequisitionProduct records when editing
        const normalizedProduct = {
          requisitionId,
          productId: safeParseInt(product.productId),
          qty: safeParseInt(product.qty) ?? safeParseInt(product.quantity),
          targetPrice: safeParseFloat(product.targetPrice),
          maximum_price: safeParseFloat(product.maximum_price),
          createdBy: userId, // Required field for RequisitionProduct
          // Note: 'id' is intentionally NOT included - let database auto-generate it
          // Note: 'createdAt' is auto-generated by Sequelize timestamps: true
        };

        // Validate required fields
        if (!normalizedProduct.productId) {
          console.error('Invalid productId for product:', product);
          throw new CustomError('Invalid product ID', 400);
        }

        console.log('Creating product with normalized data:', JSON.stringify(normalizedProduct, null, 2));
        console.log('Original product data was:', JSON.stringify(product, null, 2));
        try {
          const createdProduct = await repo.createRequisitionProduct(normalizedProduct);
          console.log('Successfully created product with id:', createdProduct.id);
        } catch (productError: any) {
          console.error('=== PRODUCT CREATION ERROR ===');
          console.error('Error creating product:', productError);
          console.error('Product error name:', productError.name);
          console.error('Product error message:', productError.message);
          console.error('Product error SQL:', productError.sql);
          console.error('Product error parent:', productError.parent?.message);
          console.error('Product error detail:', productError.parent?.detail);
          if (productError.errors) {
            console.error('Product validation errors:', productError.errors.map((e: any) => ({
              field: e.path,
              message: e.message,
              value: e.value,
              type: e.type,
              validatorKey: e.validatorKey,
              validatorName: e.validatorName
            })));
          }
          console.error('=== END PRODUCT CREATION ERROR ===');
          throw productError;
        }
      }
    } else if (productData.length > 0) {
      console.log('No valid products found in productData, skipping product update');
    }

    // Handle new file attachments
    if (attachmentFiles && attachmentFiles.length > 0) {
      await Promise.all(
        attachmentFiles.map((file: MulterFile) =>
          repo.createRequisitionAttachment({
            requisitionId,
            filename: file.originalname,
            filepath: file.path,
            mimetype: file.mimetype,
            size: file.size,
          })
        )
      );
    }

    // ============================================
    // STEP 3: Calculate diff and notify vendors
    // ============================================
    try {
      // Fetch updated requisition with products for diff calculation
      const updatedRequisition = await repo.getRequisition({ id: requisitionId });
      const newProducts = updatedRequisition?.RequisitionProduct || [];

      // Build the new state from cleaned data (what was actually updated)
      const newState = {
        subject: cleanedData.subject ?? oldState.subject,
        deliveryDate: cleanedData.deliveryDate ?? oldState.deliveryDate,
        negotiationClosureDate: cleanedData.negotiationClosureDate ?? oldState.negotiationClosureDate,
        totalPrice: cleanedData.totalPrice ?? oldState.totalPrice,
        totalMaxPrice: cleanedData.totalMaxPrice ?? oldState.totalMaxPrice,
        maxDeliveryDate: cleanedData.maxDeliveryDate ?? oldState.maxDeliveryDate,
        payment_terms: cleanedData.payment_terms ?? oldState.payment_terms,
        net_payment_day: cleanedData.net_payment_day ?? oldState.net_payment_day,
        pre_payment_percentage: cleanedData.pre_payment_percentage ?? oldState.pre_payment_percentage,
        post_payment_percentage: cleanedData.post_payment_percentage ?? oldState.post_payment_percentage,
      };

      // Calculate diff between old and new state
      const diff = calculateRequisitionDiff(oldState, newState, oldProducts, newProducts);

      // If changes detected, process linked contracts
      if (diff.hasChanges) {
        logger.info(`Requisition ${requisitionId} updated with changes, notifying vendors`, {
          requisitionChanges: diff.requisitionChanges.length,
          productChanges: diff.productChanges.length,
        });

        // Find all contracts for this requisition
        const contracts = await models.Contract.findAll({
          where: { requisitionId },
          include: [{ model: models.User, as: 'Vendor' }],
        });

        for (const contract of contracts) {
          // Cast contract to include Vendor from the include
          const contractWithVendor = contract as typeof contract & { Vendor?: { email?: string; name?: string } };
          try {
            // 4a. Update deal negotiation config if deal exists
            if (contract.chatbotDealId) {
              const newConfig = await buildConfigFromRequisition(requisitionId);
              await models.ChatbotDeal.update(
                { negotiationConfigJson: newConfig },
                { where: { id: contract.chatbotDealId } }
              );
              logger.info(`Updated negotiationConfigJson for deal ${contract.chatbotDealId}`);

              // 4b. Add system message to chat
              const changeSummary = generateChangeSummary(diff);
              await createSystemMessageService(
                contract.chatbotDealId,
                `REQUISITION UPDATED\n\n${changeSummary}\n\nNegotiation terms have been recalculated.`
              );
              logger.info(`Added system message to deal ${contract.chatbotDealId}`);
            }

            // 4c. Send email notification to vendor
            if (contractWithVendor.Vendor?.email) {
              await sendRequisitionUpdatedEmail(contractWithVendor as any, updatedRequisition as any, diff);
            }
          } catch (notifyError) {
            // Log but don't fail the update if notification fails
            logger.error(`Failed to notify vendor for contract ${contract.id}:`, {
              error: (notifyError as Error).message,
            });
          }
        }
      }
    } catch (notificationError) {
      // Log but don't fail the update if notification processing fails
      logger.error('Error processing requisition update notifications:', {
        requisitionId,
        error: (notificationError as Error).message,
      });
    }

    return result;
  } catch (error: any) {
    console.error('Error in updateRequisitionService:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error parent:', error.parent?.message);
    console.error('Error original:', error.original?.message);

    // Log more details for Sequelize validation errors
    if (error.name === 'SequelizeValidationError' || error.name === 'SequelizeUniqueConstraintError') {
      console.error('Validation errors:', error.errors?.map((e: any) => ({
        field: e.path,
        message: e.message,
        value: e.value,
        type: e.type
      })));
    }

    // Log foreign key constraint errors
    if (error.name === 'SequelizeForeignKeyConstraintError') {
      console.error('Foreign key error - table:', error.table);
      console.error('Foreign key error - fields:', error.fields);
      console.error('Foreign key error - index:', error.index);
    }

    // Log database error details
    if (error.name === 'SequelizeDatabaseError') {
      console.error('Database error SQL:', error.sql);
      console.error('Database error parameters:', error.parameters);
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new CustomError(`Failed to update requisition: ${message}`, 400);
  }
};

export const deleteRequisitionService = async (
  requisitionId: number
): Promise<number> => {
  try {
    // Delete associated products and attachments first
    await repo.deleteRequisitionProducts(requisitionId);
    await repo.deleteRequisitionAttachments(requisitionId);

    return repo.deleteRequisition({ id: requisitionId });
  } catch (error) {
    throw new CustomError(String(error), 400);
  }
};

/**
 * Response format for requisition summary (for negotiation dropdown)
 */
export interface RequisitionSummary {
  id: number;
  rfqNumber: string;
  title: string;
  projectName: string;
  estimatedValue: number;
  productCount: number;
  vendorCount: number;
  negotiationClosureDate?: string;
}

/**
 * Response format for vendor summary (for vendor dropdown)
 */
export interface VendorSummary {
  id: number;
  name: string;
  companyName?: string;
  pastDealsCount: number;
}

/**
 * Get all requisitions available for negotiation
 * Returns summarized data for the deal creation dropdown
 */
export const getRequisitionsForNegotiationService = async (
  userId: number
): Promise<RequisitionSummary[]> => {
  try {
    const requisitions = await repo.getRequisitionsForNegotiation(userId);
    return requisitions;
  } catch (error) {
    throw new CustomError((error as Error).message || String(error), 400);
  }
};

/**
 * Get vendors attached to a specific requisition (via Contracts)
 * For the vendor dropdown in deal creation
 */
export const getRequisitionVendorsService = async (
  requisitionId: number,
  userId: number
): Promise<VendorSummary[]> => {
  try {
    const vendors = await repo.getRequisitionVendors(requisitionId);
    return vendors;
  } catch (error) {
    throw new CustomError((error as Error).message || String(error), 400);
  }
};
