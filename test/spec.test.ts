import { describe, test, expect } from "bun:test";
import {
  resolveRef,
  deepResolveRefs,
  deriveOperationId,
  extractOperations,
  findOperation,
} from "../src/spec";

// ─── resolveRef ──────────────────────────────────────────────────────────────

describe("resolveRef", () => {
  test("returns primitives as-is", () => {
    expect(resolveRef({}, null)).toBe(null);
    expect(resolveRef({}, undefined)).toBe(undefined);
    expect(resolveRef({}, "string")).toBe("string");
    expect(resolveRef({}, 42)).toBe(42);
  });

  test("returns object without $ref as-is", () => {
    const obj = { type: "string", description: "a name" };
    expect(resolveRef({}, obj)).toEqual(obj);
  });

  test("resolves simple $ref", () => {
    const spec = {
      components: { schemas: { User: { type: "object", properties: { name: { type: "string" } } } } },
    };
    const result = resolveRef(spec, { $ref: "#/components/schemas/User" });
    expect(result.type).toBe("object");
    expect(result.properties.name.type).toBe("string");
  });

  test("resolves chained $ref", () => {
    const spec = {
      components: {
        schemas: {
          Alias: { $ref: "#/components/schemas/Real" },
          Real: { type: "integer" },
        },
      },
    };
    const result = resolveRef(spec, { $ref: "#/components/schemas/Alias" });
    expect(result.type).toBe("integer");
  });

  test("handles circular $ref without infinite loop", () => {
    const spec = {
      components: {
        schemas: {
          A: { $ref: "#/components/schemas/B" },
          B: { $ref: "#/components/schemas/A" },
        },
      },
    };
    const result = resolveRef(spec, { $ref: "#/components/schemas/A" });
    // Should not hang; returns the unresolvable ref
    expect(result).toBeDefined();
  });

  test("returns original if $ref path doesn't exist", () => {
    const ref = { $ref: "#/components/schemas/Missing" };
    const result = resolveRef({ components: { schemas: {} } }, ref);
    expect(result).toEqual(ref);
  });
});

// ─── deepResolveRefs ─────────────────────────────────────────────────────────

describe("deepResolveRefs", () => {
  test("resolves nested property $refs", () => {
    const spec = {
      components: {
        schemas: {
          Address: { type: "object", properties: { city: { type: "string" } } },
        },
      },
    };
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" },
        address: { $ref: "#/components/schemas/Address" },
      },
    };
    const result = deepResolveRefs(spec, schema);
    expect(result.properties.name.type).toBe("string");
    expect(result.properties.address.type).toBe("object");
    expect(result.properties.address.properties.city.type).toBe("string");
  });

  test("resolves $refs inside arrays", () => {
    const spec = {
      components: { schemas: { Item: { type: "string" } } },
    };
    const arr = [{ $ref: "#/components/schemas/Item" }, { type: "number" }];
    const result = deepResolveRefs(spec, arr);
    expect(result[0].type).toBe("string");
    expect(result[1].type).toBe("number");
  });

  test("handles circular refs in deep resolution", () => {
    const spec = {
      components: {
        schemas: {
          Node: {
            type: "object",
            properties: {
              child: { $ref: "#/components/schemas/Node" },
            },
          },
        },
      },
    };
    const result = deepResolveRefs(spec, { $ref: "#/components/schemas/Node" });
    expect(result.type).toBe("object");
    // The child ref should eventually stop resolving (circular)
    expect(result.properties.child).toBeDefined();
  });

  test("returns primitives as-is", () => {
    expect(deepResolveRefs({}, null)).toBe(null);
    expect(deepResolveRefs({}, "hello")).toBe("hello");
    expect(deepResolveRefs({}, 42)).toBe(42);
  });
});

// ─── deriveOperationId ───────────────────────────────────────────────────────

