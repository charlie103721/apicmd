# apicmd

Turn any API into a CLI. Designed for LLM agents, works great for humans too.

Give it an OpenAPI spec URL — it generates a CLI with named operations, parameter validation, and `--help` that always shows the latest endpoints. No spec? Raw mode works with any HTTP API and learns endpoints from your usage history.

## Install

```bash
# npm
npx apicmd

# bun
bunx apicmd
```

## Quick Start

```bash
# Spec mode — point to an OpenAPI spec
apicmd init https://api.example.com/openapi.json --name myapi --auth 'Bearer $API_KEY'
apicmd myapi --help              # list all operations
apicmd myapi listUsers           # call by operation name

# Raw mode — any HTTP API, no spec needed
apicmd init https://api.example.com --name myapi --auth 'Bearer $API_KEY' --raw
apicmd myapi GET /users          # call any endpoint
apicmd myapi --help              # shows endpoints from your usage history
```

## Setup

```bash
apicmd init <url> --name <name> [--auth <header>] [--ttl <hours>]   # Spec mode
apicmd init <url> --name <name> [--auth <header>] --raw             # Raw mode
```

| Flag | Description |
|------|-------------|
| `<url>` | OpenAPI spec URL (spec mode) or base URL (raw mode) |
| `--name` | Short name for the API (used in all commands) |
| `--auth` | Auth header, supports env vars: `'Bearer $MY_KEY'` |
| `--ttl` | Spec cache TTL in hours (default: 24) |
| `--raw` | Raw mode — skip spec, use HTTP method + path |

## Usage

### Spec Mode

```bash
apicmd myapi --help                                    # list all operations with required params
apicmd myapi createIssue --help                        # show all params for an operation
apicmd myapi createIssue --title "Bug" --priority 2    # call an operation
```

Operations are auto-generated from the OpenAPI spec. The spec is cached and auto-refreshed based on the TTL (default 24 hours). `--help` always fetches the latest.

### Raw Mode

```bash
apicmd myapi GET /api/users                                        # GET request
apicmd myapi POST /api/users --name "Alice" --email "a@b.com"      # POST with JSON body
apicmd myapi GET /api/users/{id} --id 123                          # path params via {placeholder}
```

How params are resolved:
- `{key}` in the path → replaced with `--key` value
- Remaining params on GET → query string
- Remaining params on POST/PUT/PATCH → JSON body
- Numbers and booleans are auto-coerced

### Both Modes

Raw HTTP calls (`apicmd myapi GET /path`) work on any registered API, even spec mode ones. Use whichever is more convenient.

## Auth

Auth supports env var references — the actual secret is never stored on disk:

```bash
apicmd init https://api.example.com/openapi.json --name myapi --auth 'Bearer $MY_API_KEY'
```

Literal keys also work:

```bash
apicmd init https://api.example.com/openapi.json --name myapi --auth 'Bearer sk-abc123'
```

## Management

```bash
apicmd list          # show all registered APIs
apicmd --help        # show usage
```

## Config

Stored in `~/.apicmd/<name>.json`:

```json
{
  "name": "myapi",
  "url": "https://api.example.com/openapi.json",
  "auth": "Bearer $MY_API_KEY"
}
```

That's it. The spec is cached after the first `--help` or operation call and auto-refreshed when stale.

## For LLM Agents

Add this to your agent's global instructions (e.g. `~/.claude/CLAUDE.md`):

```markdown
Use `apicmd` CLI for API calls. Run `apicmd list` to see available APIs,
`apicmd <name> --help` for operations, `apicmd <name> <op> --help` for params.
```

The LLM runs `--help` once to discover all operations and required params, then calls them directly. No curl, no JSON construction, no auth headers.

## License

MIT
