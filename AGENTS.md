# copilot-stats

An OpenCode plugin that tracks GitHub Copilot premium request usage and displays metrics inside the TUI.

## Problem

OpenCode's status bar shows token counts and USD cost. For GitHub Copilot, cost is always $0 because Copilot is subscription-based. The real cost unit is **premium requests** — each model has a fixed multiplier that determines how much quota a prompt consumes. Some requests are free (sent as "agent" via subagents). The existing status bar provides no visibility into this.

This plugin was preceded by a proof-of-concept fetch interceptor that logged metrics to a file. It worked, but had three limitations:

1. Tracks metrics globally — one scope for the entire OpenCode process, no per-session breakdown
2. Requires reading the log file in a separate terminal window
3. Cannot display metrics inside OpenCode's TUI

## Architecture Decisions

### Why not modify the status bar or `/status` dialog?

OpenCode's UI has no plugin extensibility. The status popover (`packages/app/src/components/status-popover.tsx`) and `/status` dialog (`packages/opencode/src/cli/cmd/tui/component/dialog-status.tsx`) are hardcoded SolidJS components. The plugin `Hooks` interface provides backend hooks only — no mechanism to inject custom UI sections, tabs, or widgets.

### Why a custom tool + slash command?

The plugin registers a tool via the `tool` hook. The tool's `execute` function has closure access to the plugin's in-memory metrics — no file I/O, no directory permissions, no API call faking. A slash command (`/copilot-stats`) tells the LLM to call this tool and display the result.

The tool returns a pre-formatted markdown table. The LLM does not format the data — the plugin controls the output entirely.

### Why `globalThis.fetch` interception?

OpenCode's CopilotAuthPlugin (`packages/opencode/src/plugin/copilot.ts:122`) already wraps `globalThis.fetch` to add the `x-initiator` header. Our plugin wraps fetch the same way to intercept requests before they reach the Copilot API. This gives direct access to the request body (model name, last message role for type classification) and headers (`x-initiator` value: `"agent"` or `"user"`).

Alternative approaches considered:

- **`chat.headers` hook**: Provides `sessionID` and model info, but fires before the request — cannot see the full request body. Would enable per-session tracking but misses some detail.
- **`event` hook**: Receives bus events like `message.updated`, but these fire after the response — the model/initiator data is not directly available in the event payload.

The fetch wrapper is the most reliable interception point. Per-session tracking could be added later by combining the fetch wrapper with the `chat.headers` hook (which receives `sessionID`).

### Why keep file logging?

The append-only log file serves a different purpose than the tool: real-time debugging in a separate terminal (`tail -F`). Useful for watching subagent activity live. The log path follows XDG conventions — `$XDG_DATA_HOME/opencode/log/copilot-stats.txt`, defaulting to `~/.local/share/opencode/log/copilot-stats.txt`.

### Why `gpt-5-mini` for the command?

The `/copilot-stats` command sets `model: github-copilot/gpt-5-mini` in its frontmatter. This model has a 0x multiplier — the stats command itself costs zero premium requests. Using any other model would consume quota just to display quota information.

## Multiplier Table

The `multipliers` object in `plugins/copilot-stats.ts` is the single source of truth. Unlisted models default to 1x. Update the object when GitHub changes pricing — see the [billing documentation](https://docs.github.com/en/copilot/concepts/billing/copilot-requests).

## Conventions

This project follows the [Conventional Commits](https://www.conventionalcommits.org/) standard. Common types: `feat`, `fix`, `docs`, `refactor`, `chore`. Keep the subject line concise and use the body for context when needed.

## File Layout

Two files, both auto-discovered by OpenCode (no `opencode.json` changes needed):

| File | Purpose |
|------|---------|
| `plugins/copilot-stats.ts` | Plugin. Intercepts fetch, tracks metrics in memory, registers the `copilot_stats` tool, appends to a log file. Installed to `~/.config/opencode/plugins/`. |
| `commands/copilot-stats.md` | Slash command. Tells the LLM to call the tool using `gpt-5-mini` (0x multiplier) so viewing stats costs nothing. Installed to `~/.config/opencode/commands/`. |

## OpenCode Plugin System Reference

Key files in the OpenCode source (v1.1.53; clone from https://github.com/anomalyco/opencode, treated as immutable reference):

| Area | File | Notes |
|------|------|-------|
| Plugin types | `packages/plugin/src/index.ts` | `Hooks` interface, `PluginInput` type |
| Tool definition | `packages/plugin/src/tool.ts` | `ToolDefinition` helper |
| Plugin loader | `packages/opencode/src/plugin/index.ts` | How plugins are loaded and hooks triggered |
| Copilot auth | `packages/opencode/src/plugin/copilot.ts` | Sets `x-initiator` header, forces agent for subagents |
| Config & auto-discovery | `packages/opencode/src/config/config.ts` | Glob patterns for plugins, commands, tools |
| Tool registry | `packages/opencode/src/tool/registry.ts` | How plugin tools join the tool list |
| Command execution | `packages/opencode/src/session/prompt.ts` | How slash command templates become prompts |
| Path resolution | `packages/opencode/src/global/index.ts` | `Global.Path` — XDG-based log, data, config dirs |
| Status dialog (TUI) | `packages/opencode/src/cli/cmd/tui/component/dialog-status.tsx` | Hardcoded, not extensible |
| Status popover (Web) | `packages/app/src/components/status-popover.tsx` | Hardcoded, not extensible |

### Plugin auto-discovery paths

OpenCode scans these directories for `{plugin,plugins}/*.{ts,js}`:

1. `~/.config/opencode/`
2. `.opencode/` (project-local, walks up to worktree root)
3. `~/.opencode/`

Same directories are scanned for `{command,commands}/**/*.md` and `{tool,tools}/*.{ts,js}`.

### How `x-initiator` is determined

In `packages/opencode/src/plugin/copilot.ts`:

- **Line 122**: The CopilotAuthPlugin's custom fetch inspects the request body. If the last message's role is not `"user"`, the request is classified as `"agent"`. Otherwise `"user"`.
- **Line 324**: The `chat.headers` hook overrides `x-initiator` to `"agent"` for any session with a `parentID` (subagent/child sessions).

Agent requests do not consume premium quota.

### Do not import `@opencode-ai/plugin`

Plugin files symlinked from `~/.config/opencode/plugins/` are resolved by Bun from the symlink's real path (the source directory), not from `~/.config/opencode/`. Since `@opencode-ai/plugin` is only installed in OpenCode's own `node_modules`, the import fails with `Cannot find module`. The `tool()` helper from that package is just a passthrough that adds TypeScript types — it's not needed at runtime. Define the tool object inline instead.
