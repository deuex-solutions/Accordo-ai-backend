/**
 * Requisitions (RFQs) seed data - 15 RFQs with scoring weights
 * Status distribution: 5 Draft, 5 NegotiationStarted, 3 Awarded, 2 Expired
 * Each RFQ has 1-4 products and 2-4 attached vendors
 */

import { daysFromNow, generateDeadlines } from '../helpers/date-utils.js';
import { generateRfqId } from '../helpers/id-generator.js';
import { DEFAULT_SCORING_WEIGHTS, type ScoringWeights } from '../helpers/price-utils.js';
import { allProjects } from './projects.js';
import { getProductsByCategory, type ProductData } from './products.js';


export interface RequisitionProductData {
  productId: number;
  quantity: number;
  targetUnitPrice: number;
  specifications?: string;
}

export interface RequisitionVendorData {
  vendorCompanyId: number;
  invitedAt: Date;
}

export interface RequisitionData {
  id: number;
  rfqId: string;
  title: string;
  description: string;
  projectId: number;
  companyId: number;
  createdById: number;
  status: 'Draft' | 'Created' | 'NegotiationStarted' | 'Awarded' | 'Fulfilled' | 'Expired' | 'Cancelled';
  priority: 'High' | 'Medium' | 'Low';
  deliveryDate: Date;
  maxDeliveryDate: Date;  // Hard deadline for delivery
  negotiationClosureDate: Date;
  createdAt: Date;
  estimatedValue: number;
  scoringWeights: ScoringWeights;
  products: RequisitionProductData[];
  vendors: RequisitionVendorData[];
}

// Vendors grouped by sector capability
const vendorsBySector: Record<string, number[]> = {
  'IT/Electronics': [5, 6, 7, 8], // TechSupply, GlobalParts, ServerDirect, CloudSoft
  'Office Supplies': [9, 10, 11], // OfficeMax, FurniturePlus, WorkSpace
  'Manufacturing': [12, 13, 14, 15, 16], // MetalWorks, SteelCraft, AlloySupply, PrecisionParts, PackagePro
  'Logistics': [17], // LogiTrans
  'QA/Testing': [18], // QualityCert
  'Safety': [19], // SafetyFirst
  'Sustainable': [20], // GreenSupply
};

// Get vendors suitable for a product category
function getVendorsForCategory(category: ProductData['category']): number[] {
  if (category === 'IT/Electronics') {
    return [...vendorsBySector['IT/Electronics'], 20]; // Include GreenSupply for sustainable IT
  } else if (category === 'Office Supplies') {
    return [...vendorsBySector['Office Supplies'], 20]; // Include GreenSupply
  } else {
    return [...vendorsBySector['Manufacturing'], ...vendorsBySector['Logistics'], ...vendorsBySector['Safety']];
  }
}

// Select random items from array
function selectRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, arr.length));
}

// Custom scoring weight configurations
const scoringConfigurations: Array<{ name: string; weights: ScoringWeights }> = [
  {
    name: 'Price-focused',
    weights: { price: 45, delivery: 15, paymentTerms: 10, vendorRating: 15, pastPerformance: 10, qualityCertifications: 5 },
  },
  {
    name: 'Quality-focused',
    weights: { price: 25, delivery: 15, paymentTerms: 10, vendorRating: 25, pastPerformance: 15, qualityCertifications: 10 },
  },
  {
    name: 'Delivery-focused',
    weights: { price: 25, delivery: 35, paymentTerms: 10, vendorRating: 15, pastPerformance: 10, qualityCertifications: 5 },
  },
  {
    name: 'Balanced',
    weights: DEFAULT_SCORING_WEIGHTS,
  },
  {
    name: 'Partnership-focused',
    weights: { price: 20, delivery: 15, paymentTerms: 15, vendorRating: 25, pastPerformance: 20, qualityCertifications: 5 },
  },
];

