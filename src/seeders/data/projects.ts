/**
 * Projects seed data - 12 projects across 4 enterprise companies
 * Each enterprise company gets 3 projects with different statuses
 */

import { daysFromNow, randomPastYearDate } from '../helpers/date-utils.js';
import { generateProjectId } from '../helpers/id-generator.js';
import { enterpriseCompanies } from './companies.js';

export interface ProjectData {
  id: number;
  projectId: string;
  name: string;
  description: string;
  companyId: number;
  status: 'Active' | 'Completed' | 'OnHold' | 'Cancelled';
  budget: number;
  startDate: Date;
  endDate: Date;
  createdById: number; // User who created the project
  category: 'IT Infrastructure' | 'Facilities' | 'Operations' | 'R&D' | 'Expansion';
}

// Project templates for each enterprise company
const projectTemplates: Record<string, Array<{ name: string; description: string; category: ProjectData['category']; budget: number }>> = {
  'Accordo Technologies': [
    {
      name: 'IT Infrastructure Upgrade 2025-2026',
      description: 'Complete overhaul of server infrastructure and networking equipment',
      category: 'IT Infrastructure',
      budget: 250000,
    },
    {
      name: 'Office Modernization Q1 2026',
      description: 'Upgrading office equipment, furniture, and collaboration tools',
      category: 'Facilities',
      budget: 75000,
    },
    {
      name: 'Development Tool Refresh',
      description: 'Procurement of development tools and software licenses',
      category: 'IT Infrastructure',
      budget: 50000,
    },
  ],
  'BuildRight Construction': [
    {
      name: 'Safety Equipment Procurement 2026',
      description: 'Annual procurement of PPE and safety equipment for all sites',
      category: 'Operations',
      budget: 120000,
    },
    {
      name: 'Heavy Equipment Maintenance',
      description: 'Spare parts and maintenance supplies for construction equipment',
      category: 'Operations',
      budget: 180000,
    },
    {
      name: 'New Site Setup - Houston',
      description: 'Equipment and supplies for new construction site',
      category: 'Expansion',
      budget: 300000,
    },
  ],
  'MediCore Health Systems': [
    {
      name: 'Medical Equipment Upgrade',
      description: 'Upgrading diagnostic and patient care equipment',
      category: 'Operations',
      budget: 500000,
    },
    {
      name: 'IT Security Enhancement',
      description: 'Healthcare compliance and security infrastructure upgrade',
      category: 'IT Infrastructure',
      budget: 150000,
    },
    {
      name: 'Research Lab Supplies',
      description: 'Procurement of lab equipment and consumables',
      category: 'R&D',
      budget: 200000,
    },
  ],
  'EduFirst Learning Corp': [
    {
      name: 'Campus Technology Refresh',
      description: 'Updating computer labs and classroom technology',
      category: 'IT Infrastructure',
      budget: 175000,
    },
    {
      name: 'Furniture Replacement Program',
      description: 'Replacing classroom and office furniture',
      category: 'Facilities',
      budget: 80000,
    },
    {
      name: 'Learning Resource Materials',
      description: 'Educational materials and supplies procurement',
      category: 'Operations',
      budget: 45000,
    },
  ],
};

// Status distribution: 2 Active, 1 Completed per company
const statusDistribution: ProjectData['status'][] = ['Active', 'Active', 'Completed'];

// Generate projects
let projectNumber = 1;
export const allProjects: ProjectData[] = [];

enterpriseCompanies.forEach((company, companyIndex) => {
  const templates = projectTemplates[company.companyName];
  if (!templates) return;

  templates.forEach((template, templateIndex) => {
    const status = statusDistribution[templateIndex];
    const isCompleted = status === 'Completed';

    // Get user ID for the procurement user of this company
    // Enterprise users: 6 per company, procurement is index 1 (after admin)
    const createdById = companyIndex * 6 + 2; // +1 for admin, +1 for 1-based ID

    allProjects.push({
      id: projectNumber,
      projectId: generateProjectId(projectNumber),
      name: template.name,
      description: template.description,
      companyId: company.id,
      status,
      budget: template.budget,
      startDate: isCompleted ? randomPastYearDate() : daysFromNow(-30),
      endDate: isCompleted ? daysFromNow(-7) : daysFromNow(90),
      createdById,
      category: template.category,
    });

    projectNumber++;
  });
});

// Helper functions
export const getProjectById = (id: number): ProjectData | undefined =>
  allProjects.find(p => p.id === id);

export const getProjectByProjectId = (projectId: string): ProjectData | undefined =>
  allProjects.find(p => p.projectId === projectId);

export const getProjectsByCompany = (companyId: number): ProjectData[] =>
  allProjects.filter(p => p.companyId === companyId);

export const getProjectsByStatus = (status: ProjectData['status']): ProjectData[] =>
  allProjects.filter(p => p.status === status);

export const getActiveProjects = (): ProjectData[] =>
  allProjects.filter(p => p.status === 'Active');

export const getProjectsByCategory = (category: ProjectData['category']): ProjectData[] =>
  allProjects.filter(p => p.category === category);

// Get projects suitable for a specific product category
export const getProjectsForProductCategory = (productCategory: 'IT/Electronics' | 'Office Supplies' | 'Manufacturing'): ProjectData[] => {
  const categoryMapping: Record<string, ProjectData['category'][]> = {
    'IT/Electronics': ['IT Infrastructure', 'R&D'],
    'Office Supplies': ['Facilities', 'Operations'],
    'Manufacturing': ['Operations', 'R&D', 'Expansion'],
  };

  const projectCategories = categoryMapping[productCategory] || [];
  return allProjects.filter(p => projectCategories.includes(p.category) && p.status === 'Active');
};
