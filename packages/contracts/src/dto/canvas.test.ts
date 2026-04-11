import { describe, it, expect } from "vitest";

describe("canvas DTO", () => {
  it("has no runtime exports because it only defines types", async () => {
    const module = await import("./canvas.js");

    expect(Object.keys(module)).toEqual([]);
  });
});
