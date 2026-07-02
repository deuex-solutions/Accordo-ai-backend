/**
 * Time-of-day salutations for negotiation openers (vendor + PM).
 * Uses wall-clock hour in the configured timezone (default: Asia/Kolkata).
 */

export type TimeOfDayGreeting =
  | "Good morning"
  | "Good afternoon"
  | "Good evening";

export const NEGOTIATION_GREETING_TIMEZONE = "Asia/Kolkata";

/**
 * Hour boundaries in local time:
 * - 05:00–11:59 → Good morning
 * - 12:00–16:59 → Good afternoon
 * - 17:00–04:59 → Good evening
 */
export function resolveTimeOfDayGreeting(
  date: Date = new Date(),
  timeZone: string = NEGOTIATION_GREETING_TIMEZONE,
): TimeOfDayGreeting {
  const hour = getHourInTimeZone(date, timeZone);

  if (hour >= 5 && hour < 12) {
    return "Good morning";
  }
  if (hour >= 12 && hour < 17) {
    return "Good afternoon";
  }
  return "Good evening";
}

function getHourInTimeZone(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: false,
  }).formatToParts(date);

  const hourPart = parts.find((p) => p.type === "hour")?.value ?? "0";
  return parseInt(hourPart, 10);
}
