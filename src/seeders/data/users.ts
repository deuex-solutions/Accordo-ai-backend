/**
 * Users seed data - 60 total users
 * - 6 users per enterprise company (4 companies × 6 = 24)
 * - 2 users per vendor company (16 vendors × 2 = 32)
 * - 4 system/test users
 */

import { generateEmail } from '../helpers/id-generator.js';
import { enterpriseCompanies, vendorCompanies } from './companies.js';

export interface UserData {
  id: number;
  name: string;
  email: string;
  password: string;
  type: 'super_admin' | 'admin' | 'procurement' | 'vendor';
  role: string;
  companyId: number;
  isActive: boolean;
  approvalLimit?: number; // For Manager/Director/VP
  isProtected?: boolean; // Protected users cannot be deleted or have their role changed
}

// Standard passwords by role
export const ROLE_PASSWORDS = {
  admin: 'Admin@2026!',
  procurement: 'Procure@2026!',
  pm: 'Project@2026!',
  manager: 'Manager@2026!',
  director: 'Director@2026!',
  vp: 'Executive@2026!',
  sales: 'Vendor@2026!',
  accounts: 'Vendor@2026!',
};

// Enterprise role definitions with approval limits
const enterpriseRoles = [
  { role: 'admin', name: 'Admin', type: 'admin' as const, approvalLimit: undefined },
  { role: 'procurement', name: 'Procurement Officer', type: 'procurement' as const, approvalLimit: undefined },
  { role: 'pm', name: 'Project Manager', type: 'procurement' as const, approvalLimit: undefined },
  { role: 'manager', name: 'Procurement Manager', type: 'procurement' as const, approvalLimit: 10000 },
  { role: 'director', name: 'Procurement Director', type: 'procurement' as const, approvalLimit: 50000 },
  { role: 'vp', name: 'VP Procurement', type: 'procurement' as const, approvalLimit: 500000 },
];

// Vendor role definitions
const vendorRoles = [
  { role: 'sales', name: 'Sales Representative', type: 'vendor' as const },
  { role: 'accounts', name: 'Accounts Manager', type: 'vendor' as const },
];

// Generate domain from company name
function getDomain(companyName: string): string {
  const domainMap: Record<string, string> = {
    'Accordo Technologies': 'accordo.ai',
    'BuildRight Construction': 'buildright.com',
    'MediCore Health Systems': 'medicore.com',
    'EduFirst Learning Corp': 'edufirst.edu',
    'TechSupply Corp': 'techsupply.com',
    'GlobalParts Inc': 'globalparts.eu',
    'ServerDirect USA': 'serverdirect.us',
    'CloudSoft Solutions': 'cloudsoft.io',
    'OfficeMax Pro': 'officemaxpro.com',
    'FurniturePlus Ltd': 'furnitureplus.com',
    'WorkSpace Designs': 'workspacedesigns.eu',
    'MetalWorks Global': 'metalworksglobal.com',
    'SteelCraft Industries': 'steelcraft.in',
    'AlloySupply Co': 'alloysupply.com',
    'PrecisionParts Inc': 'precisionparts.com',
    'PackagePro Solutions': 'packagepro.com',
    'LogiTrans Shipping': 'logitrans.com',
    'QualityCert Labs': 'qualitycert.com',
    'SafetyFirst Equipment': 'safetyfirst.com',
    'GreenSupply Eco': 'greensupply.eco',
  };
  return domainMap[companyName] || companyName.toLowerCase().replace(/\s+/g, '') + '.com';
}

// Name generator for realistic user names
const firstNames = [
  'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
  'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
  'Thomas', 'Sarah', 'Charles', 'Karen', 'Christopher', 'Nancy', 'Daniel', 'Lisa',
  'Matthew', 'Betty', 'Anthony', 'Margaret', 'Mark', 'Sandra', 'Donald', 'Ashley',
  'Steven', 'Kimberly', 'Paul', 'Emily', 'Andrew', 'Donna', 'Joshua', 'Michelle',
];

const lastNames = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
  'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker',
  'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
];

function generateName(index: number): string {
  const firstName = firstNames[index % firstNames.length];
  const lastName = lastNames[(index * 7) % lastNames.length];
  return `${firstName} ${lastName}`;
}

// Generate enterprise users (6 per company)
let userId = 1;
export const enterpriseUsers: UserData[] = [];

