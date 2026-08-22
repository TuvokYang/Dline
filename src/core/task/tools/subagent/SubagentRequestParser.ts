import { DEFAULT_SUBAGENT_TIMEOUT_SECONDS } from "@shared/subagent-settings"

const PROMPT_KEYS = ["prompt_1", "prompt_2", "prompt_3", "prompt_4", "prompt_5"] as const

export interface SubagentToolOptions {
	background: boolean
	timeoutSeconds: number
}

export interface SubagentRunRequest {
	kind: "single"
	agentName: string
	task: string
	context: string
	prompt: string
	options: SubagentToolOptions
}

export interface SubagentBatchItemRequest {
	index: number
	task: string
	context: string
	prompt: string
}

export interface SubagentBatchRequest {
	kind: "batch"
	items: SubagentBatchItemRequest[]
	options: SubagentToolOptions
}

/**
 * Read a required non-empty string parameter.
 * @param params Raw tool parameters.
 * @param name Parameter name to read.
 * @returns Trimmed parameter text.
 */
function requireText(params: Record<string, unknown>, name: string): string {
	const value = params[name]
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`Missing required parameter: ${name}`)
	}
	return value.trim()
}

/**
 * Read an optional non-empty string parameter.
 * @param params Raw tool parameters.
 * @param name Parameter name to read.
 * @returns Trimmed parameter text, or undefined.
 */
function readText(params: Record<string, unknown>, name: string): string | undefined {
	const value = params[name]
	return typeof value === "string" && value.trim() ? value.trim() : undefined
}

/**
 * Parse a boolean-like tool option.
 * @param value Raw option value.
 * @returns Parsed boolean option.
 */
function parseBoolean(value: unknown): boolean {
	if (value === undefined) return false
	if (typeof value === "boolean") return value
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase()
		if (!normalized) return false
		if (normalized === "true") return true
		if (normalized === "false") return false
	}
	throw new Error("Invalid background value. Expected true or false.")
}

/**
 * Parse timeout in seconds.
 * @param value Raw timeout value.
 * @returns Positive integer timeout in seconds.
 */
function parseTimeout(value: unknown): number {
	if (value === undefined || value === "") return DEFAULT_SUBAGENT_TIMEOUT_SECONDS
	const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error("Invalid timeout value. Expected a positive integer number of seconds.")
	}
	return parsed
}

/**
 * Parse shared subagent execution options.
 * @param params Raw tool parameters.
 * @returns Normalized execution options.
 */
function parseOptions(params: Record<string, unknown>): SubagentToolOptions {
	return {
		background: parseBoolean(params.background),
		timeoutSeconds: parseTimeout(params.timeout),
	}
}

/**
 * Extract one XML-like section from a prompt.
 * @param prompt Prompt containing tagged sections.
 * @param tag Section tag name.
 * @returns Trimmed section body.
 */
function extractSection(prompt: string, tag: "task" | "context"): string {
	const pattern = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, "i")
	const match = prompt.match(pattern)
	const value = match?.[1]?.trim()
	if (!value) {
		throw new Error(`Each prompt must include a non-empty <${tag}> section.`)
	}
	return value
}

/**
 * Parse a stable single-subagent tool request.
 * @param params Raw use_subagent parameters.
 * @returns Normalized single-subagent request.
 */
export function parseUseSubagentRequest(params: Record<string, unknown>): SubagentRunRequest {
	const agentName = readText(params, "agent_name") ?? "default"
	const task = requireText(params, "task")
	const context = requireText(params, "context")
	return {
		kind: "single",
		agentName,
		task,
		context,
		prompt: `<task>\n${task}\n</task>\n<context>\n${context}\n</context>`,
		options: parseOptions(params),
	}
}

/**
 * Parse a batch subagent tool request.
 * @param params Raw use_subagents parameters.
 * @returns Normalized batch-subagent request.
 */
export function parseUseSubagentsRequest(params: Record<string, unknown>): SubagentBatchRequest {
	const prompts = PROMPT_KEYS.map((key, index) => ({ key, index: index + 1, prompt: readText(params, key) })).filter(
		(item): item is { key: (typeof PROMPT_KEYS)[number]; index: number; prompt: string } => item.prompt !== undefined,
	)
	if (prompts.length === 0) {
		throw new Error("Missing required parameter: prompt_1")
	}
	return {
		kind: "batch",
		items: prompts.map((item) => ({
			index: item.index,
			prompt: item.prompt,
			task: extractSection(item.prompt, "task"),
			context: extractSection(item.prompt, "context"),
		})),
		options: parseOptions(params),
	}
}
