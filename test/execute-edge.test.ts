import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { parseArgs, resolveAuth, stripDuplicateApiPrefix, buildUrl, buildBody } from "../src/execute";
import type { OperationInfo } from "../src/spec";

// ─── parseArgs edge cases ────────────────────────────────────────────────────

describe("parseArgs edge cases", () => {
  test("single arg with no dashes is ignored", () => {
    expect(parseArgs(["value"])).toEqual({});
  });

  test("single dash arg is ignored", () => {
    expect(parseArgs(["-v"])).toEqual({});
  });

  test("empty string arg is ignored", () => {
    expect(parseArgs([""])).toEqual({});
  });

  test("handles very long key names", () => {
    const longKey = "a".repeat(200);
    const result = parseArgs([`--${longKey}`, "value"]);
    expect(result[longKey]).toBe("value");
  });

  test("value with spaces (as single arg)", () => {
    expect(parseArgs(["--name", "hello world"])).toEqual({ name: "hello world" });
  });

  test("value with special characters", () => {
    expect(parseArgs(["--query", "a&b=c"])).toEqual({ query: "a&b=c" });
  });

  test("--key=value with multiple equals signs", () => {
    expect(parseArgs(["--formula=x=y+z"])).toEqual({ formula: "x=y+z" });
  });

  test("--key=value where value contains --", () => {
    expect(parseArgs(["--comment=use --verbose for debug"])).toEqual({
      comment: "use --verbose for debug",
    });
  });

  test("alternating flags and values", () => {
    expect(parseArgs(["--a", "1", "--b", "--c", "3"])).toEqual({ a: "1", b: "true", c: "3" });
  });

  test("numeric key names", () => {
    expect(parseArgs(["--123", "value"])).toEqual({ "123": "value" });
  });

  test("key with unicode (not blocked by proto guard)", () => {
    expect(parseArgs(["--café", "latte"])).toEqual({ café: "latte" });
  });

  test("many args", () => {
    const args: string[] = [];
    for (let i = 0; i < 100; i++) {
      args.push(`--key${i}`, `val${i}`);
    }
    const result = parseArgs(args);
    expect(Object.keys(result)).toHaveLength(100);
    expect(result.key0).toBe("val0");
    expect(result.key99).toBe("val99");
  });

  test("blocks constructor=value format", () => {
    const result = parseArgs(["--constructor=evil"]);
    expect(Object.getOwnPropertyDescriptor(result, "constructor")).toBeUndefined();
  });

  test("blocks prototype=value format", () => {
    const result = parseArgs(["--prototype=evil"]);
    // prototype is blocked
    expect(Object.keys(result)).not.toContain("prototype");
  });
});

// ─── resolveAuth edge cases ──────────────────────────────────────────────────

describe("resolveAuth edge cases", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("handles auth string with no variables", () => {
    expect(resolveAuth({ name: "t", url: "http://x", auth: "Basic abc123" })).toBe("Basic abc123");
  });

  test("handles auth with $ but no valid var name", () => {
    // $ at end of string — regex won't match
    expect(resolveAuth({ name: "t", url: "http://x", auth: "Bearer $" })).toBe("Bearer $");
  });

  test("handles empty auth string (falsy returns null)", () => {
    expect(resolveAuth({ name: "t", url: "http://x", auth: "" })).toBeNull();
  });

  test("resolves ${VAR} with underscores in name", () => {
    process.env.MY_LONG_TOKEN_NAME = "xyz";
    expect(resolveAuth({ name: "t", url: "http://x", auth: "Bearer ${MY_LONG_TOKEN_NAME}" })).toBe(
      "Bearer xyz"
    );
  });

  test("handles mixed $VAR and ${VAR} in same string", () => {
    process.env.A_VAR = "aaa";
    process.env.B_VAR = "bbb";
    expect(resolveAuth({ name: "t", url: "http://x", auth: "$A_VAR:${B_VAR}" })).toBe("aaa:bbb");
  });

  test("handles auth with only an env var", () => {
    process.env.FULL_AUTH = "Bearer secrettoken";
    expect(resolveAuth({ name: "t", url: "http://x", auth: "$FULL_AUTH" })).toBe("Bearer secrettoken");
  });
});

