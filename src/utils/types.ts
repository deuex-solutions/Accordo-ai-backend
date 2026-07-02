// Common types used across the application

export interface PaginationParams {
  page?: number;
  limit?: number;
  offset?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
}

export type UserType = 'super_admin' | 'admin' | 'procurement' | 'vendor';

export type ContractStatus =
  | 'Created'
  | 'Opened'
  | 'Accepted'
  | 'Rejected'
  | 'Expired'
  | 'Negotiating';

export type RequisitionStatus =
  | 'Draft'
  | 'Pending'
  | 'InProgress'
  | 'Completed'
  | 'Cancelled';

export type NegotiationStatus = 'active' | 'completed' | 'cancelled';

export type PoStatus = 'Pending' | 'Approved' | 'Cancelled' | 'Completed';

// LLM related types
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

export interface LLMHealthResponse {
  available: boolean;
  model: string;
  error?: string;
}

// Email related types
export type EmailType = 'vendor_attached' | 'status_change' | 'general';

export type EmailStatus = 'pending' | 'sent' | 'failed' | 'bounced';

export interface EmailMetadata {
  oldStatus?: string;
  newStatus?: string;
  projectName?: string;
  requisitionTitle?: string;
  [key: string]: unknown;
}

// JWT related types
export interface JWTPayload {
  userId: number;
  userType: string;
  companyId?: number;
  email?: string;
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

// Permission related types
export type PermissionLevel = 1 | 2 | 3; // 1 = Read, 2 = Update, 3 = Create/Delete

export interface ModulePermission {
  moduleId: number;
  moduleName: string;
  permission: PermissionLevel;
}

// Negotiation related types
export interface NegotiationContext {
  requisitionId?: number;
  vendorId?: number;
  negotiationId?: string;
  preferences?: UserPreferences;
  history?: NegotiationRoundData[];
}

export interface UserPreferences {
  batna?: number;
  maxDiscount?: number;
  maxPrice?: number;
  priceWeight?: number;
  deliveryWeight?: number;
}

export interface NegotiationRoundData {
  roundNumber: number;
  offerDetails: Record<string, unknown>;
  feedback?: Record<string, unknown>;
  createdAt: Date;
}

// Product related types
export type ProductType = 'Goods' | 'Services';

export type GSTType = 'Inclusive' | 'Exclusive' | 'None';

// File upload related types
export interface UploadedFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  destination: string;
  filename: string;
  path: string;
  size: number;
}

/**
 * Safely extract a route parameter as a string.
 * Handles Express 5.x typing where params can be string | string[].
 * @param param - The parameter value from req.params
 * @returns The parameter as a string, or the first element if it's an array
 */
export const getParam = (param: string | string[] | undefined): string => {
  if (Array.isArray(param)) {
    return param[0] || '';
  }
  return param || '';
};

/**
 * Safely extract a route parameter and parse it as a number.
 * @param param - The parameter value from req.params
 * @returns The parameter parsed as a number
 */
export const getNumericParam = (param: string | string[] | undefined): number => {
  const str = getParam(param);
  return Number.parseInt(str, 10);
};
