import {appendFile} from "fs/promises"
import {homedir} from "os"
import {join} from "path"

// https://docs.github.com/en/copilot/concepts/billing/copilot-requests
const multipliers: Record<string, number> = {
    "gpt-5-mini": 0,
    "gpt-4.1": 0,
    "gpt-4o": 0,
    "raptor-mini": 0,
    "grok-code-fast-1": 0.25,
    "gpt-5.1-codex-mini": 0.33,
    "claude-haiku-4.5": 0.33,
    "gemini-3-flash-preview": 0.33,
    "claude-opus-4.5": 3,
    "claude-opus-4.6": 3,
    "claude-opus-41": 10,
}

function getMultiplier(model: string): number {
    const result = multipliers[model]
    return result === undefined ? 1 : result
}

// --- In-memory metrics ---

const metrics: Record<string, { count: number; cost: number }> = {}

function record(model: string, initiator: string) {
    const multiplier = getMultiplier(model)
    const cost = initiator === "agent" ? 0 : multiplier
    const key = `${model}|${initiator}`
    const entry = metrics[key]
    if (entry) {
        entry.count++
        entry.cost += cost
    } else {
        metrics[key] = {count: 1, cost}
    }
}

function formatCost(cost: number): string {
    const width = 6
    if (cost === Math.floor(cost)) {
        const whole = cost.toString()
        return whole.padStart(width - 3) + "   "
    } else {
        const parts = cost.toFixed(2).split(".")
        return parts[0].padStart(width - 3) + "." + parts[1]
    }
}

function renderTable(): string {
    const keys = Object.keys(metrics).sort()
    if (keys.length === 0) return "No Copilot requests recorded yet."

    const rows = keys.map((key) => {
        const [model, initiator] = key.split("|")
        const entry = metrics[key]
        return {model, initiator, count: entry.count, cost: entry.cost}
    })

    const modelWidth = Math.max(5, ...rows.map((r) => r.model.length))
    const pad = (v: any, w: number) => w > 0 ? v.toString().padEnd(w) : v.toString().padStart(-w)
    const lines = [
        `| ${"Model".padEnd(modelWidth)} | Initiator | Count |  Cost  |`,
        `|${"-".repeat(modelWidth + 2)}|-----------|-------|--------|`,
        ...rows.map(r => `| ${pad(r.model, modelWidth)} | ${pad(r.initiator, 9)} | ${pad(r.count, -5)} | ${formatCost(r.cost)} |`),
    ]
    return lines.join("\n")
}

// --- File logging ---

const dataDir = process.env.XDG_DATA_HOME || join(homedir(), ".local/share")
const logFile = join(dataDir, "opencode", "log", "copilot-stats.txt")
const instanceId = Math.random().toString(36).substring(2, 6)

const timestamp = () => new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60 * 1000).toISOString().replace(/[TZ]/g, " ").trim()

function logStats(model: string, initiator: string) {
    const multiplier = getMultiplier(model)
    const cost = initiator === "agent" ? 0 : multiplier
    const totalCost = Object.values(metrics).reduce((acc, entry) => acc + entry.cost, 0)

    const line = [
        timestamp(),
        "|",
        instanceId,
        "|",
        model.substring(0, 28).padEnd(28),
        "|",
        initiator.padEnd(6),
        "|",
        "x",
        multiplier.toFixed(2).padStart(5),
        "|",
        "cost",
        cost.toFixed(2).padStart(5),
        "|",
        "total",
        totalCost.toFixed(2).padStart(6)
    ].join(" ") + "\n"

    appendFile(logFile, line).catch(() => {
    })
}

function logError(error: any) {
    const line = [
        timestamp(),
        "|",
        instanceId,
        "|",
        "ERROR",
        "|",
        (error || "").toString()
    ].join(" ") + "\n"

    appendFile(logFile, line).catch(() => {
    })
}

// --- Fetch interception ---

async function extractModel(request: Request): Promise<string> {
    if (request.headers.get("content-type") === "application/json" && request.body) {
        try {
            const body = (await request.clone().json()) as { model?: string }
            return body.model || "unknown"
        } catch (e) {
            logError(e)
        }
    }
    return "unknown"
}

const originalFetch = globalThis.fetch

if (originalFetch) {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const request = new Request(input, init)
        const headers = new Headers(request.headers)
        const initiator = headers.get("x-initiator")

        if (request.url.includes("github.com") || request.url.includes("ghe.com")) {
            if (initiator) {
                const model = await extractModel(request)
                record(model, initiator)
                logStats(model, initiator)
            } else {
                logError("Missing x-initiator header")
            }
        }

        return originalFetch(new Request(request, {headers}))
    }
} else {
    logError("Unable to override fetch")
}

// --- Plugin export ---

export default async () => ({
    tool: {
        copilot_stats: {
            description: "Show GitHub Copilot premium request usage for this OpenCode instance",
            args: {},
            async execute() {
                return renderTable()
            },
        },
    },
})
