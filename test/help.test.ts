import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { showApiHelp, showOperationHelp } from "../src/help";
import type { ApiConfig } from "../src/config";

describe("showApiHelp", () => {
  let logs: string[];
  let spy: ReturnType<typeof spyOn>;

  afterEach(() => {
    spy?.mockRestore();
  });

  function captureOutput(config: ApiConfig) {
    logs = [];
    spy = spyOn(console, "log").mockImplementation((...args: any[]) => {
      logs.push(args.map(String).join(" "));
    });
    showApiHelp(config);
    return logs.join("\n");
  }

  test("displays operations with summaries", () => {
    const config: ApiConfig = {
      name: "test",
      url: "http://x",
      spec: {
        info: { title: "My API" },
        paths: {
          "/users": {
            get: { operationId: "listUsers", summary: "List all users" },
          },
        },
      },
    };
    const output = captureOutput(config);
    expect(output).toContain("My API");
    expect(output).toContain("listUsers");
    expect(output).toContain("List all users");
  });

  test("shows required params with asterisk", () => {
    const config: ApiConfig = {
      name: "test",
      url: "http://x",
      spec: {
        paths: {
          "/users/{id}": {
            get: {
              operationId: "getUser",
              parameters: [{ name: "id", in: "path", required: true }],
            },
          },
        },
      },
    };
    const output = captureOutput(config);
    expect(output).toContain("--id *");
  });

  test("handles empty operations list", () => {
    const config: ApiConfig = {
      name: "test",
      url: "http://x",
      spec: { paths: {} },
    };
    const output = captureOutput(config);
    expect(output).toContain("No operations found");
  });

  test("uses config.name when spec has no title", () => {
    const config: ApiConfig = {
      name: "myapi",
      url: "http://x",
      spec: {
        paths: {
          "/health": { get: { operationId: "health" } },
        },
      },
    };
    const output = captureOutput(config);
    expect(output).toContain("myapi");
  });
});

describe("showOperationHelp", () => {
  let logs: string[];
  let spy: ReturnType<typeof spyOn>;

  afterEach(() => {
    spy?.mockRestore();
  });

  function captureOutput(config: ApiConfig, opId: string) {
    logs = [];
    spy = spyOn(console, "log").mockImplementation((...args: any[]) => {
      logs.push(args.map(String).join(" "));
    });
    showOperationHelp(config, opId);
    return logs.join("\n");
  }

  test("displays operation details", () => {
    const config: ApiConfig = {
      name: "test",
      url: "http://x",
      spec: {
        paths: {
          "/users/{id}": {
            get: {
              operationId: "getUser",
              summary: "Get a user by ID",
              parameters: [
                { name: "id", in: "path", required: true },
                { name: "fields", in: "query", description: "Fields to include" },
              ],
            },
          },
        },
      },
    };
    const output = captureOutput(config, "getUser");
    expect(output).toContain("getUser");
    expect(output).toContain("GET");
    expect(output).toContain("Get a user by ID");
    expect(output).toContain("--id");
    expect(output).toContain("Path parameters");
    expect(output).toContain("--fields");
    expect(output).toContain("Fields to include");
  });

  test("shows body parameters with types", () => {
    const config: ApiConfig = {
      name: "test",
      url: "http://x",
      spec: {
        paths: {
          "/users": {
            post: {
              operationId: "createUser",
              requestBody: {
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        name: { type: "string", description: "User name" },
                        age: { type: "integer" },
                      },
                      required: ["name"],
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const output = captureOutput(config, "createUser");
    expect(output).toContain("Body parameters");
    expect(output).toContain("--name");
    expect(output).toContain("[string]");
    expect(output).toContain("(required)");
    expect(output).toContain("--age");
    expect(output).toContain("[integer]");
  });

  test("omits sections when no params of that type", () => {
    const config: ApiConfig = {
      name: "test",
      url: "http://x",
      spec: {
        paths: {
          "/health": {
            get: { operationId: "health", summary: "Health check" },
          },
        },
      },
    };
    const output = captureOutput(config, "health");
    expect(output).not.toContain("Path parameters");
    expect(output).not.toContain("Query parameters");
    expect(output).not.toContain("Body parameters");
  });
});
