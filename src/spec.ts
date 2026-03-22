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
function resolveRef(spec: any, obj: any): any {
  if (!obj || typeof obj !== "object") return obj;
  if (obj.$ref) {
    const path = obj.$ref.replace(/^#\//, "").split("/");
    let resolved = spec;
    for (const seg of path) {
      resolved = resolved?.[seg];
    }
    return resolved || obj;
  }
  return obj;
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
    for (const [method, op] of Object.entries<any>(methods)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;

      const pathParams: string[] = [];
      const queryParams: ParamInfo[] = [];

      for (const p of op.parameters || []) {
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
        bodySchema = resolveRef(spec, content.schema);
        requiredBody = bodySchema.required || [];
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
