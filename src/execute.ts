import type { ApiConfig } from "./config";
import { recordCall, getBaseUrl } from "./config";
import type { OperationInfo } from "./spec";
import { findOperation } from "./spec";

export function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1] as string | undefined;
      if (next && !next.startsWith("--")) {
        result[key] = next;
        i++;
      } else {
        result[key] = "true";
      }
    }
  }
  return result;
}

function resolveBaseUrl(config: ApiConfig): string {
  return getBaseUrl(config);
}

function resolveAuth(config: ApiConfig): string | null {
  if (!config.auth) return null;
  return config.auth.replace(/\$(\w+)/g, (_, name) => process.env[name] || "");
}

async function doFetch(url: string, method: string, auth: string | null, body: any | null) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (auth) headers["Authorization"] = auth;

  const fetchOpts: RequestInit = { method, headers };
  if (body && method !== "GET") {
    fetchOpts.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url, fetchOpts);
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      console.log(JSON.stringify(json, null, 2));
    } catch {
      console.log(text);
    }
    if (!res.ok) process.exit(1);
    return res.status;
  } catch (err: any) {
    console.error(`Request failed: ${err.message}`);
    process.exit(1);
  }
}

// --- Raw mode: apicmd <name> GET /path --param value ---

export async function executeRaw(
  config: ApiConfig,
  method: string,
  path: string,
  rawArgs: string[]
) {
  const params = parseArgs(rawArgs);
  const baseUrl = resolveBaseUrl(config);
  const auth = resolveAuth(config);

  // Replace {param} placeholders in path
  let url = path;
  for (const [key, val] of Object.entries(params)) {
    const placeholder = `{${key}}`;
    if (url.includes(placeholder)) {
      url = url.replace(placeholder, encodeURIComponent(val));
      delete params[key];
    }
  }

  // For GET, remaining params become query string; for others, they become JSON body
  let body: any = null;
  if (method === "GET" || method === "HEAD") {
    const queryParts: string[] = [];
    for (const [k, v] of Object.entries(params)) {
      queryParts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
    if (queryParts.length) url += "?" + queryParts.join("&");
  } else if (Object.keys(params).length > 0) {
    body = {};
    for (const [k, v] of Object.entries(params)) {
      // Try to parse numbers and booleans
      if (v === "true") body[k] = true;
      else if (v === "false") body[k] = false;
      else if (!isNaN(Number(v)) && v !== "") body[k] = Number(v);
      else {
        try { body[k] = JSON.parse(v); } catch { body[k] = v; }
      }
    }
  }

  // Strip /api prefix if baseUrl already ends with /api
  if (baseUrl.endsWith("/api") && url.startsWith("/api/")) {
    url = url.slice(4);
  }

  const status = await doFetch(baseUrl + url, method, auth, body);
  // Record with template path (original {placeholders}), not resolved URL
  recordCall(config.name, method, path, Object.keys(parseArgs(rawArgs)), status!);
}

// --- Spec mode: apicmd <name> <operationId> --param value ---

function buildUrl(
  baseUrl: string,
  op: OperationInfo,
  params: Record<string, string>
): string {
  let url = op.path;

  for (const p of op.pathParams) {
    const val = params[p];
    if (!val) {
      console.error(`Missing required path param: --${p}`);
      process.exit(1);
    }
    url = url.replace(`{${p}}`, encodeURIComponent(val));
  }

  const queryParts: string[] = [];
  for (const q of op.queryParams) {
    if (params[q.name]) {
      queryParts.push(
        `${encodeURIComponent(q.name)}=${encodeURIComponent(params[q.name]!)}`
      );
    }
  }
  if (queryParts.length) url += "?" + queryParts.join("&");

  if (baseUrl.endsWith("/api") && url.startsWith("/api/")) {
    url = url.slice(4);
  }

  return baseUrl + url;
}

function buildBody(
  op: OperationInfo,
  params: Record<string, string>
): any | null {
  if (!op.bodySchema) return null;

  const body: Record<string, any> = {};
  const props = op.bodySchema.properties || {};

  for (const [key, schema] of Object.entries<any>(props)) {
    if (params[key] !== undefined) {
      if (schema.type === "number" || schema.type === "integer") {
        body[key] = Number(params[key]);
      } else if (schema.type === "boolean") {
        body[key] = params[key] === "true";
      } else if (schema.type === "array") {
        try { body[key] = JSON.parse(params[key]); } catch { body[key] = params[key].split(","); }
      } else {
        body[key] = params[key];
      }
    }
  }

  for (const r of op.requiredBody) {
    if (body[r] === undefined) {
      console.error(`Missing required body param: --${r}`);
      process.exit(1);
    }
  }

  return Object.keys(body).length > 0 ? body : null;
}

export async function execute(
  config: ApiConfig,
  operationId: string,
  rawArgs: string[]
) {
  const op = findOperation(config.spec, operationId);
  if (!op) {
    console.error(`Unknown operation: ${operationId}`);
    console.error(`Run: apicmd ${config.name} --help`);
    process.exit(1);
  }

  const params = parseArgs(rawArgs);
  const baseUrl = resolveBaseUrl(config);
  const auth = resolveAuth(config);
  const url = buildUrl(baseUrl, op, params);
  const body = buildBody(op, params);

  const status = await doFetch(url, op.method, auth, body);
  recordCall(config.name, op.method, op.path, Object.keys(params), status!);
}
