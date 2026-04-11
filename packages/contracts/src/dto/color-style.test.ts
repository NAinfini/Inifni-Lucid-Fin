import { describe, it, expect } from "vitest";

describe("color-style DTO", () => {
  it("has no runtime exports because it only defines types", async () => {
    const module = await import("./color-style.js");

    expect(Object.keys(module)).toEqual([]);
  });
});
