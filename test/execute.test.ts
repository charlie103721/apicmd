import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { parseArgs, resolveAuth, stripDuplicateApiPrefix, buildUrl, buildBody } from "../src/execute";
import type { OperationInfo } from "../src/spec";
import type { ApiConfig } from "../src/config";

// ─── parseArgs ───────────────────────────────────────────────────────────────

describe("parseArgs", () => {
  test("parses --key value pairs", () => {
    expect(parseArgs(["--name", "Alice", "--age", "30"])).toEqual({ name: "Alice", age: "30" });
  });

  test("parses --key=value pairs", () => {
    expect(parseArgs(["--name=Alice", "--age=30"])).toEqual({ name: "Alice", age: "30" });
  });

  test("handles --flag without value as true", () => {
    expect(parseArgs(["--verbose"])).toEqual({ verbose: "true" });
  });

  test("handles --flag followed by another --flag", () => {
    expect(parseArgs(["--a", "--b"])).toEqual({ a: "true", b: "true" });
  });

  test("handles mixed formats", () => {
    expect(parseArgs(["--name", "Alice", "--verbose", "--age=30"])).toEqual({
      name: "Alice",
      verbose: "true",
      age: "30",
    });
  });

  test("last value wins for duplicate keys", () => {
    expect(parseArgs(["--name", "Alice", "--name", "Bob"])).toEqual({ name: "Bob" });
  });

  test("handles empty args", () => {
    expect(parseArgs([])).toEqual({});
  });

  test("ignores non-flag args", () => {
    expect(parseArgs(["foo", "bar", "--name", "x"])).toEqual({ name: "x" });
  });

  test("handles --key=value with empty value", () => {
    expect(parseArgs(["--name="])).toEqual({ name: "" });
  });

  test("handles --key=value with equals in value", () => {
    expect(parseArgs(["--query=a=b"])).toEqual({ query: "a=b" });
  });

  // Prototype pollution prevention
  test("blocks __proto__ as space-separated", () => {
    const result = parseArgs(["--__proto__", "polluted"]);
    expect(Object.keys(result)).not.toContain("__proto__");
    expect(Object.getOwnPropertyDescriptor(result, "__proto__")).toBeUndefined();
  });

  test("blocks __proto__ via --key=value", () => {
    const result = parseArgs(["--__proto__=polluted"]);
    expect(Object.keys(result)).not.toContain("__proto__");
  });

  test("blocks constructor", () => {
    const result = parseArgs(["--constructor", "evil"]);
    expect(Object.keys(result)).not.toContain("constructor");
  });

  test("blocks prototype", () => {
    const result = parseArgs(["--prototype=evil"]);
    expect(Object.keys(result)).not.toContain("prototype");
  });

  test("--flag at end of args", () => {
    expect(parseArgs(["--debug"])).toEqual({ debug: "true" });
  });

  test("negative numbers as values work", () => {
    expect(parseArgs(["--offset", "-10"])).toEqual({ offset: "-10" });
  });
});

// ─── resolveAuth ─────────────────────────────────────────────────────────────