describe("deriveOperationId", () => {
  test("simple GET collection", () => {
    expect(deriveOperationId("get", "/projects")).toBe("getProjects");
  });

  test("GET with path param", () => {
    expect(deriveOperationId("get", "/projects/{projectId}")).toBe("getProjectsByProjectId");
  });

  test("POST collection", () => {
    expect(deriveOperationId("post", "/projects")).toBe("postProjects");
  });

  test("nested resource", () => {
    expect(deriveOperationId("get", "/projects/{projectId}/issues")).toBe("getProjectsIssuesByProjectId");
  });

  test("multiple path params", () => {
    expect(deriveOperationId("get", "/projects/{projectId}/issues/{issueId}")).toBe(
      "getProjectsIssuesByProjectIdAndIssueId"
    );
  });

  test("action word overrides verb", () => {
    expect(deriveOperationId("post", "/projects/{projectId}/delete")).toBe("deleteProjectsByProjectId");
    expect(deriveOperationId("post", "/projects/{projectId}/restore")).toBe("restoreProjectsByProjectId");
    expect(deriveOperationId("post", "/projects/{projectId}/archive")).toBe("archiveProjectsByProjectId");
  });

  test("strips /api prefix", () => {
    expect(deriveOperationId("get", "/api/users")).toBe("getUsers");
    expect(deriveOperationId("get", "/api/users/{id}")).toBe("getUsersById");
  });

  test("handles DELETE method", () => {
    expect(deriveOperationId("delete", "/projects/{id}")).toBe("deleteProjectsById");
  });

  test("handles PUT method", () => {
    expect(deriveOperationId("put", "/projects/{id}")).toBe("putProjectsById");
  });

  test("handles PATCH method", () => {
    expect(deriveOperationId("patch", "/users/{userId}")).toBe("patchUsersByUserId");
  });

  test("root path", () => {
    expect(deriveOperationId("get", "/")).toBe("get");
  });

  test("single resource no params", () => {
    expect(deriveOperationId("get", "/health")).toBe("getHealth");
  });
});

// ─── extractOperations ───────────────────────────────────────────────────────

