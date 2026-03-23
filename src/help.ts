import { extractOperations, findOperation } from "./spec";
import type { ApiConfig } from "./config";

export function showApiHelp(config: ApiConfig) {
  const ops = extractOperations(config.spec);
  const title = config.spec.info?.title || config.name;

  console.log(`\n${title} (${config.name})\n`);

  if (ops.length === 0) {
    console.log("No operations found.");
    return;
  }

  // Group by tag or just list
  const maxId = Math.max(...ops.map((o) => o.operationId.length));

  for (const op of ops) {
    const id = op.operationId.padEnd(maxId + 2);
    const summary = op.summary || "";

    // Collect all required params
    const required: string[] = [];
    for (const p of op.pathParams) required.push(`--${p} *`);
    if (op.bodySchema?.properties) {
      const reqSet = new Set(op.requiredBody);
      for (const [name] of Object.entries<any>(op.bodySchema.properties)) {
        if (reqSet.has(name)) required.push(`--${name} *`);
      }
    }

    const params = required.length ? `  ${required.join(" ")}` : "";
    console.log(`  ${id} ${summary}${params}`);
  }

  console.log(`\nUsage: apicmd ${config.name} <operationId> [--param value]\n`);
}

export function showOperationHelp(config: ApiConfig, operationId: string) {
  const op = findOperation(config.spec, operationId);
  if (!op) {
    console.error(`Unknown operation: ${operationId}`);
    process.exit(1);
  }

  console.log(`\n${op.operationId}  ${op.method} ${op.path}`);
  if (op.summary) console.log(`  ${op.summary}`);
  console.log();

  if (op.pathParams.length) {
    console.log("Path parameters (required):");
    for (const p of op.pathParams) {
      console.log(`  --${p}`);
    }
    console.log();
  }

  if (op.queryParams.length) {
    console.log("Query parameters:");
    for (const q of op.queryParams) {
      const req = q.required ? " (required)" : "";
      const desc = q.description ? `  ${q.description}` : "";
      console.log(`  --${q.name}${req}${desc}`);
    }
    console.log();
  }

  if (op.bodySchema?.properties) {
    console.log("Body parameters:");
    const props = op.bodySchema.properties;
    const required = new Set(op.requiredBody);
    for (const [name, schema] of Object.entries<any>(props)) {
      const req = required.has(name) ? " (required)" : "";
      const type = schema.type ? ` [${schema.type}]` : "";
      const desc = schema.description ? `  ${schema.description}` : "";
      console.log(`  --${name}${type}${req}${desc}`);
    }
    console.log();
  }
}
