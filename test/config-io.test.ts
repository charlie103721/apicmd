import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { saveConfig, loadConfig, listConfigs, recordCall } from "../src/config";
import type { ApiConfig } from "../src/config";

// These tests use the real ~/.apicmd directory.
// We use a unique test prefix to avoid collisions.
const TEST_PREFIX = "__test_apicmd_";
const CONFIG_DIR = join(require("os").homedir(), ".apicmd");

function testName(suffix: string) {
  return `${TEST_PREFIX}${suffix}`;
}

function cleanupTestConfigs() {
  if (!existsSync(CONFIG_DIR)) return;
  const fs = require("fs");
  for (const f of fs.readdirSync(CONFIG_DIR)) {
    if (f.startsWith(TEST_PREFIX)) {
      fs.unlinkSync(join(CONFIG_DIR, f));
    }
  }
}

beforeEach(() => cleanupTestConfigs());
afterEach(() => cleanupTestConfigs());

// ─── saveConfig + loadConfig round-trip ──────────────────────────────────────

describe("saveConfig + loadConfig", () => {
  test("round-trips a config", () => {
    const name = testName("roundtrip");
    const config: ApiConfig = { name, url: "https://example.com" };
    saveConfig(config);
    const loaded = loadConfig(name);
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe(name);
    expect(loaded!.url).toBe("https://example.com");
  });

  test("saves and loads with all fields", () => {
    const name = testName("allfields");
    const config: ApiConfig = {
      name,
      url: "https://api.example.com/openapi.json",
      auth: "Bearer $TOKEN",
      spec: { paths: { "/health": { get: {} } } },
      specFetchedAt: "2026-01-01T00:00:00Z",
      specTtlHours: 12,
      raw: false,
      history: [
        { method: "GET", path: "/health", params: [], lastCalled: "2026-01-01T00:00:00Z", callCount: 1, lastStatus: 200 },
      ],
    };
    saveConfig(config);
    const loaded = loadConfig(name);
    expect(loaded!.auth).toBe("Bearer $TOKEN");
    expect(loaded!.specTtlHours).toBe(12);
    expect(loaded!.history).toHaveLength(1);
    expect(loaded!.history![0]!.callCount).toBe(1);
  });

  test("overwrites existing config", () => {
    const name = testName("overwrite");
    saveConfig({ name, url: "https://v1.example.com" });
    saveConfig({ name, url: "https://v2.example.com" });
    const loaded = loadConfig(name);
    expect(loaded!.url).toBe("https://v2.example.com");
  });

  test("returns null for non-existent config", () => {
    expect(loadConfig(testName("missing"))).toBeNull();
  });

  test("config file has restricted permissions (0600)", () => {
    const name = testName("perms");
    saveConfig({ name, url: "https://example.com" });
    const filePath = join(CONFIG_DIR, `${name}.json`);
    const stats = statSync(filePath);
    const mode = (stats.mode & 0o777).toString(8);
    expect(mode).toBe("600");
  });

  test("config file is valid JSON", () => {
    const name = testName("json");
    saveConfig({ name, url: "https://example.com", auth: 'Bearer "quoted"' });
    const raw = readFileSync(join(CONFIG_DIR, `${name}.json`), "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(JSON.parse(raw).auth).toBe('Bearer "quoted"');
  });

  test("rejects path traversal in loadConfig", () => {
    expect(() => loadConfig("../evil")).toThrow();
  });

  test("rejects path traversal in saveConfig", () => {
    expect(() => saveConfig({ name: "../../etc/evil", url: "http://x" })).toThrow();
  });
});

// ─── listConfigs ─────────────────────────────────────────────────────────────

describe("listConfigs", () => {
  test("lists saved configs", () => {
    const name1 = testName("list1");
    const name2 = testName("list2");
    saveConfig({ name: name1, url: "http://a" });
    saveConfig({ name: name2, url: "http://b" });
    const list = listConfigs();
    expect(list).toContain(name1);
    expect(list).toContain(name2);
  });

  test("returns empty-ish when no test configs", () => {
    // Other configs may exist, but our test ones shouldn't after cleanup
    cleanupTestConfigs();
    const list = listConfigs();
    expect(list.filter((n) => n.startsWith(TEST_PREFIX))).toEqual([]);
  });
});

// ─── recordCall ──────────────────────────────────────────────────────────────

describe("recordCall", () => {
  test("creates history entry for new call", () => {
    const name = testName("record1");
    saveConfig({ name, url: "http://x" });
    recordCall(name, "GET", "/users", ["page"], 200);
    const config = loadConfig(name);
    expect(config!.history).toHaveLength(1);
    expect(config!.history![0]!.method).toBe("GET");
    expect(config!.history![0]!.path).toBe("/users");
    expect(config!.history![0]!.params).toEqual(["page"]);
    expect(config!.history![0]!.callCount).toBe(1);
    expect(config!.history![0]!.lastStatus).toBe(200);
  });

  test("increments callCount for same method+path", () => {
    const name = testName("record2");
    saveConfig({ name, url: "http://x" });
    recordCall(name, "GET", "/users", ["page"], 200);
    recordCall(name, "GET", "/users", ["page"], 200);
    recordCall(name, "GET", "/users", ["page"], 200);
    const config = loadConfig(name);
    expect(config!.history).toHaveLength(1);
    expect(config!.history![0]!.callCount).toBe(3);
  });

  test("merges new params into existing entry", () => {
    const name = testName("record3");
    saveConfig({ name, url: "http://x" });
    recordCall(name, "POST", "/items", ["name"], 201);
    recordCall(name, "POST", "/items", ["name", "price"], 201);
    const config = loadConfig(name);
    expect(config!.history![0]!.params).toEqual(["name", "price"]);
  });

  test("does not duplicate existing params", () => {
    const name = testName("record4");
    saveConfig({ name, url: "http://x" });
    recordCall(name, "GET", "/x", ["a", "b"], 200);
    recordCall(name, "GET", "/x", ["b", "c"], 200);
    const config = loadConfig(name);
    expect(config!.history![0]!.params).toEqual(["a", "b", "c"]);
  });

  test("creates separate entries for different methods", () => {
    const name = testName("record5");
    saveConfig({ name, url: "http://x" });
    recordCall(name, "GET", "/users", [], 200);
    recordCall(name, "POST", "/users", ["name"], 201);
    const config = loadConfig(name);
    expect(config!.history).toHaveLength(2);
  });

  test("creates separate entries for different paths", () => {
    const name = testName("record6");
    saveConfig({ name, url: "http://x" });
    recordCall(name, "GET", "/users", [], 200);
    recordCall(name, "GET", "/items", [], 200);
    const config = loadConfig(name);
    expect(config!.history).toHaveLength(2);
  });

  test("updates lastStatus", () => {
    const name = testName("record7");
    saveConfig({ name, url: "http://x" });
    recordCall(name, "GET", "/fail", [], 500);
    recordCall(name, "GET", "/fail", [], 200);
    const config = loadConfig(name);
    expect(config!.history![0]!.lastStatus).toBe(200);
  });

  test("silently does nothing for missing config", () => {
    expect(() => recordCall(testName("nonexistent"), "GET", "/x", [], 200)).not.toThrow();
  });

  test("updates lastCalled timestamp", () => {
    const name = testName("record8");
    saveConfig({ name, url: "http://x" });
    recordCall(name, "GET", "/ts", [], 200);
    const config = loadConfig(name);
    const ts = new Date(config!.history![0]!.lastCalled).getTime();
    expect(Date.now() - ts).toBeLessThan(5000); // within 5 seconds
  });
});
