export type SubagentExecStatus = "completed" | "failed" | "timeout" | "cancelled"

export interface SubagentRunStats {
	toolCalls: number
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
	totalCost: number
	currency: string
	contextTokens: number
	contextWindow: number
	contextUsagePercentage: number
}

export interface SubagentProgressUpdate {
	stats?: SubagentRunStats
	latestToolCall?: string
	status?: "running" | "completed" | "failed"
	result?: string
	error?: string
}

export interface SubagentExecResult {
	status: SubagentExecStatus
	result?: string
	error?: string
	stats: SubagentRunStats
}

export interface SubagentRunnerLike {
	run(prompt: string, onProgress: (update: SubagentProgressUpdate) => void): Promise<SubagentExecResult>
	abort(): Promise<void>
}

export interface RunSubagentInput {
	runner: SubagentRunnerLike
	prompt: string
	timeoutSeconds: number
	onProgress: (update: SubagentProgressUpdate) => void
}

const EMPTY_STATS: SubagentRunStats = {
	toolCalls: 0,
	inputTokens: 0,
	outputTokens: 0,
	cacheWriteTokens: 0,
	cacheReadTokens: 0,
	totalCost: 0,
	currency: "",
	contextTokens: 0,
	contextWindow: 0,
	contextUsagePercentage: 0,
}

/**
 * Run a subagent with timeout and abort handling.
 * @param input Runner, prompt, timeout, and progress callback.
 * @returns Completed, failed, timeout, or cancelled execution result.
 */
export async function runSubagent(input: RunSubagentInput): Promise<SubagentExecResult> {
	let didTimeout = false
	let timeoutHandle: NodeJS.Timeout | undefined
	const timeoutPromise = new Promise<SubagentExecResult>((resolve) => {
		timeoutHandle = setTimeout(() => {
			didTimeout = true
			void input.runner.abort().finally(() => {
				resolve({
					status: "timeout",
					error: `Subagent timed out after ${input.timeoutSeconds} seconds.`,
					stats: EMPTY_STATS,
				})
			})
		}, input.timeoutSeconds * 1000)
	})
	const runPromise = input.runner.run(input.prompt, input.onProgress).then((result) => {
		if (!didTimeout) return result
		return {
			status: "timeout" as const,
			error: `Subagent timed out after ${input.timeoutSeconds} seconds.`,
			stats: result.stats,
		}
	})
	try {
		return await Promise.race([runPromise, timeoutPromise])
	} finally {
		if (timeoutHandle) clearTimeout(timeoutHandle)
		runPromise.catch(() => undefined)
	}
}
