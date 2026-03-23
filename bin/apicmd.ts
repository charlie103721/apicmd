#!/usr/bin/env bun

import { saveConfig, loadConfig, listConfigs, isSpecStale, getBaseUrl } from "../src/config";
import type { ApiConfig } from "../src/config";
import { showApiHelp, showOperationHelp } from "../src/help";
import { execute, executeRaw } from "../src/execute";

const args = process.argv.slice(2);

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

function usage() {
  console.log(`
apicmd — turn any API into a CLI

Setup:
  apicmd init <url> --name <name> [--auth <header>] [--ttl <hours>]   Spec mode (OpenAPI)
  apicmd init <url> --name <name> [--auth <header>] --raw             Raw mode

Usage:
  apicmd <name> <operationId> [--param value]               Spec mode: call by operation
  apicmd <name> <METHOD> <path> [--param value]             Raw mode: call any endpoint
  apicmd <name> --help                                      List operations (spec) or history (raw)
  apicmd <name> <operationId> --help                        Show operation params

Management:
  apicmd list                                                Show registered APIs

Examples:
  apicmd init https://movo.work/api/openapi.json --name movo --auth 'Bearer \$KEY'
  apicmd init https://movo.work --name movo --auth 'Bearer \$KEY' --raw
  apicmd movo getProjects
  apicmd movo GET /api/projects
`);
}

async function init(initArgs: string[]) {
  let url = "";
  let name = "";
  let auth = "";
  let ttl = "";
  let raw = false;

  // First positional arg is the URL
  if (initArgs[0] && !initArgs[0].startsWith("--")) {
    url = initArgs[0];
    initArgs = initArgs.slice(1);
  }

  for (let i = 0; i < initArgs.length; i++) {
    if (initArgs[i] === "--name" && initArgs[i + 1]) name = initArgs[++i]!;
    if (initArgs[i] === "--auth" && initArgs[i + 1]) auth = initArgs[++i]!;
    if (initArgs[i] === "--ttl" && initArgs[i + 1]) ttl = initArgs[++i]!;
    if (initArgs[i] === "--raw") raw = true;
  }

  if (!name) {
    console.error("--name is required");
    process.exit(1);
  }

  if (!url) {
    console.error("URL is required: apicmd init <url> --name <name>");
    process.exit(1);
  }

  // Validate URL
  try {
    new URL(url);
  } catch {
    console.error(`Invalid URL: ${url}`);
    process.exit(1);
  }

  saveConfig({
    name,
    url,
    auth: auth || undefined,
    specTtlHours: ttl ? Number(ttl) : undefined,
    raw: raw || undefined,
  });

  const mode = raw ? "raw" : "spec";
  console.log(`Registered "${name}" (${mode} mode)`);
  if (!raw) {
    console.log(`Run: apicmd ${name} --help`);
  } else {
    console.log(`Run: apicmd ${name} GET /path`);
  }
}

/** Fetch spec from URL, cache it in config, return config with spec */
async function refreshSpec(config: ApiConfig): Promise<ApiConfig> {
  if (config.raw) return config;

  try {
    const headers: Record<string, string> = {};
    if (config.auth) {
      const authVal = config.auth.replace(/\$(\w+)/g, (_, name) => process.env[name] || "");
      if (authVal) headers["Authorization"] = authVal;
    }
    const res = await fetch(config.url, { headers });
    if (!res.ok) {
      console.error(`Failed to fetch spec: ${res.status} ${res.statusText}`);
      if (config.spec) {
        console.error("Using cached spec.");
        return config;
      }
      process.exit(1);
    }
    config.spec = (await res.json()) as any;
    config.specFetchedAt = new Date().toISOString();
    saveConfig(config);
  } catch (err: any) {
    if (config.spec) {
      console.error(`Spec fetch failed: ${err.message}. Using cached spec.`);
      return config;
    }
    console.error(`Spec fetch failed: ${err.message}`);
    process.exit(1);
  }

  return config;
}

async function main() {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    usage();
    process.exit(0);
  }

  if (args[0] === "init") {
    await init(args.slice(1));
    return;
  }

  if (args[0] === "list") {
    const apis = listConfigs();
    if (apis.length === 0) {
      console.log("No APIs registered. Run: apicmd init --help");
    } else {
      console.log("\nRegistered APIs:\n");
      for (const name of apis) {
        const config = loadConfig(name);
        const mode = config?.raw ? "raw" : "spec";
        console.log(`  ${name.padEnd(20)} ${getBaseUrl(config!)} (${mode})`);
      }
      console.log();
    }
    return;
  }

  // API command: apicmd <name> ...
  const apiName = args[0]!;
  let config = loadConfig(apiName);
  if (!config) {
    console.error(`API "${apiName}" not found. Run: apicmd list`);
    process.exit(1);
  }

  const subArgs = args.slice(1);

  // apicmd <name> --help
  if (subArgs.length === 0 || subArgs[0] === "--help" || subArgs[0] === "-h") {
    config = await refreshSpec(config);
    if (config.spec) {
      showApiHelp(config);
    } else {
      const baseUrl = getBaseUrl(config);
      console.log(`\n${apiName} (raw mode)\n`);
      console.log(`  Base URL: ${baseUrl}`);
      console.log(`  Auth: ${config.auth ? "configured" : "none"}\n`);

      if (config.history?.length) {
        console.log("Known endpoints (from usage history):\n");
        const maxMethod = Math.max(...config.history.map((h) => h.method.length));
        const maxPath = Math.max(...config.history.map((h) => h.path.length));
        for (const h of config.history) {
          const m = h.method.padEnd(maxMethod + 1);
          const p = h.path.padEnd(maxPath + 2);
          const params = h.params.length ? h.params.map((p) => `--${p}`).join(" ") : "";
          console.log(`  ${m} ${p} ${params}`);
        }
        console.log();
      }

      console.log(`Usage: apicmd ${apiName} <METHOD> <path> [--param value]\n`);
    }
    return;
  }

  const first = subArgs[0]!;

  // Raw mode: first arg is an HTTP method
  if (HTTP_METHODS.has(first.toUpperCase())) {
    const method = first.toUpperCase();
    const path = subArgs[1];
    if (!path || path.startsWith("--")) {
      console.error(`Usage: apicmd ${apiName} ${method} /path [--param value]`);
      process.exit(1);
    }
    await executeRaw(config, method, path, subArgs.slice(2));
    return;
  }

  // Spec mode: first arg is an operationId
  if (!config.spec || isSpecStale(config)) {
    if (!config.raw) {
      config = await refreshSpec(config);
    } else if (!config.spec) {
      console.error(`API "${apiName}" is in raw mode. Use: apicmd ${apiName} GET /path`);
      process.exit(1);
    }
  }

  const operationId = first;

  if (subArgs.includes("--help") || subArgs.includes("-h")) {
    config = await refreshSpec(config);
    showOperationHelp(config, operationId);
    return;
  }

  await execute(config, operationId, subArgs.slice(1));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
