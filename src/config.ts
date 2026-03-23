import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, chmodSync, renameSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CONFIG_DIR = join(homedir(), ".apicmd");

export interface CallRecord {
  method: string;
  path: string;       // with {placeholders} preserved
  params: string[];   // param names used
  lastCalled: string; // ISO timestamp
  callCount: number;
  lastStatus: number; // HTTP status code
}

const DEFAULT_SPEC_TTL_HOURS = 24;

export interface ApiConfig {
  name: string;
  url: string;             // spec URL (spec mode) or base URL (raw mode)
  auth?: string;
  spec?: any;
  specFetchedAt?: string;  // ISO timestamp
  specTtlHours?: number;   // configurable TTL in hours
  raw?: boolean;           // explicit raw mode — skip spec discovery
  history?: CallRecord[];
}

/** Derive base URL from the config URL, preserving path segments */
export function getBaseUrl(config: ApiConfig): string {
  try {
    const u = new URL(config.url);
    let path = u.pathname;
    // In spec mode, strip the spec filename
    if (!config.raw) {
      path = path.replace(/\/(openapi|swagger)\.(json|yaml|yml)$/i, "");
    }
    // Remove trailing slash
    path = path.replace(/\/$/, "");
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return config.url;
  }
}

export function isSpecStale(config: ApiConfig): boolean {
  if (!config.spec || !config.specFetchedAt) return true;
  const ttlMs = (config.specTtlHours ?? DEFAULT_SPEC_TTL_HOURS) * 60 * 60 * 1000;
  const fetchedAt = new Date(config.specFetchedAt).getTime();
  if (isNaN(fetchedAt)) return true;
  const age = Date.now() - fetchedAt;
  return age > ttlMs;
}

const SAFE_NAME_RE = /^[a-zA-Z0-9_-]+$/;

/** Validate that a config name contains no path traversal characters. */
export function safeName(name: string): string {
  if (!SAFE_NAME_RE.test(name)) {
    throw new Error(
      `Invalid API name "${name}". Only letters, digits, hyphens, and underscores are allowed.`
    );
  }
  return name;
}

function ensureDir() {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
}

export function saveConfig(config: ApiConfig) {
  ensureDir();
  const filePath = join(CONFIG_DIR, `${safeName(config.name)}.json`);
  const tmpPath = filePath + ".tmp." + process.pid;
  writeFileSync(tmpPath, JSON.stringify(config, null, 2));
  chmodSync(tmpPath, 0o600);
  renameSync(tmpPath, filePath);
}

export function loadConfig(name: string): ApiConfig | null {
  safeName(name);
  const path = join(CONFIG_DIR, `${name}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function recordCall(name: string, method: string, path: string, params: string[], status: number) {
  safeName(name);
  const config = loadConfig(name);
  if (!config) return;

  if (!config.history) config.history = [];

  // Normalize path: replace actual values back to {placeholders} pattern
  // e.g. /api/projects/abc-123/issues → keep as-is, the caller passes the template path
  const existing = config.history.find((h) => h.method === method && h.path === path);
  if (existing) {
    existing.callCount++;
    existing.lastCalled = new Date().toISOString();
    existing.lastStatus = status;
    // Merge any new params
    for (const p of params) {
      if (!existing.params.includes(p)) existing.params.push(p);
    }
  } else {
    config.history.push({
      method,
      path,
      params,
      lastCalled: new Date().toISOString(),
      callCount: 1,
      lastStatus: status,
    });
  }

  saveConfig(config);
}

export function listConfigs(): string[] {
  ensureDir();
  return readdirSync(CONFIG_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""));
}