describe("extractOperations", () => {
  test("extracts simple operations", () => {
    const spec = {
      paths: {
        "/users": {
          get: { operationId: "listUsers", summary: "List users" },
          post: { operationId: "createUser", summary: "Create user" },
        },
      },
    };
    const ops = extractOperations(spec);
    expect(ops).toHaveLength(2);
    expect(ops[0]!.operationId).toBe("listUsers");
    expect(ops[0]!.method).toBe("GET");
    expect(ops[1]!.operationId).toBe("createUser");
    expect(ops[1]!.method).toBe("POST");
  });

  test("auto-generates operationId when missing", () => {
    const spec = {
      paths: {
        "/users/{id}": {
          get: { summary: "Get user" },
        },
      },
    };
    const ops = extractOperations(spec);
    expect(ops[0]!.operationId).toBe("getUsersById");
  });

  test("extracts path parameters", () => {
    const spec = {
      paths: {
        "/users/{userId}": {
          get: {
            parameters: [{ name: "userId", in: "path", required: true }],
          },
        },
      },
    };
    const ops = extractOperations(spec);
    expect(ops[0]!.pathParams).toEqual(["userId"]);
  });

  test("extracts query parameters", () => {
    const spec = {
      paths: {
        "/users": {
          get: {
            parameters: [
              { name: "page", in: "query", required: false, description: "Page number" },
              { name: "limit", in: "query", required: true },
            ],
          },
        },
      },
    };
    const ops = extractOperations(spec);
    expect(ops[0]!.queryParams).toHaveLength(2);
    expect(ops[0]!.queryParams[0]!.name).toBe("page");
    expect(ops[0]!.queryParams[0]!.required).toBe(false);
    expect(ops[0]!.queryParams[1]!.required).toBe(true);
  });

  test("extracts body schema", () => {
    const spec = {
      paths: {
        "/users": {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { name: { type: "string" }, age: { type: "integer" } },
                    required: ["name"],
                  },
                },
              },
            },
          },
        },
      },
    };
    const ops = extractOperations(spec);
    expect(ops[0]!.bodySchema).toBeDefined();
    expect(ops[0]!.bodySchema.properties.name.type).toBe("string");
    expect(ops[0]!.requiredBody).toEqual(["name"]);
  });

  test("merges path-level parameters", () => {
    const spec = {
      paths: {
        "/projects/{projectId}/issues": {
          parameters: [{ name: "projectId", in: "path", required: true }],
          get: {
            parameters: [{ name: "status", in: "query" }],
          },
        },
      },
    };
    const ops = extractOperations(spec);
    expect(ops[0]!.pathParams).toEqual(["projectId"]);
    expect(ops[0]!.queryParams[0]!.name).toBe("status");
  });

  test("operation params override path-level params", () => {
    const spec = {
      paths: {
        "/items": {
          parameters: [{ name: "format", in: "query", description: "path-level" }],
          get: {
            parameters: [{ name: "format", in: "query", description: "op-level" }],
          },
        },
      },
    };
    const ops = extractOperations(spec);
    expect(ops[0]!.queryParams[0]!.description).toBe("op-level");
  });

  test("resolves $ref in body schema", () => {
    const spec = {
      paths: {
        "/users": {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/CreateUser" },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          CreateUser: {
            type: "object",
            properties: { email: { type: "string" } },
            required: ["email"],
          },
        },
      },
    };
    const ops = extractOperations(spec);
    expect(ops[0]!.bodySchema.properties.email.type).toBe("string");
    expect(ops[0]!.requiredBody).toEqual(["email"]);
  });

  test("handles allOf with sibling properties", () => {
    const spec = {
      paths: {
        "/users": {
          post: {
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    allOf: [{ $ref: "#/components/schemas/Base" }],
                    properties: { extra: { type: "boolean" } },
                    required: ["extra"],
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Base: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
          },
        },
      },
    };
    const ops = extractOperations(spec);
    expect(ops[0]!.bodySchema.properties.name.type).toBe("string");
    expect(ops[0]!.bodySchema.properties.extra.type).toBe("boolean");
    expect(ops[0]!.requiredBody).toContain("name");
    expect(ops[0]!.requiredBody).toContain("extra");
  });

  test("deduplicates operationIds", () => {
    const spec = {
      paths: {
        "/a": { get: { operationId: "listItems" } },
        "/b": { get: { operationId: "listItems" } },
      },
    };
    const ops = extractOperations(spec);
    const ids = ops.map((o) => o.operationId);
    expect(ids).toContain("listItems");
    expect(ids).toContain("listItems2");
  });

  test("dedup avoids collision with existing IDs", () => {
    const spec = {
      paths: {
        "/a": { get: { operationId: "foo" } },
        "/b": { get: { operationId: "foo2" } },
        "/c": { get: { operationId: "foo" } },
      },
    };
    const ops = extractOperations(spec);
    const ids = ops.map((o) => o.operationId);
    expect(ids).toContain("foo");
    expect(ids).toContain("foo2");
    expect(ids).toContain("foo3"); // skips foo2 since it exists
  });

  test("handles empty spec", () => {
    expect(extractOperations({})).toEqual([]);
    expect(extractOperations({ paths: {} })).toEqual([]);
  });

  test("ignores non-HTTP methods (parameters, summary, etc.)", () => {
    const spec = {
      paths: {
        "/users": {
          parameters: [{ name: "x", in: "query" }],
          summary: "User endpoints",
          get: { operationId: "getUsers" },
        },
      },
    };
    const ops = extractOperations(spec);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.operationId).toBe("getUsers");
  });

  test("resolves $ref in parameters", () => {
    const spec = {
      paths: {
        "/items/{id}": {
          get: {
            parameters: [{ $ref: "#/components/parameters/ItemId" }],
          },
        },
      },
      components: {
        parameters: {
          ItemId: { name: "id", in: "path", required: true, description: "Item ID" },
        },
      },
    };
    const ops = extractOperations(spec);
    expect(ops[0]!.pathParams).toEqual(["id"]);
  });
});

// ─── findOperation ───────────────────────────────────────────────────────────

describe("findOperation", () => {
  const spec = {
    paths: {
      "/users": { get: { operationId: "listUsers" } },
      "/users/{id}": { get: { operationId: "getUser" } },
    },
  };

  test("finds existing operation", () => {
    const op = findOperation(spec, "listUsers");
    expect(op).not.toBeNull();
    expect(op!.operationId).toBe("listUsers");
    expect(op!.method).toBe("GET");
  });

  test("returns null for missing operation", () => {
    expect(findOperation(spec, "nonexistent")).toBeNull();
  });

  test("returns null for empty spec", () => {
    expect(findOperation({}, "anything")).toBeNull();
  });
});
