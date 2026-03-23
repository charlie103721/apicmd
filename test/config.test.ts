import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// We test config functions by importing them and overriding CONFIG_DIR via env or direct call.
// Since CONFIG_DIR is hardcoded, we test safeName, getBaseUrl, isSpecStale as pure functions,
// and test saveConfig/loadConfig/listConfigs/recordCall with a temp dir override.

import { safeName, getBaseUrl, isSpecStale } from "../src/config";
import type { ApiConfig } from "../src/config";

// ─── safeName ────────────────────────────────────────────────────────────────

describe("safeName", () => {
  test("accepts valid names", () => {
    expect(safeName("my-api")).toBe("my-api");
    expect(safeName("myApi123")).toBe("myApi123");
    expect(safeName("test_api")).toBe("test_api");
    expect(safeName("A")).toBe("A");
    expect(safeName("a-b-c_d")).toBe("a-b-c_d");
  });

  test("rejects empty string", () => {
    expect(() => safeName("")).toThrow();
  });

  test("rejects path traversal", () => {
    expect(() => safeName("../etc/passwd")).toThrow();
    expect(() => safeName("../../evil")).toThrow();
    expect(() => safeName("foo/bar")).toThrow();
  });

  test("rejects special characters", () => {
    expect(() => safeName("my api")).toThrow();
    expect(() => safeName("my.api")).toThrow();
    expect(() => safeName("my@api")).toThrow();
    expect(() => safeName("my!api")).toThrow();
    expect(() => safeName("名前")).toThrow();
  });

  test("rejects names with dots", () => {
    expect(() => safeName("config.json")).toThrow();
    expect(() => safeName(".hidden")).toThrow();
  });
});

// ─── getBaseUrl ──────────────────────────────────────────────────────────────

describe("getBaseUrl", () => {
  test("extracts protocol + host for simple URL", () => {
    const config: ApiConfig = { name: "test", url: "https://api.example.com" };
    expect(getBaseUrl(config)).toBe("https://api.example.com");
  });

  test("strips OpenAPI spec filename", () => {
    const config: ApiConfig = { name: "test", url: "https://api.example.com/openapi.json" };
    expect(getBaseUrl(config)).toBe("https://api.example.com");
  });

  test("strips swagger.json", () => {
    const config: ApiConfig = { name: "test", url: "https://api.example.com/v2/swagger.json" };
    expect(getBaseUrl(config)).toBe("https://api.example.com/v2");
  });

  test("strips openapi.yaml", () => {
    const config: ApiConfig = { name: "test", url: "https://api.example.com/openapi.yaml" };
    expect(getBaseUrl(config)).toBe("https://api.example.com");
  });

  test("strips swagger.yml case-insensitive", () => {
    const config: ApiConfig = { name: "test", url: "https://api.example.com/Swagger.YML" };
    expect(getBaseUrl(config)).toBe("https://api.example.com");
  });

  test("preserves path for non-spec URLs", () => {
    const config: ApiConfig = { name: "test", url: "https://api.example.com/v1/api-docs" };
    expect(getBaseUrl(config)).toBe("https://api.example.com/v1/api-docs");
  });

  test("preserves path in raw mode", () => {
    const config: ApiConfig = { name: "test", url: "https://api.example.com/v1/openapi.json", raw: true };
    expect(getBaseUrl(config)).toBe("https://api.example.com/v1/openapi.json");
  });

  test("removes trailing slash", () => {
    const config: ApiConfig = { name: "test", url: "https://api.example.com/" };
    expect(getBaseUrl(config)).toBe("https://api.example.com");
  });

  test("handles invalid URL gracefully", () => {
    const config: ApiConfig = { name: "test", url: "not-a-url" };
    expect(getBaseUrl(config)).toBe("not-a-url");
  });

  test("preserves port", () => {
    const config: ApiConfig = { name: "test", url: "http://localhost:3000/openapi.json" };
    expect(getBaseUrl(config)).toBe("http://localhost:3000");
  });

  test("preserves deep path", () => {
    const config: ApiConfig = { name: "test", url: "https://api.example.com/api/v1/openapi.json" };
    expect(getBaseUrl(config)).toBe("https://api.example.com/api/v1");
  });
});

// ─── isSpecStale ─────────────────────────────────────────────────────────────

describe("isSpecStale", () => {
  test("returns true when no spec", () => {
    const config: ApiConfig = { name: "test", url: "https://example.com" };
    expect(isSpecStale(config)).toBe(true);
  });

  test("returns true when no specFetchedAt", () => {
    const config: ApiConfig = { name: "test", url: "https://example.com", spec: {} };
    expect(isSpecStale(config)).toBe(true);
  });

  test("returns false for recently fetched spec", () => {
    const config: ApiConfig = {
      name: "test",
      url: "https://example.com",
      spec: {},
      specFetchedAt: new Date().toISOString(),
    };
    expect(isSpecStale(config)).toBe(false);
  });

  test("returns true for old spec", () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25 hours ago
    const config: ApiConfig = {
      name: "test",
      url: "https://example.com",
      spec: {},
      specFetchedAt: old,
    };
    expect(isSpecStale(config)).toBe(true);
  });

  test("respects custom TTL", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const config: ApiConfig = {
      name: "test",
      url: "https://example.com",
      spec: {},
      specFetchedAt: twoHoursAgo,
      specTtlHours: 1, // 1 hour TTL
    };
    expect(isSpecStale(config)).toBe(true);

    config.specTtlHours = 24;
    expect(isSpecStale(config)).toBe(false);
  });

  test("returns true for invalid specFetchedAt", () => {
    const config: ApiConfig = {
      name: "test",
      url: "https://example.com",
      spec: {},
      specFetchedAt: "not-a-date",
    };
    expect(isSpecStale(config)).toBe(true);
  });

  test("returns true for empty specFetchedAt", () => {
    const config: ApiConfig = {
      name: "test",
      url: "https://example.com",
      spec: {},
      specFetchedAt: "",
    };
    expect(isSpecStale(config)).toBe(true);
  });
});