enterpriseCompanies.forEach((company, companyIndex) => {
  const domain = getDomain(company.companyName);

  enterpriseRoles.forEach((roleConfig, roleIndex) => {
    const nameIndex = companyIndex * 6 + roleIndex;
    enterpriseUsers.push({
      id: userId++,
      name: generateName(nameIndex),
      email: generateEmail(roleConfig.role, domain),
      password: ROLE_PASSWORDS[roleConfig.role as keyof typeof ROLE_PASSWORDS],
      type: roleConfig.type,
      role: roleConfig.name,
      companyId: company.id,
      isActive: true,
      approvalLimit: roleConfig.approvalLimit,
    });
  });
});

// Generate vendor users (2 per company)
export const vendorUsers: UserData[] = [];

vendorCompanies.forEach((company, companyIndex) => {
  const domain = getDomain(company.companyName);

  vendorRoles.forEach((roleConfig, roleIndex) => {
    const nameIndex = 24 + companyIndex * 2 + roleIndex; // Start after enterprise users
    vendorUsers.push({
      id: userId++,
      name: generateName(nameIndex),
      email: generateEmail(roleConfig.role, domain),
      password: ROLE_PASSWORDS[roleConfig.role as keyof typeof ROLE_PASSWORDS],
      type: roleConfig.type,
      role: roleConfig.name,
      companyId: company.id,
      isActive: true,
    });
  });
});

// System/test users for development
export const systemUsers: UserData[] = [
  {
    id: userId++,
    name: 'Super Admin',
    email: 'superadmin@accordo.ai',
    password: 'SuperAdmin@2026!',
    type: 'admin',
    role: 'Super Administrator',
    companyId: 1, // Accordo Technologies
    isActive: true,
    approvalLimit: 999999999,
  },
  {
    id: userId++,
    name: 'Test Buyer',
    email: 'testbuyer@accordo.ai',
    password: 'TestBuyer@2026!',
    type: 'procurement',
    role: 'Test Buyer',
    companyId: 1,
    isActive: true,
  },
  {
    id: userId++,
    name: 'Test Vendor',
    email: 'testvendor@techsupply.com',
    password: 'TestVendor@2026!',
    type: 'vendor',
    role: 'Test Vendor',
    companyId: 5, // TechSupply Corp
    isActive: true,
  },
  {
    id: userId++,
    name: 'Demo User',
    email: 'demo@accordo.ai',
    password: 'Demo@2026!',
    type: 'procurement',
    role: 'Demo User',
    companyId: 1,
    isActive: true,
  },
  // Easy test login with simple credentials
  {
    id: userId++,
    name: 'Test Superuser',
    email: 'test@test.com',
    password: 'test123',
    type: 'admin',
    role: 'Super Administrator',
    companyId: 1, // Accordo Technologies
    isActive: true,
    approvalLimit: 999999999,
  },
  // AK Super Admin - Protected user (cannot be deleted or have role changed)
  {
    id: userId++,
    name: 'AK Super Admin',
    email: 'ak75963@gmail.com',
    password: 'Welcome@56',
    type: 'super_admin',
    role: 'Super Administrator',
    companyId: 1, // Accordo Technologies
    isActive: true,
    approvalLimit: 999999999,
    isProtected: true,
  },
];

// Combined list
export const allUsers: UserData[] = [...enterpriseUsers, ...vendorUsers, ...systemUsers];

// Helper functions
export const getUserById = (id: number): UserData | undefined =>
  allUsers.find(u => u.id === id);

export const getUsersByCompany = (companyId: number): UserData[] =>
  allUsers.filter(u => u.companyId === companyId);

export const getUsersByType = (type: 'super_admin' | 'admin' | 'procurement' | 'vendor'): UserData[] =>
  allUsers.filter(u => u.type === type);

export const getApprovers = (): UserData[] =>
  allUsers.filter(u => u.approvalLimit !== undefined && u.approvalLimit > 0);

export const getProcurementUsers = (): UserData[] =>
  enterpriseUsers.filter(u => u.role.includes('Procurement') || u.role.includes('Project'));

export const getVendorSalesUsers = (): UserData[] =>
  vendorUsers.filter(u => u.role === 'Sales Representative');

// Get user by email for login testing
export const getUserByEmail = (email: string): UserData | undefined =>
  allUsers.find(u => u.email === email);

// Get users with specific approval authority
export const getApproverByLevel = (level: 'manager' | 'director' | 'vp'): UserData[] => {
  const limits = {
    manager: 10000,
    director: 50000,
    vp: 500000,
  };
  return enterpriseUsers.filter(u => u.approvalLimit === limits[level]);
};
