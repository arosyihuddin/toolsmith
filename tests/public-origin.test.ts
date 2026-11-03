import { describe, expect, test } from "bun:test";
import { resolvePublicOrigin } from "../src/lib/public-origin";

describe("resolvePublicOrigin", () => {
  test("prefers HTTPS reverse-proxy headers over the configured fallback", () => {
    const request = new Request("http://127.0.0.1:48766/.well-known/oauth-authorization-server", {
      headers: {
        host: "127.0.0.1:48766",
        "x-forwarded-host": "toolsmith.example.com",
        "x-forwarded-proto": "https",
      },
    });

    expect(resolvePublicOrigin(request, "https://fallback.example.com")?.origin)
      .toBe("https://toolsmith.example.com");
  });

  test("supports Cloudflare visitor scheme when forwarded proto is absent", () => {
    const request = new Request("http://127.0.0.1:48766/", {
      headers: {
        host: "toolsmith.example.com",
        "cf-visitor": JSON.stringify({ scheme: "https" }),
      },
    });

    expect(resolvePublicOrigin(request, "")?.origin).toBe("https://toolsmith.example.com");
  });

  test("uses the fallback when the proxy does not establish HTTPS", () => {
    const request = new Request("http://127.0.0.1:48766/", {
      headers: {
        host: "toolsmith.example.com",
        "x-forwarded-proto": "http",
      },
    });

    expect(resolvePublicOrigin(request, "https://fallback.example.com")?.origin)
      .toBe("https://fallback.example.com");
  });

  test("returns null when neither a valid HTTPS proxy origin nor fallback exists", () => {
    const request = new Request("http://127.0.0.1:48766/", {
      headers: { host: "toolsmith.example.com" },
    });

    expect(resolvePublicOrigin(request, "")).toBeNull();
  });

  test("rejects malformed and non-origin fallback URLs", () => {
    expect(resolvePublicOrigin(undefined, "http://toolsmith.example.com")).toBeNull();
    expect(resolvePublicOrigin(undefined, "https://user:pass@toolsmith.example.com")).toBeNull();
    expect(resolvePublicOrigin(undefined, "https://toolsmith.example.com/path")).toBeNull();
  });
});
