export interface OperationInfo {
  operationId: string;
  method: string;
  path: string;
  summary?: string;
  pathParams: string[];
  queryParams: ParamInfo[];
  bodySchema?: any;
  requiredBody: string[];
}

interface ParamInfo {
  name: string;
  required: boolean;
  description?: string;
}

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

/**
 * Resolve $ref pointers in an OpenAPI spec.
 * e.g. { "$ref": "#/components/schemas/Foo" } → the actual schema object
 */
function resolveRef(spec: any, obj: any, seen = new Set<string>()): any {
  if (!obj || typeof obj !== "object") return obj;
  if (obj.$ref) {
    if (seen.has(obj.$ref)) return obj;
    seen.add(obj.$ref);
    const path = obj.$ref.replace(/^#\//, "").split("/");
    let resolved = spec;
    for (const seg of path) {
      resolved = resolved?.[seg];
    }
    return resolved ? resolveRef(spec, resolved, seen) : obj;
  }
  return obj;
}

/**
 * Recursively resolve all $ref pointers in nested objects/arrays.
 * Handles property-level refs that resolveRef misses.
 */
function deepResolveRefs(spec: any, obj: any, seen = new Set<string>()): any {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(item => deepResolveRefs(spec, item, new Set(seen)));
  if (obj.$ref) {
    if (seen.has(obj.$ref)) return obj;
    seen.add(obj.$ref);
    const refPath = obj.$ref.replace(/^#\//, "").split("/");
    let resolved = spec;
    for (const seg of refPath) resolved = resolved?.[seg];
    return resolved ? deepResolveRefs(spec, resolved, seen) : obj;
  }
  const result: any = {};
  for (const [key, val] of Object.entries(obj)) {
    result[key] = deepResolveRefs(spec, val, new Set(seen));
  }
  return result;
}

/**
 * Auto-generate a unique operationId from method + path.
 * Includes path param names with "By" to disambiguate.
 *
 * GET  /projects                    → getProjects
 * GET  /projects/{projectId}        → getProjectsByProjectId
 * POST /projects                    → postProjects
 * POST /projects/{projectId}        → postProjectsByProjectId
 * POST /projects/{projectId}/delete → deleteProjectsByProjectId
 * GET  /projects/{projectId}/issues → getProjectsIssuesByProjectId
 * GET  /projects/{projectId}/issues/{issueId} → getProjectsIssuesByProjectIdAndIssueId
 */
function deriveOperationId(method: string, path: string): string {
  // Remove /api prefix
  const p = path.replace(/^\/api\//, "/");
  const segments = p.split("/").filter(Boolean);

  const resources: string[] = [];
  const pathParamNames: string[] = [];

  // Check for action verbs at the end
  const actionWords = new Set(["delete", "restore", "archive", "unarchive", "remove", "reorder", "revoke", "join"]);

  for (const seg of segments) {
    if (seg.startsWith("{") && seg.endsWith("}")) {
      pathParamNames.push(seg.slice(1, -1));
    } else {
      resources.push(seg);
    }
  }

  // Use action word as verb if last resource is one
  let verb = method.toLowerCase();
  const lastResource = resources[resources.length - 1];
  if (lastResource && actionWords.has(lastResource)) {
    verb = lastResource;
    resources.pop();
  }

  // Build: verb + Resources + ByParam1AndParam2
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const resourcePart = resources.map(cap).join("");
  const paramPart = pathParamNames.length
    ? "By" + pathParamNames.map(cap).join("And")
    : "";

  return verb + resourcePart + paramPart;
}

export function extractOperations(spec: any): OperationInfo[] {
  const ops: OperationInfo[] = [];
  const paths = spec.paths || {};

  for (const [path, methods] of Object.entries<any>(paths)) {
    const pathLevelParams = (methods as any).parameters || [];

    for (const [method, op] of Object.entries<any>(methods)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;

      // Merge path-level and operation-level params; operation params override
      const allParams = [...pathLevelParams, ...(op.parameters || [])].map((p: any) => resolveRef(spec, p));
      const paramMap = new Map();
      for (const p of allParams) {
        paramMap.set(`${p.in}:${p.name}`, p);
      }
      const mergedParams = [...paramMap.values()];

      const pathParams: string[] = [];
      const queryParams: ParamInfo[] = [];

      for (const p of mergedParams) {
        if (p.in === "path") pathParams.push(p.name);
        if (p.in === "query")
          queryParams.push({
            name: p.name,
            required: p.required || false,
            description: p.description,
          });
      }

      let bodySchema: any = undefined;
      let requiredBody: string[] = [];
      const content = op.requestBody?.content?.["application/json"];
      if (content?.schema) {
        bodySchema = deepResolveRefs(spec, content.schema);
        if (bodySchema?.allOf) {
          const merged: any = { type: "object", properties: { ...(bodySchema.properties || {}) }, required: [...(bodySchema.required || [])] };
          for (const part of bodySchema.allOf) {
            const resolved = deepResolveRefs(spec, part);
            Object.assign(merged.properties, resolved?.properties || {});
            merged.required.push(...(resolved?.required || []));
          }
          bodySchema = merged;
        }
        requiredBody = bodySchema?.required || [];
      }

      ops.push({
        operationId: op.operationId || deriveOperationId(method, path),
        method: method.toUpperCase(),
        path,
        summary: op.summary || op.description,
        pathParams,
        queryParams,
        bodySchema,
        requiredBody,
      });
    }
  }

  const idCount = new Map<string, number>();
  for (const op of ops) {
    const count = idCount.get(op.operationId) || 0;
    if (count > 0) {
      op.operationId = `${op.operationId}${count + 1}`;
    }
    idCount.set(op.operationId, count + 1);
  }

  return ops;
}

export function findOperation(
  spec: any,
  operationId: string
): OperationInfo | null {
  return (
    extractOperations(spec).find((o) => o.operationId === operationId) || null
  );
}
