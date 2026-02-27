/**
 * Test data factories for creating mock data
 */

export const createMockUser = (overrides: any = {}) => ({
  name: 'Test User',
  email: 'test@example.com',
  phone: '1234567890',
  password: 'password123',
  userType: 'admin' as const,
  companyId: 1,
  roleId: 1,
  status: 'active',
  approvalLevel: 'NONE' as const,
  approvalLimit: 0,
  ...overrides,
});

export const createMockCompany = (overrides: any = {}) => ({
  name: 'Test Company',
  email: 'company@example.com',
  phone: '9876543210',
  address: '123 Test Street',
  city: 'Test City',
  state: 'Test State',
  country: 'Test Country',
  pincode: '123456',
  ...overrides,
});

export const createMockRequisition = (overrides: any = {}) => ({
  projectId: 1,
  rfqId: 'RFQ001',
  subject: 'Test Requisition',
  category: 'Electronics',
  deliveryDate: new Date('2026-03-15'),
  maxDeliveryDate: new Date('2026-03-20'),
  negotiationClosureDate: new Date('2026-02-28'),
  typeOfCurrency: 'USD' as const,
  totalPrice: 1000,
  status: 'Created' as const,
  approvalStatus: 'NOT_SUBMITTED' as const,
  ...overrides,
});

export const createMockRequisitionProduct = (overrides: any = {}) => ({
  requisitionId: 1,
  productId: 1,
  targetPrice: 50,
  maximum_price: 60,
  qty: 100,
  ...overrides,
});

export const createMockVendor = (overrides: any = {}) => ({
  name: 'Test Vendor',
  email: 'vendor@example.com',
  phone: '1111111111',
  userType: 'vendor' as const,
  companyId: 1,
  status: 'active',
  ...overrides,
});

export const createMockProject = (overrides: any = {}) => ({
  projectName: 'Test Project',
  companyId: 1,
  status: 'active',
  ...overrides,
});

export const createMockProduct = (overrides: any = {}) => ({
  productName: 'Test Product',
  category: 'Electronics',
  brandName: 'Test Brand',
  gstType: 'GST' as const,
  gstPercentage: 18,
  tds: 12345,
  type: 'Goods' as const,
  UOM: 'units' as const,
  companyId: 1,
  ...overrides,
});

export const createMockProductNonGst = (overrides: any = {}) => ({
  productName: 'Non-GST Product',
  category: 'Services',
  brandName: 'Service Brand',
  gstType: 'Non-GST' as const,
  gstPercentage: null,
  tds: 67890,
  type: 'Services' as const,
  UOM: 'units' as const,
  companyId: 1,
  ...overrides,
});

export const createMockChatbotDeal = (overrides: any = {}) => ({
  title: 'Test Deal',
  mode: 'INSIGHTS' as const,
  status: 'NEGOTIATING' as const,
  round: 0,
  requisitionId: 1,
  vendorId: 1,
  userId: 1,
  negotiationConfigJson: {},
  weightsJson: {},
  ...overrides,
});

export const createMockRole = (overrides: any = {}) => ({
  name: 'Admin',
  companyId: 1,
  isArchived: false,
  ...overrides,
});
