import { describe, it, expect } from "vitest";

describe("adapter DTO", () => {
  it("has no runtime exports because it only defines types", async () => {
    const module = await import("./adapter.js");

    expect(Object.keys(module)).toEqual([]);
  });
});
