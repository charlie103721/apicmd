import { describe, test, expect } from "bun:test";
import { resolveRef, deepResolveRefs, deriveOperationId, extractOperations } from "../src/spec";

// ─── resolveRef edge cases ───────────────────────────────────────────────────

describe("resolveRef edge cases", () => {
  test("handles deeply nested ref path", () => {
    const spec = { a: { b: { c: { d: { type: "string" } } } } };
    const result = resolveRef(spec, { $ref: "#/a/b/c/d" });
    expect(result.type).toBe("string");
  });

  test("handles ref to root-level key", () => {
    const spec = { MySchema: { type: "number" } };
    const result = resolveRef(spec, { $ref: "#/MySchema" });
    expect(result.type).toBe("number");
  });

  test("returns original for broken ref path (intermediate missing)", () => {
    const spec = { components: {} };
    const ref = { $ref: "#/components/schemas/Missing/deep" };
    expect(resolveRef(spec, ref)).toEqual(ref);
  });

  test("handles ref to array element (non-standard but shouldn't crash)", () => {
    const spec = { items: ["zero", "one", "two"] };
    const result = resolveRef(spec, { $ref: "#/items/1" });
    expect(result).toBe("one");
  });

  test("handles empty $ref string", () => {
    const result = resolveRef({}, { $ref: "" });
    // empty path splits to [""] which won't resolve
    expect(result).toBeDefined();
  });
});

// ─── deepResolveRefs edge cases ──────────────────────────────────────────────

describe("deepResolveRefs edge cases", () => {
  test("resolves deeply nested property refs (3 levels)", () => {
    const spec = {
      components: {
        schemas: {
          Inner: { type: "string" },
          Middle: { type: "object", properties: { value: { $ref: "#/components/schemas/Inner" } } },
          Outer: { type: "object", properties: { mid: { $ref: "#/components/schemas/Middle" } } },
        },
      },
    };
    const result = deepResolveRefs(spec, { $ref: "#/components/schemas/Outer" });
    expect(result.type).toBe("object");
    expect(result.properties.mid.type).toBe("object");
    expect(result.properties.mid.properties.value.type).toBe("string");
  });

  test("resolves refs inside allOf array", () => {
    const spec = {
      components: {
        schemas: {
          Base: { type: "object", properties: { id: { type: "integer" } } },
        },
      },
    };
    const schema = {
      allOf: [
        { $ref: "#/components/schemas/Base" },
        { type: "object", properties: { name: { type: "string" } } },
      ],
    };
    const result = deepResolveRefs(spec, schema);
    expect(result.allOf[0].type).toBe("object");
    expect(result.allOf[0].properties.id.type).toBe("integer");
    expect(result.allOf[1].properties.name.type).toBe("string");
  });

  test("handles empty object", () => {
    expect(deepResolveRefs({}, {})).toEqual({});
  });

  test("handles empty array", () => {
    expect(deepResolveRefs({}, [])).toEqual([]);
  });

  test("preserves non-ref keys", () => {
    const obj = { type: "object", description: "test", nullable: true };
    const result = deepResolveRefs({}, obj);
    expect(result.type).toBe("object");
    expect(result.description).toBe("test");
    expect(result.nullable).toBe(true);
  });

  test("handles mixed ref and non-ref properties", () => {
    const spec = { components: { schemas: { Tag: { type: "string" } } } };
    const obj = {
      type: "object",
      properties: {
        name: { type: "string" },
        tag: { $ref: "#/components/schemas/Tag" },
        count: { type: "integer" },
      },
    };
    const result = deepResolveRefs(spec, obj);
    expect(result.properties.name.type).toBe("string");
    expect(result.properties.tag.type).toBe("string");
    expect(result.properties.count.type).toBe("integer");
  });
});

// ─── deriveOperationId edge cases ────────────────────────────────────────────

describe("deriveOperationId edge cases", () => {
  test("all action words", () => {
    expect(deriveOperationId("post", "/items/{id}/restore")).toBe("restoreItemsById");
    expect(deriveOperationId("post", "/items/{id}/archive")).toBe("archiveItemsById");
    expect(deriveOperationId("post", "/items/{id}/unarchive")).toBe("unarchiveItemsById");
    expect(deriveOperationId("post", "/items/{id}/remove")).toBe("removeItemsById");
    expect(deriveOperationId("post", "/items/{id}/reorder")).toBe("reorderItemsById");
    expect(deriveOperationId("post", "/items/{id}/revoke")).toBe("revokeItemsById");
    expect(deriveOperationId("post", "/items/{id}/join")).toBe("joinItemsById");
  });

  test("non-action word at end stays as resource", () => {
    expect(deriveOperationId("get", "/users/{id}/profile")).toBe("getUsersProfileById");
    expect(deriveOperationId("get", "/items/{id}/comments")).toBe("getItemsCommentsById");
  });

  test("multiple resources no params", () => {
    expect(deriveOperationId("get", "/admin/settings/email")).toBe("getAdminSettingsEmail");
  });

  test("deeply nested path", () => {
    expect(deriveOperationId("get", "/a/{aId}/b/{bId}/c/{cId}")).toBe("getABCByAIdAndBIdAndCId");
  });

  test("HEAD and OPTIONS methods", () => {
    expect(deriveOperationId("head", "/users")).toBe("headUsers");
    expect(deriveOperationId("options", "/users")).toBe("optionsUsers");
  });

  test("uppercase method is lowercased", () => {
    expect(deriveOperationId("GET", "/users")).toBe("getUsers");
    expect(deriveOperationId("POST", "/items")).toBe("postItems");
  });

  test("path with /api/ prefix stripped", () => {
    expect(deriveOperationId("get", "/api/v2/users/{id}")).toBe("getV2UsersById");
  });

  test("path without /api/ prefix unchanged", () => {
    expect(deriveOperationId("get", "/v2/users/{id}")).toBe("getV2UsersById");
  });

  test("single param no resources after api strip", () => {
    expect(deriveOperationId("get", "/api/{id}")).toBe("getById");
  });
});

