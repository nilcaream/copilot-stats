# copilot-stats

An [OpenCode](https://opencode.ai) plugin that tracks GitHub Copilot premium request usage for the active session.

GitHub Copilot bills by **premium requests**, not tokens or dollars. Each model carries a fixed multiplier that determines how much quota a single prompt consumes. OpenCode's built-in status bar shows token counts and USD cost, but for Copilot users cost is always $0 and the real budget unit -- premium requests -- stays invisible.

This plugin makes it visible. It intercepts outgoing requests, records the model and initiator for each one, and reports cumulative usage through a `/copilot-stats` slash command directly inside the TUI.

## Example output

```
| Model            | Initiator | Count |  Cost  |
|------------------|-----------|-------|--------|
| claude-haiku-4.5 | user      |    10 |   3.30 |
| claude-opus-4.6  | agent     |    50 |   0    |
| claude-opus-4.6  | user      |    30 |  90    |
| gpt-5-mini       | agent     |   321 |   0    |
| gpt-5-mini       | user      |    77 |   0    |
```

**Cost** reflects the premium request multiplier for each model. Agent-initiated requests (subagents, tool calls) cost zero regardless of the model. The `/copilot-stats` command itself uses `gpt-5-mini` (0x multiplier), so checking your stats never consumes quota.

## Installation

Clone the repository and symlink the two files into your OpenCode configuration directory:

```bash
mkdir -p ~/.config/opencode/{plugins,commands}
ln -sf "$(pwd)/plugins/copilot-stats.ts" ~/.config/opencode/plugins/
# For GitHub
ln -sf "$(pwd)/commands/copilot-stats.md" ~/.config/opencode/commands/
# For GitHub Enterprise
ln -sf "$(pwd)/commands/copilot-stats-enterprise.md" ~/.config/opencode/commands/copilot-stats.md
```

Symlinks keep the installed files in sync with the repository — a `git pull` updates them automatically.

Alternatively, copy the files if you prefer a standalone installation:

```bash
cp plugins/copilot-stats.ts ~/.config/opencode/plugins/
# For GitHub
cp commands/copilot-stats.md ~/.config/opencode/commands/
# For GitHub Enterprise
cp commands/copilot-stats-enterprise.md ~/.config/opencode/commands/copilot-stats.md
```

Restart OpenCode. Type `/copilot-stats` in any session to view your usage.

## Log file

The plugin appends a plain-text log to OpenCode's log directory:

```
$XDG_DATA_HOME/opencode/log/copilot-stats.txt
```

On most systems `XDG_DATA_HOME` defaults to `~/.local/share`, so the full path is `~/.local/share/opencode/log/copilot-stats.txt`. If you have set `XDG_DATA_HOME` to a custom value, the log follows it.

Each line records a single request with its timestamp, model, initiator, and running totals. Useful for real-time monitoring in a separate terminal:

```bash
tail -F "${XDG_DATA_HOME:-$HOME/.local/share}/opencode/log/copilot-stats.txt"
```

## Privacy and security

This plugin operates entirely within the OpenCode process. It deserves scrutiny -- any code that wraps `globalThis.fetch` should -- so here is exactly what it does and does not do.

**What it does:**

- Reads the `model` field from outgoing request bodies and the `x-initiator` header that OpenCode already sets.
- Stores request counts and costs in memory for the lifetime of the process.
- Appends one line per request to a local log file.

**What it does not do:**

- It does not contact any external service, endpoint, or server.
- It does not modify, delay, redirect, or interfere with requests to GitHub or any other host.
- It does not read, store, or log authentication tokens, API keys, cookies, or any credentials.
- It does not access response bodies or any data returned by GitHub.
- It does not transmit any data outside the local machine.

The full source is a single file (`plugins/copilot-stats.ts`) -- short enough to read in a few minutes. You are encouraged to review it before installing.

## Multiplier table

Source: [GitHub Copilot billing documentation](https://docs.github.com/en/copilot/concepts/billing/copilot-requests)

| Model                  | Multiplier |
|------------------------|------------|
| gpt-5-mini             | 0          |
| gpt-4.1                | 0          |
| gpt-4o                 | 0          |
| raptor-mini            | 0          |
| grok-code-fast-1       | 0.25       |
| gpt-5.1-codex-mini     | 0.33       |
| claude-haiku-4.5       | 0.33       |
| gemini-3-flash-preview | 0.33       |
| claude-opus-4.5        | 3          |
| claude-opus-4.6        | 3          |
| claude-opus-41         | 10         |

All unlisted models default to 1x. This table is hardcoded in the plugin; update it manually when GitHub changes pricing.

## License

Apache-2.0