// ─── stripDuplicateApiPrefix edge cases ──────────────────────────────────────

describe("stripDuplicateApiPrefix edge cases", () => {
  test("exact /api path no trailing content", () => {
    // path is /api without trailing / — no strip
    expect(stripDuplicateApiPrefix("https://example.com/api", "/api")).toBe("/api");
  });

  test("baseUrl with /api/v1 does not strip", () => {
    expect(stripDuplicateApiPrefix("https://example.com/api/v1", "/api/users")).toBe("/api/users");
  });

  test("empty path", () => {
    expect(stripDuplicateApiPrefix("https://example.com/api", "")).toBe("");
  });

  test("root path /", () => {
    expect(stripDuplicateApiPrefix("https://example.com/api", "/")).toBe("/");
  });
});

// ─── buildUrl edge cases ─────────────────────────────────────────────────────

describe("buildUrl edge cases", () => {
  test("encodes special characters in path params", () => {
    const op: OperationInfo = {
      operationId: "get",
      method: "GET",
      path: "/items/{name}",
      pathParams: ["name"],
      queryParams: [],
      requiredBody: [],
    };
    const url = buildUrl("https://api.example.com", op, { name: "foo/bar" });
    expect(url).toContain("foo%2Fbar");
  });

  test("encodes special characters in query params", () => {
    const op: OperationInfo = {
      operationId: "search",
      method: "GET",
      path: "/search",
      pathParams: [],
      queryParams: [{ name: "q", required: false }],
      requiredBody: [],
    };
    const url = buildUrl("https://api.example.com", op, { q: "a b&c=d" });
    expect(url).toContain("a%20b%26c%3Dd");
  });

  test("multiple path params", () => {
    const op: OperationInfo = {
      operationId: "get",
      method: "GET",
      path: "/orgs/{orgId}/repos/{repoId}",
      pathParams: ["orgId", "repoId"],
      queryParams: [],
      requiredBody: [],
    };
    const url = buildUrl("https://api.github.com", op, { orgId: "acme", repoId: "widget" });
    expect(url).toBe("https://api.github.com/orgs/acme/repos/widget");
  });

  test("no query params produces no question mark", () => {
    const op: OperationInfo = {
      operationId: "list",
      method: "GET",
      path: "/items",
      pathParams: [],
      queryParams: [{ name: "page", required: false }],
      requiredBody: [],
    };
    const url = buildUrl("https://api.example.com", op, {});
    expect(url).toBe("https://api.example.com/items");
    expect(url).not.toContain("?");
  });

  test("optional query params not provided are omitted", () => {
    const op: OperationInfo = {
      operationId: "list",
      method: "GET",
      path: "/items",
      pathParams: [],
      queryParams: [
        { name: "page", required: false },
        { name: "limit", required: false },
      ],
      requiredBody: [],
    };
    const url = buildUrl("https://api.example.com", op, { page: "1" });
    expect(url).toBe("https://api.example.com/items?page=1");
    expect(url).not.toContain("limit");
  });

  test("handles baseUrl with path", () => {
    const op: OperationInfo = {
      operationId: "list",
      method: "GET",
      path: "/users",
      pathParams: [],
      queryParams: [],
      requiredBody: [],
    };
    const url = buildUrl("https://api.example.com/v2", op, {});
    expect(url).toBe("https://api.example.com/v2/users");
  });
});

// ─── buildBody edge cases ────────────────────────────────────────────────────