// ─── extractOperations complex specs ─────────────────────────────────────────

describe("extractOperations complex specs", () => {
  test("handles all HTTP methods", () => {
    const spec = {
      paths: {
        "/resource": {
          get: { operationId: "getR" },
          post: { operationId: "postR" },
          put: { operationId: "putR" },
          patch: { operationId: "patchR" },
          delete: { operationId: "deleteR" },
          head: { operationId: "headR" },
          options: { operationId: "optionsR" },
        },
      },
    };
    const ops = extractOperations(spec);
    expect(ops).toHaveLength(7);
    const methods = ops.map((o) => o.method).sort();
    expect(methods).toEqual(["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]);
  });

  test("handles spec with many paths", () => {
    const paths: any = {};
    for (let i = 0; i < 50; i++) {
      paths[`/resource${i}`] = { get: { operationId: `get${i}` } };
    }
    const ops = extractOperations({ paths });
    expect(ops).toHaveLength(50);
  });

  test("handles operation with no parameters and no body", () => {
    const spec = { paths: { "/health": { get: { operationId: "health" } } } };
    const ops = extractOperations(spec);
    expect(ops[0]!.pathParams).toEqual([]);
    expect(ops[0]!.queryParams).toEqual([]);
    expect(ops[0]!.bodySchema).toBeUndefined();
    expect(ops[0]!.requiredBody).toEqual([]);
  });

  test("uses description as summary fallback", () => {
    const spec = {
      paths: {
        "/x": { get: { operationId: "x", description: "A description" } },
      },
    };
    const ops = extractOperations(spec);
    expect(ops[0]!.summary).toBe("A description");
  });

  test("prefers summary over description", () => {
    const spec = {
      paths: {
        "/x": { get: { operationId: "x", summary: "A summary", description: "A description" } },
      },
    };
    const ops = extractOperations(spec);
    expect(ops[0]!.summary).toBe("A summary");
  });

  test("handles multiple allOf parts", () => {
    const spec = {
      paths: {
        "/items": {
          post: {
            operationId: "createItem",
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { $ref: "#/components/schemas/Base" },
                      { $ref: "#/components/schemas/Extra" },
                    ],
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Base: { properties: { name: { type: "string" } }, required: ["name"] },
          Extra: { properties: { tags: { type: "array" } }, required: ["tags"] },
        },
      },
    };
    const ops = extractOperations(spec);
    expect(ops[0]!.bodySchema.properties.name.type).toBe("string");
    expect(ops[0]!.bodySchema.properties.tags.type).toBe("array");
    expect(ops[0]!.requiredBody).toContain("name");
    expect(ops[0]!.requiredBody).toContain("tags");
  });

  test("handles body with no required field", () => {
    const spec = {
      paths: {
        "/items": {
          patch: {
            operationId: "updateItem",
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { name: { type: "string" } },
                    // no required array
                  },
                },
              },
            },
          },
        },
      },
    };
    const ops = extractOperations(spec);
    expect(ops[0]!.requiredBody).toEqual([]);
  });

  test("three duplicate operationIds get unique suffixes", () => {
    const spec = {
      paths: {
        "/a": { get: { operationId: "dup" } },
        "/b": { get: { operationId: "dup" } },
        "/c": { get: { operationId: "dup" } },
      },
    };
    const ops = extractOperations(spec);
    const ids = ops.map((o) => o.operationId).sort();
    expect(ids).toEqual(["dup", "dup2", "dup3"]);
  });

  test("ignores non-JSON content types for body", () => {
    const spec = {
      paths: {
        "/upload": {
          post: {
            operationId: "upload",
            requestBody: {
              content: {
                "multipart/form-data": {
                  schema: { type: "object", properties: { file: { type: "string" } } },
                },
              },
            },
          },
        },
      },
    };
    const ops = extractOperations(spec);
    expect(ops[0]!.bodySchema).toBeUndefined();
  });

  test("handles path-level params with no operation params", () => {
    const spec = {
      paths: {
        "/projects/{projectId}": {
          parameters: [{ name: "projectId", in: "path", required: true }],
          get: { operationId: "getProject" },
          delete: { operationId: "deleteProject" },
        },
      },
    };
    const ops = extractOperations(spec);
    expect(ops[0]!.pathParams).toEqual(["projectId"]);
    expect(ops[1]!.pathParams).toEqual(["projectId"]);
  });
});
