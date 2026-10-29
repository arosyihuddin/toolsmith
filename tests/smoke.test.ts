import { describe, expect, test } from "bun:test";
import { createServer } from "../src/mcp/server";

describe("Toolsmith server", () => {
  test("creates an MCP server", () => {
    expect(createServer()).toBeDefined();
  });
});
