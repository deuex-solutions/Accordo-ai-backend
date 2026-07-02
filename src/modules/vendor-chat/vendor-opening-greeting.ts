/**
 * Time-of-day salutation for the synthetic vendor opening chat message.
 */

import {
  resolveTimeOfDayGreeting,
  NEGOTIATION_GREETING_TIMEZONE,
} from "../../utils/time-of-day-greeting.js";

export type { TimeOfDayGreeting } from "../../utils/time-of-day-greeting.js";
export { NEGOTIATION_GREETING_TIMEZONE as VENDOR_OPENING_GREETING_TIMEZONE };

export function buildVendorOpeningIntro(
  date: Date = new Date(),
  timeZone: string = NEGOTIATION_GREETING_TIMEZONE,
): string {
  const greeting = resolveTimeOfDayGreeting(date, timeZone);
  return `${greeting}. Here is my quotation for this requisition:`;
}

// Re-export for tests that import from this module
export { resolveTimeOfDayGreeting };