// Requisition templates
const requisitionTemplates = [
  // IT/Electronics RFQs (5)
  {
    title: 'Server Infrastructure Procurement',
    description: 'Procurement of enterprise servers and storage systems for data center upgrade',
    category: 'IT/Electronics' as const,
    productCount: 3,
    vendorCount: 3,
    priority: 'High' as const,
  },
  {
    title: 'Laptop Fleet Renewal',
    description: 'Replacing end-of-life laptops for development and sales teams',
    category: 'IT/Electronics' as const,
    productCount: 2,
    vendorCount: 4,
    priority: 'Medium' as const,
  },
  {
    title: 'Network Equipment Upgrade',
    description: 'Switches and security appliances for network modernization',
    category: 'IT/Electronics' as const,
    productCount: 2,
    vendorCount: 3,
    priority: 'High' as const,
  },
  {
    title: 'Conference Room Technology',
    description: 'Video conferencing equipment for meeting rooms',
    category: 'IT/Electronics' as const,
    productCount: 2,
    vendorCount: 2,
    priority: 'Low' as const,
  },
  {
    title: 'Printing Equipment Refresh',
    description: 'Enterprise printers and multifunction devices',
    category: 'IT/Electronics' as const,
    productCount: 2,
    vendorCount: 3,
    priority: 'Medium' as const,
  },
  // Office Supplies RFQs (5)
  {
    title: 'Annual Office Paper Supply',
    description: 'Bulk procurement of paper and printing supplies',
    category: 'Office Supplies' as const,
    productCount: 3,
    vendorCount: 3,
    priority: 'Medium' as const,
  },
  {
    title: 'Ergonomic Furniture Program',
    description: 'Standing desks and ergonomic chairs for employee wellness',
    category: 'Office Supplies' as const,
    productCount: 3,
    vendorCount: 3,
    priority: 'Medium' as const,
  },
  {
    title: 'Office Equipment Maintenance',
    description: 'Replacement parts and supplies for office equipment',
    category: 'Office Supplies' as const,
    productCount: 4,
    vendorCount: 2,
    priority: 'Low' as const,
  },
  {
    title: 'Filing and Storage Solutions',
    description: 'Filing cabinets and storage for records management',
    category: 'Office Supplies' as const,
    productCount: 2,
    vendorCount: 2,
    priority: 'Low' as const,
  },
  {
    title: 'Presentation Equipment',
    description: 'Whiteboards, easels, and presentation supplies',
    category: 'Office Supplies' as const,
    productCount: 2,
    vendorCount: 2,
    priority: 'Low' as const,
  },
  // Manufacturing RFQs (5)
  {
    title: 'Raw Materials - Steel and Aluminum',
    description: 'Metal stock for Q1 production runs',
    category: 'Manufacturing' as const,
    productCount: 3,
    vendorCount: 4,
    priority: 'High' as const,
  },
  {
    title: 'Safety Equipment Annual Order',
    description: 'PPE and safety supplies for manufacturing floor',
    category: 'Manufacturing' as const,
    productCount: 3,
    vendorCount: 3,
    priority: 'High' as const,
  },
  {
    title: 'Machine Shop Tooling',
    description: 'CNC tooling and measuring instruments',
    category: 'Manufacturing' as const,
    productCount: 4,
    vendorCount: 3,
    priority: 'Medium' as const,
  },
  {
    title: 'Industrial Lubricants Supply',
    description: 'Hydraulic oils and cutting fluids for machinery',
    category: 'Manufacturing' as const,
    productCount: 2,
    vendorCount: 2,
    priority: 'Medium' as const,
  },
  {
    title: 'Packaging Materials Procurement',
    description: 'Shipping boxes and pallet wrap for distribution',
    category: 'Manufacturing' as const,
    productCount: 2,
    vendorCount: 2,
    priority: 'Low' as const,
  },
];

// Status distribution
const statusDistribution: RequisitionData['status'][] = [
  'Draft', 'Draft', 'Draft', 'Draft', 'Draft',
  'NegotiationStarted', 'NegotiationStarted', 'NegotiationStarted', 'NegotiationStarted', 'NegotiationStarted',
  'Awarded', 'Awarded', 'Awarded',
  'Expired', 'Expired',
];

// Generate requisitions
export const allRequisitions: RequisitionData[] = [];