describe("buildBody edge cases", () => {
  test("coerces 0 as valid number", () => {
    const op: OperationInfo = {
      operationId: "t",
      method: "POST",
      path: "/x",
      pathParams: [],
      queryParams: [],
      bodySchema: { properties: { count: { type: "integer" } } },
      requiredBody: [],
    };
    expect(buildBody(op, { count: "0" })).toEqual({ count: 0 });
  });

  test("coerces negative number", () => {
    const op: OperationInfo = {
      operationId: "t",
      method: "POST",
      path: "/x",
      pathParams: [],
      queryParams: [],
      bodySchema: { properties: { offset: { type: "number" } } },
      requiredBody: [],
    };
    expect(buildBody(op, { offset: "-5.5" })).toEqual({ offset: -5.5 });
  });

  test("coerces float number", () => {
    const op: OperationInfo = {
      operationId: "t",
      method: "POST",
      path: "/x",
      pathParams: [],
      queryParams: [],
      bodySchema: { properties: { price: { type: "number" } } },
      requiredBody: [],
    };
    expect(buildBody(op, { price: "9.99" })).toEqual({ price: 9.99 });
  });

  test("boolean false is not truthy", () => {
    const op: OperationInfo = {
      operationId: "t",
      method: "POST",
      path: "/x",
      pathParams: [],
      queryParams: [],
      bodySchema: { properties: { active: { type: "boolean" } } },
      requiredBody: [],
    };
    const result = buildBody(op, { active: "false" });
    expect(result!.active).toBe(false);
  });

  test("array from valid JSON array", () => {
    const op: OperationInfo = {
      operationId: "t",
      method: "POST",
      path: "/x",
      pathParams: [],
      queryParams: [],
      bodySchema: { properties: { ids: { type: "array" } } },
      requiredBody: [],
    };
    expect(buildBody(op, { ids: "[1,2,3]" })).toEqual({ ids: [1, 2, 3] });
  });

  test("array fallback to comma split with spaces", () => {
    const op: OperationInfo = {
      operationId: "t",
      method: "POST",
      path: "/x",
      pathParams: [],
      queryParams: [],
      bodySchema: { properties: { tags: { type: "array" } } },
      requiredBody: [],
    };
    // "a, b, c" splits to ["a", " b", " c"] (includes leading spaces)
    const result = buildBody(op, { tags: "a, b, c" });
    expect(result!.tags).toEqual(["a", " b", " c"]);
  });

  test("unknown schema type treated as string", () => {
    const op: OperationInfo = {
      operationId: "t",
      method: "POST",
      path: "/x",
      pathParams: [],
      queryParams: [],
      bodySchema: { properties: { data: { type: "object" } } },
      requiredBody: [],
    };
    expect(buildBody(op, { data: '{"key":"val"}' })).toEqual({ data: '{"key":"val"}' });
  });

  test("params not in schema ignored when additionalProperties is false", () => {
    const op: OperationInfo = {
      operationId: "t",
      method: "POST",
      path: "/x",
      pathParams: [],
      queryParams: [],
      bodySchema: {
        properties: { name: { type: "string" } },
        additionalProperties: false,
      },
      requiredBody: [],
    };
    const result = buildBody(op, { name: "test", unknown: "ignored" });
    expect(result).toEqual({ name: "test" });
  });

  test("empty body schema with no params returns null", () => {
    const op: OperationInfo = {
      operationId: "t",
      method: "POST",
      path: "/x",
      pathParams: [],
      queryParams: [],
      bodySchema: { properties: {} },
      requiredBody: [],
    };
    expect(buildBody(op, {})).toBeNull();
  });

  test("additional properties coercion for numbers", () => {
    const op: OperationInfo = {
      operationId: "t",
      method: "PATCH",
      path: "/x",
      pathParams: [],
      queryParams: [],
      bodySchema: { properties: {} },
      requiredBody: [],
    };
    const result = buildBody(op, { count: "42", flag: "false", label: "hello" });
    expect(result).toEqual({ count: 42, flag: false, label: "hello" });
  });
});
