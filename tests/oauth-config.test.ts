import { describe, expect, test } from "bun:test";
import { preservePublicUrl } from "../src/lib/oauth-config";

describe("preservePublicUrl", () => {
  test("keeps the configured public URL when setup submits an empty value", () => {
    expect(preservePublicUrl("", "https://test-mcp.panca-pu.my.id"))
      .toBe("https://test-mcp.panca-pu.my.id");
  });

  test("keeps the configured public URL when setup omits the field", () => {
    expect(preservePublicUrl("", undefined)).toBe("");
  });

  test("allows an explicitly submitted URL to replace the existing one", () => {
    expect(preservePublicUrl(" https://new.example.com ", "https://old.example.com"))
      .toBe("https://new.example.com");
  });

  test("trims an existing URL when no replacement is submitted", () => {
    expect(preservePublicUrl("", " https://old.example.com "))
      .toBe("https://old.example.com");
  });
});
