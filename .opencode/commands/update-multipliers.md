---
description: Update Copilot model multipliers from billing docs
---
Update the multiplier table in this project. Compare three sources, apply any changes, and report what you did. Do not commit.

## 1. Gather data

### GitHub Copilot models available locally

These model IDs come from the OpenCode model cache:

!`cat ~/.cache/opencode/models.json | python3 -c "import json,sys; data=json.load(sys.stdin); models=data.get('github-copilot',{}).get('models',{}); [print(m) for m in sorted(models.keys())]"`

### Current multipliers in the plugin

@plugins/copilot-stats.ts

### Current multiplier table in README

@README.md

### Billing documentation

Fetch https://docs.github.com/en/copilot/concepts/billing/copilot-requests and extract the "Model multipliers" table. Use the **paid plan** column. Skip models that are N/A for paid plans (Free-only models like Goldeneye).

## 2. Compare

The billing docs use display names (e.g. "Gemini 3 Flash"); the plugin uses lowercase hyphenated API model IDs (e.g. `gemini-3-flash-preview`). Map between them using the local cache as the authoritative source of API IDs.

For each model in the local cache, check whether it exists in `plugins/copilot-stats.ts` with the correct multiplier. Flag four categories:

- **Missing**: model in cache but not in the plugin. Add it with the multiplier from the billing docs (or 1 if the billing docs don't list it).
- **Changed**: model in both but multiplier differs from billing docs. Update to match the billing docs.
- **Removed**: model in the plugin but no longer in the cache. Leave it — it may reappear.
- **Undocumented**: model in cache and plugin but absent from the billing docs. Leave the existing multiplier unchanged and note it in the report.

For models that appear in the billing docs but not in the local cache: skip them. Without a confirmed API model ID from the cache, any ID would be a guess. Note them in the report so they can be added once they appear in the cache.

## 3. Apply changes

If there are differences:

1. Edit `plugins/copilot-stats.ts` — update the `multipliers` constant. Keep entries sorted by multiplier ascending, then alphabetically within each group.
2. Edit `README.md` — update the multiplier table to match. Same sort order.
3. Show a summary table of what changed (added, updated, unchanged, undocumented, skipped).

If everything is already up to date, say so and stop.
