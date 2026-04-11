import { describe, it, expect } from "vitest";
import { STANDARD_ANGLE_SLOTS } from "./character.js";

describe("character DTO", () => {
  it("exports the supported standard angle slots in a stable order", () => {
    expect(STANDARD_ANGLE_SLOTS).toEqual([
      "front",
      "back",
      "left-side",
      "right-side",
      "face-closeup",
      "top-down",
    ]);
  });

  it("contains unique slot values for membership checks", () => {
    expect(new Set(STANDARD_ANGLE_SLOTS).size).toBe(STANDARD_ANGLE_SLOTS.length);
    expect(STANDARD_ANGLE_SLOTS).toContain("face-closeup");
    expect(STANDARD_ANGLE_SLOTS).not.toContain("detail-closeup");
  });
});
