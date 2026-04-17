# Backlog.md MCP Implementation (MVP)

This directory exposes a minimal stdio MCP surface so local agents can work with backlog.md without duplicating business
logic.

## What’s included

- `server.ts` / `createMcpServer()` – bootstraps a stdio-only server that extends `Core` and registers project, task, milestone, Definition of Done defaults, and document tools (`project_*`, `task_*`, `milestone_*`, `definition_of_done_defaults_*`, `document_*`) for MCP clients.
- `tools/project/` – project bootstrap tooling (e.g. `project_init`) exposed in both fallback and normal mode.
- `tasks/` – consolidated task tooling that delegates to shared Core helpers (including plan/notes/AC editing).
- `documents/` – document tooling layered on `Core`’s document helpers for list/view/create/update/search flows.
- `tools/dependency-tools.ts` – dependency helpers reusing shared builders.
- `resources/` – lightweight resource adapters for agents.
- `guidelines/mcp/` – task workflow content surfaced via MCP.

Everything routes through existing Core APIs so the MCP layer stays a protocol wrapper.

## Project tools

### `project_init`

Initializes a new Backlog.md project in the current workspace from MCP. Mirrors the non-interactive parts of `backlog init`, so agents can bootstrap a project without dropping to the CLI.

Available in MCP fallback mode (when the workspace has no Backlog project yet) and in normal mode. On success, the server upgrades in place and exposes the full toolset (`task_create`, `task_list`, etc.) without a restart.

**Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectName` | string | yes | Human-readable project name written to `config.yml`. |
| `backlogDirectory` | string | no | Backlog folder (e.g. `backlog`, `.backlog`, custom path). Defaults to `backlog`. |
| `configLocation` | `"folder"` \| `"root"` | no | Where `config.yml` lives. Defaults to `folder`. |
| `taskPrefix` | string | no | Custom task prefix (e.g. `ISSUE`). Defaults to `task`. |

**Creates the standard layout** (identical to `backlog init`):

```
backlog/
├── archive/{tasks,drafts,milestones}/
├── completed/
├── config.yml
├── decisions/
├── docs/
├── drafts/
├── milestones/
└── tasks/
```

**Example call**

```json
{
  "name": "project_init",
  "arguments": {
    "projectName": "Acme Platform",
    "backlogDirectory": "backlog",
    "configLocation": "folder",
    "taskPrefix": "ACME"
  }
}
```

**Behavior notes**

- If the workspace is already initialized, the tool returns an error containing `already initialized`. Use `backlog init` from the CLI for interactive re-initialization.
- `project_init` does not install agent instruction files (`CLAUDE.md`/`AGENTS.md`) and does not register MCP clients. Those flows remain CLI-only because they are interactive.

## Development workflow

```bash
# Run the stdio server from the repo
bun run cli mcp start

# Or via the globally installed CLI
backlog mcp start

# Tests
bun test src/test/mcp-*.test.ts
```

The test suite keeps to the reduced surface area and focuses on happy-path coverage for tasks, dependencies, and server
bootstrap.
