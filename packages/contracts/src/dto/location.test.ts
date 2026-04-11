import { describe, it, expect } from "vitest";
import { LOCATION_STANDARD_SLOTS } from "./location.js";

describe("location DTO", () => {
  it("exports the supported location reference slots in a stable order", () => {
    expect(LOCATION_STANDARD_SLOTS).toEqual([
      "wide-establishing",
      "interior-detail",
      "atmosphere",
      "key-angle-1",
      "key-angle-2",
      "overhead",
    ]);
  });

  it("contains unique slot values for membership checks", () => {
    expect(new Set(LOCATION_STANDARD_SLOTS).size).toBe(LOCATION_STANDARD_SLOTS.length);
    expect(LOCATION_STANDARD_SLOTS).toContain("overhead");
    expect(LOCATION_STANDARD_SLOTS).not.toContain("in-use");
  });
});
