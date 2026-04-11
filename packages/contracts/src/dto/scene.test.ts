import { describe, it, expect } from "vitest";

describe("scene DTO", () => {
  it("has no runtime exports because it only defines types", async () => {
    const module = await import("./scene.js");

    expect(Object.keys(module)).toEqual([]);
  });
});
