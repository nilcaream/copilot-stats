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

type RequestType = "prompt" | "tool" | "continuation" | "compaction" | "unknown"

// --- In-memory metrics ---

const metrics: Record<string, { count: number; cost: number }> = {}

function record(model: string, initiator: string, type: RequestType) {
    const multiplier = getMultiplier(model)
    const cost = initiator === "agent" ? 0 : multiplier
    const key = `${model}|${initiator}|${type}`
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
        const [model, initiator, type] = key.split("|")
        const entry = metrics[key]
        return {model, initiator, type, count: entry.count, cost: entry.cost}
    })

    const modelWidth = Math.max(5, ...rows.map((r) => r.model.length))
    const typeWidth = Math.max(4, ...rows.map((r) => r.type.length))
    const pad = (v: any, w: number) => w > 0 ? v.toString().padEnd(w) : v.toString().padStart(-w)
    const lines = [
        `| ${"Model".padEnd(modelWidth)} | Initiator | ${"Type".padEnd(typeWidth)} | Count |  Cost  |`,
        `|${"-".repeat(modelWidth + 2)}|-----------|${"-".repeat(typeWidth + 2)}|-------|--------|`,
        ...rows.map(r => `| ${pad(r.model, modelWidth)} | ${pad(r.initiator, 9)} | ${pad(r.type, typeWidth)} | ${pad(r.count, -5)} | ${formatCost(r.cost)} |`),
    ]
    return lines.join("\n")
}

// --- File logging ---

const dataDir = process.env.XDG_DATA_HOME || join(homedir(), ".local/share")
const logFile = join(dataDir, "opencode", "log", "copilot-stats.txt")
const instanceId = Math.random().toString(36).substring(2, 6)

const timestamp = () => new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60 * 1000).toISOString().replace(/[TZ]/g, " ").trim()

// Upgraded to client.app.log once the plugin function is called.
// Before that, errors during module init are silently dropped — unavoidable
// because client is not available at fetch-wrapper setup time.
let logError: (error: any) => void = () => {}

function makeLogError(client: any): (error: any) => void {
    return (error: any) => {
        const message = (error || "").toString()
        // Write to OpenCode's structured log (visible in ~/.local/share/opencode/log/*.log)
        client.app.log({
            body: {
                service: "copilot-stats",
                level: "error",
                message,
            },
        }).catch(() => {})
        // Also append to our custom log file so errors appear inline with request lines
        const line = [timestamp(), "|", instanceId, "|", "ERROR", "|", message].join(" ") + "\n"
        appendFile(logFile, line).catch(() => {})
    }
}

function logStats(model: string, initiator: string, type: RequestType) {
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
        type.padEnd(12),
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

    appendFile(logFile, line).catch(logError)
}

// --- Fetch interception ---

interface RequestDetail {
    model: string
    type: RequestType
}

const COMPACTION_MARKER = "Provide a detailed prompt for continuing our conversation above"

function extractContent(message: any): string {
    if (!message) return ""
    if (typeof message.content === "string") return message.content
    if (Array.isArray(message.content)) return message.content.map((p: any) => p.text || "").join("")
    return ""
}

function classifyType(messages: any[]): RequestType {
    const last = messages[messages.length - 1]
    if (!last?.role) return "unknown"
    if (last.role === "user") {
        if (extractContent(last).includes(COMPACTION_MARKER)) return "compaction"
        return "prompt"
    }
    if (last.role === "tool" || last.role === "tool_result") return "tool"
    if (last.role === "assistant") return "continuation"
    return "unknown"
}

async function extractRequestInfo(request: Request): Promise<RequestDetail> {
    const fallback: RequestDetail = {model: "unknown", type: "unknown"}
    if (request.headers.get("content-type") !== "application/json" || !request.body) return fallback
    try {
        const body = (await request.clone().json()) as {model?: string; messages?: any[]; input?: any[]}
        const model = body.model || "unknown"
        const messages = body.messages || body.input || []
        if (messages.length === 0) return {model, type: "unknown"}
        return {model, type: classifyType(messages)}
    } catch (e) {
        logError(e)
        return fallback
    }
}

const originalFetch = globalThis.fetch

if (originalFetch) {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const request = new Request(input, init)
        const headers = new Headers(request.headers)
        const initiator = headers.get("x-initiator")

        if (request.url.includes("githubcopilot.com") || request.url.includes("github.com") || request.url.includes("ghe.com")) {
            if (initiator) {
                const info = await extractRequestInfo(request)
                record(info.model, initiator, info.type)
                logStats(info.model, initiator, info.type)
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

export default async ({ client }: { client: any }) => {
    logError = makeLogError(client)
    return {
        tool: {
            copilot_stats: {
                description: "Show GitHub Copilot premium request usage for this OpenCode instance",
                args: {},
                async execute() {
                    return renderTable()
                },
            },
        },
    }
}
