import { describe, it, expect } from "vitest";

describe("project DTO", () => {
  it("has no runtime exports because it only defines types", async () => {
    const module = await import("./project.js");

    expect(Object.keys(module)).toEqual([]);
  });
});
