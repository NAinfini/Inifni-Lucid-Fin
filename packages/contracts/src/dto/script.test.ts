import { describe, it, expect } from "vitest";

describe("script DTO", () => {
  it("has no runtime exports because it only defines types", async () => {
    const module = await import("./script.js");

    expect(Object.keys(module)).toEqual([]);
  });
});
