import { describe, it, expect } from "vitest";
import {
  buildVendorOpeningIntro,
  resolveTimeOfDayGreeting,
} from "../../../src/modules/vendor-chat/vendor-opening-greeting.js";

/** Build a Date that is the given hour in Asia/Kolkata on a fixed calendar day. */
function kolkataAt(hour: number, minute = 0): Date {
  // 2026-07-02 — use offset +05:30
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return new Date(`2026-07-02T${hh}:${mm}:00+05:30`);
}

describe("resolveTimeOfDayGreeting", () => {
  it("returns Good morning before noon", () => {
    expect(resolveTimeOfDayGreeting(kolkataAt(8))).toBe("Good morning");
    expect(resolveTimeOfDayGreeting(kolkataAt(11, 59))).toBe("Good morning");
  });

  it("returns Good afternoon from noon until 5pm", () => {
    expect(resolveTimeOfDayGreeting(kolkataAt(12, 0))).toBe("Good afternoon");
    expect(resolveTimeOfDayGreeting(kolkataAt(16, 59))).toBe("Good afternoon");
  });

  it("returns Good evening from 5pm onward and before 5am", () => {
    expect(resolveTimeOfDayGreeting(kolkataAt(17, 0))).toBe("Good evening");
    expect(resolveTimeOfDayGreeting(kolkataAt(22, 0))).toBe("Good evening");
    expect(resolveTimeOfDayGreeting(kolkataAt(4, 59))).toBe("Good evening");
  });
});

describe("buildVendorOpeningIntro", () => {
  it("uses time-based greeting and here-is-my-quotation phrasing", () => {
    expect(buildVendorOpeningIntro(kolkataAt(9))).toBe(
      "Good morning. Here is my quotation for this requisition:",
    );
    expect(buildVendorOpeningIntro(kolkataAt(14))).toBe(
      "Good afternoon. Here is my quotation for this requisition:",
    );
    expect(buildVendorOpeningIntro(kolkataAt(19))).toBe(
      "Good evening. Here is my quotation for this requisition:",
    );
  });
});