requisitionTemplates.forEach((template, index) => {
  const status = statusDistribution[index];
  const deadlines = generateDeadlines(status);
  const scoringConfig = scoringConfigurations[index % scoringConfigurations.length];

  // Select a project for this requisition
  const availableProjects = allProjects.filter(p => p.status === 'Active' || status === 'Awarded' || status === 'Expired');
  const project = availableProjects[index % availableProjects.length];

  // Get products for this category
  const categoryProducts = getProductsByCategory(template.category);
  const selectedProducts = selectRandom(categoryProducts, template.productCount);

  // Build product list with quantities and target prices
  const products: RequisitionProductData[] = selectedProducts.map(product => ({
    productId: product.id,
    quantity: Math.floor(Math.random() * 20) + 5, // 5-25 units
    targetUnitPrice: product.basePrice * (0.9 + Math.random() * 0.15), // 90-105% of base
    specifications: product.specifications ? JSON.stringify(product.specifications) : undefined,
  }));

  // Get vendors for this category
  const availableVendors = getVendorsForCategory(template.category);
  const selectedVendorIds = selectRandom(availableVendors, template.vendorCount);
  const vendors: RequisitionVendorData[] = selectedVendorIds.map(vendorId => ({
    vendorCompanyId: vendorId,
    invitedAt: status === 'Draft' ? daysFromNow(0) : daysFromNow(-Math.floor(Math.random() * 30)),
  }));

  // Calculate estimated value
  const estimatedValue = products.reduce(
    (sum, p) => sum + p.targetUnitPrice * p.quantity,
    0
  );

  // Determine created date based on status
  let createdAt: Date;
  if (status === 'Draft') {
    createdAt = daysFromNow(-Math.floor(Math.random() * 7)); // Last week
  } else if (status === 'NegotiationStarted') {
    createdAt = daysFromNow(-Math.floor(Math.random() * 30) - 7); // 7-37 days ago
  } else if (status === 'Awarded') {
    createdAt = daysFromNow(-Math.floor(Math.random() * 60) - 30); // 30-90 days ago
  } else {
    createdAt = daysFromNow(-Math.floor(Math.random() * 30) - 60); // 60-90 days ago
  }

  allRequisitions.push({
    id: index + 1,
    rfqId: generateRfqId(index + 1),
    title: template.title,
    description: template.description,
    projectId: project.id,
    companyId: project.companyId,
    createdById: project.createdById,
    status,
    priority: template.priority,
    deliveryDate: deadlines.deliveryDate,
    maxDeliveryDate: deadlines.maxDeliveryDate,
    negotiationClosureDate: deadlines.negotiationClosureDate,
    createdAt,
    estimatedValue: Math.round(estimatedValue * 100) / 100,
    scoringWeights: scoringConfig.weights,
    products,
    vendors,
  });
});

// Helper functions
export const getRequisitionById = (id: number): RequisitionData | undefined =>
  allRequisitions.find(r => r.id === id);

export const getRequisitionByRfqId = (rfqId: string): RequisitionData | undefined =>
  allRequisitions.find(r => r.rfqId === rfqId);

export const getRequisitionsByCompany = (companyId: number): RequisitionData[] =>
  allRequisitions.filter(r => r.companyId === companyId);

export const getRequisitionsByStatus = (status: RequisitionData['status']): RequisitionData[] =>
  allRequisitions.filter(r => r.status === status);

export const getRequisitionsByProject = (projectId: number): RequisitionData[] =>
  allRequisitions.filter(r => r.projectId === projectId);

export const getActiveRequisitions = (): RequisitionData[] =>
  allRequisitions.filter(r => r.status === 'NegotiationStarted' || r.status === 'Created');

export const getDraftRequisitions = (): RequisitionData[] =>
  allRequisitions.filter(r => r.status === 'Draft');

export const getAwardedRequisitions = (): RequisitionData[] =>
  allRequisitions.filter(r => r.status === 'Awarded');

export const getRequisitionsForVendor = (vendorCompanyId: number): RequisitionData[] =>
  allRequisitions.filter(r => r.vendors.some(v => v.vendorCompanyId === vendorCompanyId));

// Get requisitions with specific vendor count (for testing different scenarios)
export const getRequisitionsByVendorCount = (minVendors: number, maxVendors: number): RequisitionData[] =>
  allRequisitions.filter(r => r.vendors.length >= minVendors && r.vendors.length <= maxVendors);

// Get high-value requisitions (for approval workflow testing)
export const getHighValueRequisitions = (minValue: number = 50000): RequisitionData[] =>
  allRequisitions.filter(r => r.estimatedValue >= minValue);
