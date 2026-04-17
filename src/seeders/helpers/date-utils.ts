/**
 * Date utility functions for seed data generation
 */

/**
 * Generate a random date within a range
 */
export function randomDateInRange(startDate: Date, endDate: Date): Date {
  const startTime = startDate.getTime();
  const endTime = endDate.getTime();
  const randomTime = startTime + Math.random() * (endTime - startTime);
  return new Date(randomTime);
}

/**
 * Get date relative to today
 */
export function daysFromNow(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

/**
 * Get date relative to a specific date
 */
export function daysFromDate(baseDate: Date, days: number): Date {
  const date = new Date(baseDate);
  date.setDate(date.getDate() + days);
  return date;
}

/**
 * Format date as ISO string (date only)
 */
export function toDateString(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Get a date in the past year (for historical data)
 */
export function randomPastYearDate(): Date {
  const now = new Date();
  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  return randomDateInRange(oneYearAgo, now);
}

/**
 * Get dates for different months in the past year
 */
export function getMonthlyDates(monthsBack: number = 12): Date[] {
  const dates: Date[] = [];
  const now = new Date();

  for (let i = 0; i < monthsBack; i++) {
    const date = new Date(now);
    date.setMonth(date.getMonth() - i);
    dates.push(date);
  }

  return dates;
}

/**
 * Generate deadline dates based on status
 * - deliveryDate: Preferred/target delivery date
 * - maxDeliveryDate: Hard deadline (latest acceptable delivery)
 * - negotiationClosureDate: Deadline for vendor negotiations
 */
export function generateDeadlines(status: string): {
  deliveryDate: Date;
  maxDeliveryDate: Date;
  negotiationClosureDate: Date;
} {
  const now = new Date();

  switch (status) {
    case 'Draft':
    case 'Created':
    case 'NegotiationStarted':
      // Future deadlines
      return {
        deliveryDate: daysFromNow(60),          // Preferred delivery
        maxDeliveryDate: daysFromNow(75),       // Hard deadline (15 days buffer)
        negotiationClosureDate: daysFromNow(30),
      };
    case 'Fulfilled':
    case 'Awarded':
      // Past deadlines (completed)
      return {
        deliveryDate: daysFromNow(-30),
        maxDeliveryDate: daysFromNow(-15),      // Was 15 days after preferred
        negotiationClosureDate: daysFromNow(-60),
      };
    case 'Expired':
    case 'Cancelled':
      // Past deadlines
      return {
        deliveryDate: daysFromNow(-15),
        maxDeliveryDate: daysFromNow(-5),       // Was 10 days after preferred
        negotiationClosureDate: daysFromNow(-45),
      };
    default:
      return {
        deliveryDate: daysFromNow(45),
        maxDeliveryDate: daysFromNow(60),       // 15 days buffer
        negotiationClosureDate: daysFromNow(21),
      };
  }
}