describe("resolveAuth", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("returns null when no auth", () => {
    expect(resolveAuth({ name: "t", url: "http://x" })).toBeNull();
  });

  test("returns literal auth as-is", () => {
    expect(resolveAuth({ name: "t", url: "http://x", auth: "Bearer sk-123" })).toBe("Bearer sk-123");
  });

  test("resolves $VAR syntax", () => {
    process.env.MY_TOKEN = "secret123";
    expect(resolveAuth({ name: "t", url: "http://x", auth: "Bearer $MY_TOKEN" })).toBe("Bearer secret123");
  });

  test("resolves ${VAR} syntax", () => {
    process.env.MY_TOKEN = "secret456";
    expect(resolveAuth({ name: "t", url: "http://x", auth: "Bearer ${MY_TOKEN}" })).toBe("Bearer secret456");
  });

  test("replaces missing env var with empty string and warns", () => {
    delete process.env.MISSING_VAR;
    const spy = spyOn(console, "error").mockImplementation(() => {});
    const result = resolveAuth({ name: "t", url: "http://x", auth: "Bearer $MISSING_VAR" });
    expect(result).toBe("Bearer ");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test("resolves multiple env vars", () => {
    process.env.USER_A = "alice";
    process.env.KEY_B = "key123";
    expect(resolveAuth({ name: "t", url: "http://x", auth: "$USER_A:$KEY_B" })).toBe("alice:key123");
  });
});

// ─── stripDuplicateApiPrefix ─────────────────────────────────────────────────

describe("stripDuplicateApiPrefix", () => {
  test("strips /api when baseUrl ends with /api", () => {
    expect(stripDuplicateApiPrefix("https://example.com/api", "/api/users")).toBe("/users");
  });

  test("does not strip when baseUrl doesn't end with /api", () => {
    expect(stripDuplicateApiPrefix("https://example.com", "/api/users")).toBe("/api/users");
  });

  test("does not strip when path doesn't start with /api/", () => {
    expect(stripDuplicateApiPrefix("https://example.com/api", "/users")).toBe("/users");
  });

  test("preserves path when no overlap", () => {
    expect(stripDuplicateApiPrefix("https://example.com/v1", "/v1/users")).toBe("/v1/users");
  });

  test("exact /api match", () => {
    expect(stripDuplicateApiPrefix("https://example.com/api", "/api/v2/items")).toBe("/v2/items");
  });
});

// ─── buildUrl ────────────────────────────────────────────────────────────────

describe("buildUrl", () => {
  test("builds simple URL without params", () => {
    const op: OperationInfo = {
      operationId: "list",
      method: "GET",
      path: "/users",
      pathParams: [],
      queryParams: [],
      requiredBody: [],
    };
    expect(buildUrl("https://api.example.com", op, {})).toBe("https://api.example.com/users");
  });

  test("substitutes path params", () => {
    const op: OperationInfo = {
      operationId: "get",
      method: "GET",
      path: "/users/{userId}",
      pathParams: ["userId"],
      queryParams: [],
      requiredBody: [],
    };
    expect(buildUrl("https://api.example.com", op, { userId: "123" })).toBe(
      "https://api.example.com/users/123"
    );
  });

  test("encodes path params", () => {
    const op: OperationInfo = {
      operationId: "get",
      method: "GET",
      path: "/items/{name}",
      pathParams: ["name"],
      queryParams: [],
      requiredBody: [],
    };
    expect(buildUrl("https://api.example.com", op, { name: "hello world" })).toBe(
      "https://api.example.com/items/hello%20world"
    );
  });

  test("adds query params", () => {
    const op: OperationInfo = {
      operationId: "list",
      method: "GET",
      path: "/users",
      pathParams: [],
      queryParams: [
        { name: "page", required: false },
        { name: "limit", required: false },
      ],
      requiredBody: [],
    };
    const url = buildUrl("https://api.example.com", op, { page: "2", limit: "10" });
    expect(url).toBe("https://api.example.com/users?page=2&limit=10");
  });

  test("encodes query params", () => {
    const op: OperationInfo = {
      operationId: "search",
      method: "GET",
      path: "/search",
      pathParams: [],
      queryParams: [{ name: "q", required: false }],
      requiredBody: [],
    };
    const url = buildUrl("https://api.example.com", op, { q: "hello world" });
    expect(url).toBe("https://api.example.com/search?q=hello%20world");
  });

  test("strips duplicate /api prefix", () => {
    const op: OperationInfo = {
      operationId: "list",
      method: "GET",
      path: "/api/users",
      pathParams: [],
      queryParams: [],
      requiredBody: [],
    };
    expect(buildUrl("https://example.com/api", op, {})).toBe("https://example.com/api/users");
  });

  test("combines path and query params", () => {
    const op: OperationInfo = {
      operationId: "listIssues",
      method: "GET",
      path: "/projects/{pid}/issues",
      pathParams: ["pid"],
      queryParams: [{ name: "status", required: false }],
      requiredBody: [],
    };
    const url = buildUrl("https://api.example.com", op, { pid: "abc", status: "open" });
    expect(url).toBe("https://api.example.com/projects/abc/issues?status=open");
  });
});

// ─── buildBody ───────────────────────────────────────────────────────────────

describe("buildBody", () => {
  test("returns null when no bodySchema", () => {
    const op: OperationInfo = {
      operationId: "test",
      method: "POST",
      path: "/x",
      pathParams: [],
      queryParams: [],
      requiredBody: [],
    };
    expect(buildBody(op, { name: "test" })).toBeNull();
  });

  test("builds body from string params", () => {
    const op: OperationInfo = {
      operationId: "test",
      method: "POST",
      path: "/x",
      pathParams: [],
      queryParams: [],
      bodySchema: {
        properties: { name: { type: "string" }, email: { type: "string" } },
      },
      requiredBody: [],
    };
    expect(buildBody(op, { name: "Alice", email: "a@b.com" })).toEqual({
      name: "Alice",
      email: "a@b.com",
    });
  });

  test("coerces number params", () => {
    const op: OperationInfo = {
      operationId: "test",
      method: "POST",
      path: "/x",
      pathParams: [],
      queryParams: [],
      bodySchema: { properties: { count: { type: "integer" } } },
      requiredBody: [],
    };
    expect(buildBody(op, { count: "42" })).toEqual({ count: 42 });
  });

  test("coerces boolean params", () => {
    const op: OperationInfo = {
      operationId: "test",
      method: "POST",
      path: "/x",
      pathParams: [],
      queryParams: [],
      bodySchema: { properties: { active: { type: "boolean" } } },
      requiredBody: [],
    };
    expect(buildBody(op, { active: "true" })).toEqual({ active: true });
    expect(buildBody(op, { active: "false" })).toEqual({ active: false });
  });

  test("coerces array from JSON", () => {
    const op: OperationInfo = {
      operationId: "test",
      method: "POST",
      path: "/x",
      pathParams: [],
      queryParams: [],
      bodySchema: { properties: { tags: { type: "array" } } },
      requiredBody: [],
    };
    expect(buildBody(op, { tags: '["a","b"]' })).toEqual({ tags: ["a", "b"] });
  });

  test("coerces array from comma-separated", () => {
    const op: OperationInfo = {
      operationId: "test",
      method: "POST",
      path: "/x",
      pathParams: [],
      queryParams: [],
      bodySchema: { properties: { tags: { type: "array" } } },
      requiredBody: [],
    };
    expect(buildBody(op, { tags: "a,b,c" })).toEqual({ tags: ["a", "b", "c"] });
  });

  test("returns null when no matching params", () => {
    const op: OperationInfo = {
      operationId: "test",
      method: "POST",
      path: "/x",
      pathParams: [],
      queryParams: [],
      bodySchema: { properties: { name: { type: "string" } } },
      requiredBody: [],
    };
    expect(buildBody(op, {})).toBeNull();
  });

  test("forwards additional properties when allowed", () => {
    const op: OperationInfo = {
      operationId: "test",
      method: "PATCH",
      path: "/x",
      pathParams: [],
      queryParams: [],
      bodySchema: {
        properties: { name: { type: "string" } },
        additionalProperties: true,
      },
      requiredBody: [],
    };
    expect(buildBody(op, { name: "Alice", extra: "value" })).toEqual({
      name: "Alice",
      extra: "value",
    });
  });

  test("does not forward additional properties when disallowed", () => {
    const op: OperationInfo = {
      operationId: "test",
      method: "PATCH",
      path: "/x",
      pathParams: [],
      queryParams: [],
      bodySchema: {
        properties: { name: { type: "string" } },
        additionalProperties: false,
      },
      requiredBody: [],
    };
    expect(buildBody(op, { name: "Alice", extra: "value" })).toEqual({ name: "Alice" });
  });

  test("additional properties coerces booleans and numbers", () => {
    const op: OperationInfo = {
      operationId: "test",
      method: "PATCH",
      path: "/x",
      pathParams: [],
      queryParams: [],
      bodySchema: { properties: {} },
      requiredBody: [],
    };
    expect(buildBody(op, { flag: "true", count: "5", label: "hi" })).toEqual({
      flag: true,
      count: 5,
      label: "hi",
    });
  });

  test("does not include path/query params as additional properties", () => {
    const op: OperationInfo = {
      operationId: "test",
      method: "POST",
      path: "/items/{id}",
      pathParams: ["id"],
      queryParams: [{ name: "format", required: false }],
      bodySchema: { properties: { name: { type: "string" } } },
      requiredBody: [],
    };
    const result = buildBody(op, { id: "123", format: "json", name: "test", extra: "val" });
    expect(result).toEqual({ name: "test", extra: "val" });
    expect(result.id).toBeUndefined();
    expect(result.format).toBeUndefined();
  });
});
