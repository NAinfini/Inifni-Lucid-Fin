import { describe, it, expect } from "vitest";
import { EQUIPMENT_STANDARD_SLOTS } from "./equipment.js";

describe("equipment DTO", () => {
  it("exports the supported standard equipment slots in a stable order", () => {
    expect(EQUIPMENT_STANDARD_SLOTS).toEqual([
      "front",
      "back",
      "left-side",
      "right-side",
      "detail-closeup",
      "in-use",
    ]);
  });

  it("contains unique slot values for membership checks", () => {
    expect(new Set(EQUIPMENT_STANDARD_SLOTS).size).toBe(EQUIPMENT_STANDARD_SLOTS.length);
    expect(EQUIPMENT_STANDARD_SLOTS).toContain("in-use");
    expect(EQUIPMENT_STANDARD_SLOTS).not.toContain("face-closeup");
  });
});
