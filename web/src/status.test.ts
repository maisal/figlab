import { describe, expect, it } from "vitest";
import { statusMessage } from "./status";

describe("statusMessage", () => {
  it("names the app", () => {
    expect(statusMessage()).toContain("figlab");
  });
});
