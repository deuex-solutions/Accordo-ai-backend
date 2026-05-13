/**
 * ID generation utility functions for seed data
 */

import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

/**
 * Generate a UUID
 */
export function generateUUID(): string {
  return uuidv4();
}

/**
 * Generate a unique token (32 characters)
 */
export function generateUniqueToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Generate a formatted ID with prefix
 * e.g., PRO0001, RFQ0001, PO-2026-001
 */
export function generateFormattedId(prefix: string, number: number, padding: number = 4): string {
  return `${prefix}${String(number).padStart(padding, '0')}`;
}

/**
 * Generate RFQ ID
 */
export function generateRfqId(number: number): string {
  return generateFormattedId('RFQ', number);
}

/**
 * Generate Project ID
 */
export function generateProjectId(number: number): string {
  return generateFormattedId('PRO', number);
}

/**
 * Generate PO Number
 */
export function generatePoNumber(year: number, number: number): string {
  return `PO-${year}-${String(number).padStart(3, '0')}`;
}

/**
 * Generate email based on role and company/domain
 */
export function generateEmail(role: string, domain: string): string {
  const roleEmails: Record<string, string> = {
    admin: 'admin',
    procurement: 'procurement',
    pm: 'pm',
    manager: 'manager',
    director: 'director',
    vp: 'vp',
    sales: 'sales',
    accounts: 'accounts',
    orders: 'orders',
    support: 'support',
  };

  const prefix = roleEmails[role.toLowerCase()] || role.toLowerCase();
  return `${prefix}@${domain}`;
}

/**
 * Generate a batch of sequential IDs
 */
export function generateSequentialIds(start: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => start + i);
}
