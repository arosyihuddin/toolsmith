import { describe, expect, test } from "bun:test";
import { isSameOriginRequest, isSecureRequest, readCookie, requestOrigin } from "../src/lib/auth-security";

describe("administrator request security helpers", () => {
  test("matches direct HTTPS origins", () => {
    const request = new Request("https://toolsmith.example.com/admin/token", {
      method: "POST",
      headers: { origin: "https://toolsmith.example.com" },
    });
    expect(isSameOriginRequest(request)).toBe(true);
    expect(isSecureRequest(request)).toBe(true);
  });

  test("matches HTTPS origins behind a reverse proxy", () => {
    const request = new Request("http://127.0.0.1:48766/admin/token", {
      method: "POST",
      headers: {
        host: "127.0.0.1:48766",
        "x-forwarded-host": "toolsmith.example.com",
        "x-forwarded-proto": "https",
        origin: "https://toolsmith.example.com",
      },
    });
    expect(requestOrigin(request)).toBe("https://toolsmith.example.com");
    expect(isSameOriginRequest(request)).toBe(true);
    expect(isSecureRequest(request)).toBe(true);
  });

  test("rejects missing and cross-origin browser request metadata", () => {
    expect(isSameOriginRequest(new Request("https://toolsmith.example.com/admin/token", { method: "POST" }))).toBe(false);
    expect(isSameOriginRequest(new Request("https://toolsmith.example.com/admin/token", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
    }))).toBe(false);
  });

  test("uses Referer when Origin is unavailable", () => {
    expect(isSameOriginRequest(new Request("http://localhost:48766/setup", {
      method: "POST",
      headers: { referer: "http://localhost:48766/" },
    }))).toBe(true);
  });

  test("parses cookie values without matching similarly named cookies", () => {
    const request = new Request("https://toolsmith.example.com", {
      headers: { cookie: "other=abc; toolsmith_session=secret-token; toolsmith_session_extra=no" },
    });
    expect(readCookie(request, "toolsmith_session")).toBe("secret-token");
    expect(readCookie(request, "missing")).toBe("");
  });
});
