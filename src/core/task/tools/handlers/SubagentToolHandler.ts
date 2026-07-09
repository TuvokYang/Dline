import { resolveProvider } from "@core/api"
import type { ToolUse } from "@core/assistant-message"
import { getPrompt } from "@core/prompts/i18n"
import { formatResponse } from "@core/prompts/responses"
import {
	ClineAskUseSubagents,
	ClineSaySubagentStatus,
	ClineSubagentUsageInfo,
	SubagentStatusItem,
} from "@shared/ExtensionMessage"
import { telemetryService } from "@/services/telemetry"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { showNotificationForApproval } from "../../utils"
import { AgentConfigLoader } from "../subagent/AgentConfigLoader"
import { runSubagent, type SubagentExecResult, type SubagentProgressUpdate, type SubagentRunStats } from "../subagent/SubagentExecutor"
import { SubagentJobManager } from "../subagent/SubagentJobManager"
import { parseUseSubagentRequest, parseUseSubagentsRequest } from "../subagent/SubagentRequestParser"
import { SubagentRunner } from "../subagent/SubagentRunner"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

const PROMPT_KEYS = ["prompt_1", "prompt_2", "prompt_3", "prompt_4", "prompt_5"] as const
const subagentJobManager = new SubagentJobManager()

/**
 * Get the task-local background subagent job manager.
 * @returns Shared subagent job manager instance.
 */
export function getSubagentJobManager(): SubagentJobManager {
	return subagentJobManager
}

/**
 * Shorten long result text for tool summaries.
 * @param text Text to shorten.
 * @param maxChars Maximum number of characters to keep.
 * @returns Shortened text.
 */
function excerpt(text: string | undefined, maxChars = 1200): string {
	if (!text) return ""
	const trimmed = text.trim()
	return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars)}...`
}

/**
 * Convert raw params into strings for prompt construction UI.
 * @param value Raw parameter value.
 * @returns Trimmed text when present.
 */
function readParam(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined
}

/**
 * Build an empty stats record for pending UI entries.
 * @returns Empty subagent stats.
 */
function emptyStats(): SubagentRunStats {
	return {
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
}

/**
 * Apply runner stats to a Webview status item.
 * @param entry Status item to mutate.
 * @param stats Runner stats to copy.
 */
function applyStats(entry: SubagentStatusItem, stats: SubagentRunStats): void {
	entry.toolCalls = stats.toolCalls || 0
	entry.inputTokens = stats.inputTokens || 0
	entry.outputTokens = stats.outputTokens || 0
	entry.totalCost = stats.totalCost || 0
	entry.currency = stats.currency || ""
	entry.contextTokens = stats.contextTokens || 0
	entry.contextWindow = stats.contextWindow || 0
	entry.contextUsagePercentage = stats.contextUsagePercentage || 0
}

/**
 * Build a status payload from current entries.
 * @param kind Single or batch status kind.
 * @param status Overall status.
 * @param entries Current item entries.
 * @param options Additional payload options.
 * @returns Webview subagent status payload.
 */
function buildStatusPayload(
	kind: "single" | "batch",
	status: ClineSaySubagentStatus["status"],
	entries: SubagentStatusItem[],
	options: Pick<ClineSaySubagentStatus, "background" | "timeoutSeconds" | "jobId" | "batchJobId">,
): ClineSaySubagentStatus {
	const completed = entries.filter((entry) => entry.status !== "pending" && entry.status !== "running").length
	const successes = entries.filter((entry) => entry.status === "completed").length
	const failures = entries.filter((entry) => entry.status === "failed").length
	const toolCalls = entries.reduce((acc, entry) => acc + (entry.toolCalls || 0), 0)
	const inputTokens = entries.reduce((acc, entry) => acc + (entry.inputTokens || 0), 0)
	const outputTokens = entries.reduce((acc, entry) => acc + (entry.outputTokens || 0), 0)
	const contextWindow = entries.reduce((acc, entry) => Math.max(acc, entry.contextWindow || 0), 0)
	const maxContextTokens = entries.reduce((acc, entry) => Math.max(acc, entry.contextTokens || 0), 0)
	const maxContextUsagePercentage = entries.reduce((acc, entry) => Math.max(acc, entry.contextUsagePercentage || 0), 0)
	return {
		kind,
		status,
		...options,
		injectionState: "pending",
		total: entries.length,
		completed,
		successes,
		failures,
		toolCalls,
		inputTokens,
		outputTokens,
		contextWindow,
		maxContextTokens,
		maxContextUsagePercentage,
		items: entries,
	}
}

/**
 * Format a foreground subagent result summary.
 * @param entries Final status entries.
 * @returns Text returned to the model.
 */
function formatSummary(entries: SubagentStatusItem[]): string {
	const failures = entries.filter((entry) => entry.status === "failed" || entry.status === "timeout").length
	const successCount = entries.length - failures
	const totalToolCalls = entries.reduce((acc, entry) => acc + (entry.toolCalls || 0), 0)
	const maxContextUsagePercentage = entries.reduce((acc, entry) => Math.max(acc, entry.contextUsagePercentage || 0), 0)
	const maxContextTokens = entries.reduce((acc, entry) => Math.max(acc, entry.contextTokens || 0), 0)
	const contextWindow = entries.reduce((acc, entry) => Math.max(acc, entry.contextWindow || 0), 0)
	return [
		"Subagent results:",
		`Total: ${entries.length}`,
		`Succeeded: ${successCount}`,
		`Failed: ${failures}`,
		`Tool calls: ${totalToolCalls}`,
		`Peak context usage: ${maxContextTokens.toLocaleString()} / ${contextWindow.toLocaleString()} (${maxContextUsagePercentage.toFixed(1)}%)`,
		"",
		...entries.map((entry) => {
			const header = `[${entry.index}] ${entry.status.toUpperCase()} - ${entry.task || entry.prompt}`
			const detail = entry.status === "completed" ? excerpt(entry.result) : excerpt(entry.error)
			return detail ? `${header}\n${detail}` : header
		}),
	].join("\n")
}

/**
 * Capture usage telemetry for a subagent tool approval result.
 * @param config Current task config.
 * @param toolName Tool name being executed.
 * @param provider Provider id.
 * @param autoApproved Whether approval was automatic.
 * @param approved Whether execution was approved.
 * @param isNativeToolCall Whether the tool call was native.
 */
function captureToolTelemetry(
	config: TaskConfig,
	toolName: ClineDefaultTool,
	provider: string | undefined,
	autoApproved: boolean,
	approved: boolean,
	isNativeToolCall?: boolean,
): void {
	telemetryService.captureToolUsage(
		config.ulid ?? "",
		toolName,
		config.api.getModel().id,
		provider ?? "",
		autoApproved,
		approved,
		undefined,
		isNativeToolCall,
	)
}

/**
 * Ask for approval unless auto-approval is enabled.
 * @param config Current task config.
 * @param block Tool use block.
 * @param toolName Tool name being approved.
 * @param askType Ask message type.
 * @param approvalBody Approval payload.
 * @param label Notification label.
 * @returns True when execution is approved.
 */
async function approveSubagentUse(
	config: TaskConfig,
	block: ToolUse,
	toolName: ClineDefaultTool,
	askType: "use_subagents",
	approvalBody: string,
	label: string,
): Promise<boolean> {
	const apiConfig = config.services.stateManager.getApiConfiguration()
	const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
	const provider = resolveProvider(apiConfig, currentMode)
	const autoApproveResult = config.autoApprover?.shouldAutoApproveTool(toolName)
	const [autoApproveSafe] = Array.isArray(autoApproveResult) ? autoApproveResult : [autoApproveResult, false]
	if (autoApproveSafe) {
		captureToolTelemetry(config, toolName, provider, true, true, block.isNativeToolCall)
		return true
	}
	showNotificationForApproval(label, config.autoApprovalSettings.enableNotifications)
	const didApprove = await ToolResultUtils.askApprovalAndPushFeedback(askType, approvalBody, config, block.ts)
	captureToolTelemetry(config, toolName, provider, false, didApprove, block.isNativeToolCall)
	return didApprove
}

/**
 * Emit aggregate usage for completed foreground entries.
 * @param config Current task config.
 * @param entries Final status entries.
 */
async function emitUsage(config: TaskConfig, entries: SubagentStatusItem[]): Promise<void> {
	const payload: ClineSubagentUsageInfo = {
		source: "subagents",
		tokensIn: entries.reduce((acc, entry) => acc + entry.inputTokens, 0),
		tokensOut: entries.reduce((acc, entry) => acc + entry.outputTokens, 0),
		cacheWrites: 0,
		cacheReads: 0,
		cost: entries.reduce((acc, entry) => acc + entry.totalCost, 0),
	}
	await config.callbacks.say("subagent_usage", JSON.stringify(payload))
}

export class UseSubagentToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.USE_SUBAGENT

	/**
	 * Describe stable single subagent execution.
	 * @param _block Tool block.
	 * @returns UI description.
	 */
	getDescription(_block: ToolUse): string {
		return "[subagent]"
	}

	/**
	 * Stream partial single subagent approval UI.
	 * @param block Tool block.
	 * @param uiHelpers UI helper methods.
	 */
	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const subagentName = readParam(block.params.subagent_name)
		const task = readParam(block.params.task)
		const content = readParam(block.params.content)
		if (!subagentName && !task && !content) return
		const payload: ClineAskUseSubagents = {
			kind: "single",
			prompts: task ? [task] : [],
			subagentName,
			task,
			content,
		}
		const autoApproveResult = uiHelpers.shouldAutoApproveTool(this.name)
		const [shouldAutoApprove] = Array.isArray(autoApproveResult) ? autoApproveResult : [autoApproveResult, false]
		if (shouldAutoApprove) {
			await uiHelpers.say("use_subagents", JSON.stringify(payload), undefined, undefined, true, block.ts)
			return
		}
		uiHelpers.ask("use_subagents", JSON.stringify(payload), true, { existingTs: block.ts }).catch(() => undefined)
	}

	/**
	 * Execute stable single subagent requests.
	 * @param config Current task config.
	 * @param block Tool block.
	 * @returns Tool response for the model.
	 */
	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		if (!config.services.stateManager.getGlobalSettingsKey("subagentsEnabled")) {
			return formatResponse.toolError(getPrompt("toolHandlers", "subagentsDisabled"))
		}
		let request: ReturnType<typeof parseUseSubagentRequest>
		try {
			request = parseUseSubagentRequest(block.params)
		} catch (error) {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError(error instanceof Error ? error.message : String(error))
		}
		if (!AgentConfigLoader.getInstance().getCachedConfig(request.subagentName)) {
			return formatResponse.toolError(`Unknown or disabled subagent '${request.subagentName}'.`)
		}
		const approvalBody = JSON.stringify({
			kind: "single",
			prompts: [request.task],
			subagentName: request.subagentName,
			task: request.task,
			content: request.content,
			background: request.options.background,
			timeoutSeconds: request.options.timeoutSeconds,
		} satisfies ClineAskUseSubagents)
		const approved = await approveSubagentUse(
			config,
			block,
			this.name,
			"use_subagents",
			approvalBody,
			`Dline wants to use the '${request.subagentName}' subagent`,
		)
		if (!approved) return formatResponse.toolDenied()

		const entry: SubagentStatusItem = {
			index: 1,
			prompt: request.prompt,
			subagentName: request.subagentName,
			task: request.task,
			background: request.options.background,
			timeoutSeconds: request.options.timeoutSeconds,
			injectionState: "pending",
			status: "running",
			...emptyStats(),
		}
		if (request.options.background) {
			const job = subagentJobManager.startJob({
				subagentName: request.subagentName,
				task: request.task,
				prompt: request.prompt,
				timeoutSeconds: request.options.timeoutSeconds,
				runner: () =>
					runSubagent({
						runner: new SubagentRunner(config, request.subagentName),
						prompt: request.prompt,
						timeoutSeconds: request.options.timeoutSeconds,
						onProgress: () => undefined,
					}),
			})
			entry.jobId = job.jobId
			await config.callbacks.say(
				"subagent",
				JSON.stringify(buildStatusPayload("single", "running", [entry], { background: true, timeoutSeconds: request.options.timeoutSeconds, jobId: job.jobId })),
				undefined,
				undefined,
				false,
				block.ts,
			)
			return formatResponse.toolResult(`Started background subagent job: ${job.jobId}`)
		}

		config.taskState.consecutiveMistakeCount = 0
		config.taskState.isExecutingSubagent = true
		await config.callbacks.say(
			"subagent",
			JSON.stringify(buildStatusPayload("single", "running", [entry], { background: false, timeoutSeconds: request.options.timeoutSeconds })),
			undefined,
			undefined,
			true,
			block.ts,
		)
		const result = await runSubagent({
			runner: new SubagentRunner(config, request.subagentName),
			prompt: request.prompt,
			timeoutSeconds: request.options.timeoutSeconds,
			onProgress: (update) => {
				if (update.status === "running") entry.status = "running"
				if (update.latestToolCall) entry.latestToolCall = update.latestToolCall
				if (update.stats) applyStats(entry, update.stats)
			},
		})
		config.taskState.isExecutingSubagent = false
		entry.status = result.status
		entry.result = result.result
		entry.error = result.error
		applyStats(entry, result.stats)
		await config.callbacks.say(
			"subagent",
			JSON.stringify(buildStatusPayload("single", result.status === "completed" ? "completed" : result.status, [entry], { background: false, timeoutSeconds: request.options.timeoutSeconds })),
			undefined,
			undefined,
			false,
			block.ts,
		)
		await emitUsage(config, [entry])
		return formatResponse.toolResult(formatSummary([entry]))
	}
}

export class UseSubagentsToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.USE_SUBAGENTS

	/**
	 * Describe stable batch subagent execution.
	 * @param _block Tool block.
	 * @returns UI description.
	 */
	getDescription(_block: ToolUse): string {
		return "[subagents]"
	}

	/**
	 * Stream partial batch subagent approval UI.
	 * @param block Tool block.
	 * @param uiHelpers UI helper methods.
	 */
	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const prompts = PROMPT_KEYS.map((key) => uiHelpers.removeClosingTag(block, key, readParam(block.params[key])))
			.map((prompt) => prompt?.trim())
			.filter((prompt): prompt is string => !!prompt)
		if (prompts.length === 0) return
		const partialMessage = JSON.stringify({ kind: "batch", prompts } satisfies ClineAskUseSubagents)
		const autoApproveResult = uiHelpers.shouldAutoApproveTool(this.name)
		const [shouldAutoApprove] = Array.isArray(autoApproveResult) ? autoApproveResult : [autoApproveResult, false]
		if (shouldAutoApprove) {
			await uiHelpers.say("use_subagents", partialMessage, undefined, undefined, true, block.ts)
			return
		}
		uiHelpers.ask("use_subagents", partialMessage, true, { existingTs: block.ts }).catch(() => undefined)
	}

	/**
	 * Execute stable batch subagent requests.
	 * @param config Current task config.
	 * @param block Tool block.
	 * @returns Tool response for the model.
	 */
	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		if (!config.services.stateManager.getGlobalSettingsKey("subagentsEnabled")) {
			await config.callbacks.say(
				"use_subagents",
				JSON.stringify({ prompts: [], error: "subagentsDisabled", message: getPrompt("toolHandlers", "subagentsDisabled") }),
				undefined,
				undefined,
				false,
				block.ts,
			)
			return formatResponse.toolError(getPrompt("toolHandlers", "subagentsDisabled"))
		}
		let request: ReturnType<typeof parseUseSubagentsRequest>
		try {
			request = parseUseSubagentsRequest(block.params)
		} catch (error) {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError(error instanceof Error ? error.message : String(error))
		}
		const prompts = request.items.map((item) => item.prompt)
		const approvalBody = JSON.stringify({ kind: "batch", prompts, background: request.options.background, timeoutSeconds: request.options.timeoutSeconds } satisfies ClineAskUseSubagents)
		const approved = await approveSubagentUse(
			config,
			block,
			this.name,
			"use_subagents",
			approvalBody,
			request.items.length === 1 ? "Dline wants to use a subagent" : `Dline wants to use ${request.items.length} subagents`,
		)
		if (!approved) return formatResponse.toolDenied()
		config.taskState.consecutiveMistakeCount = 0
		const entries: SubagentStatusItem[] = request.items.map((item) => ({
			index: item.index,
			prompt: item.prompt,
			task: item.task,
			background: request.options.background,
			timeoutSeconds: request.options.timeoutSeconds,
			injectionState: "pending",
			status: "running",
			...emptyStats(),
		}))
		if (request.options.background) {
			const batch = subagentJobManager.startBatch({
				timeoutSeconds: request.options.timeoutSeconds,
				items: request.items.map((item) => ({
					task: item.task,
					prompt: item.prompt,
					runner: () =>
						runSubagent({
							runner: new SubagentRunner(config),
							prompt: item.prompt,
							timeoutSeconds: request.options.timeoutSeconds,
							onProgress: () => undefined,
						}),
				})),
			})
			entries.forEach((entry, index) => {
				entry.jobId = batch.itemJobIds[index]
			})
			await config.callbacks.say(
				"subagent",
				JSON.stringify(buildStatusPayload("batch", "running", entries, { background: true, timeoutSeconds: request.options.timeoutSeconds, batchJobId: batch.batchJobId })),
				undefined,
				undefined,
				false,
				block.ts,
			)
			return formatResponse.toolResult(`Started background subagent batch job: ${batch.batchJobId}`)
		}
		config.taskState.isExecutingSubagent = true
		await config.callbacks.say(
			"subagent",
			JSON.stringify(buildStatusPayload("batch", "running", entries, { background: false, timeoutSeconds: request.options.timeoutSeconds })),
			undefined,
			undefined,
			true,
			block.ts,
		)
		const results = await Promise.all(
			request.items.map((item, index) =>
				runSubagent({
					runner: new SubagentRunner(config),
					prompt: item.prompt,
					timeoutSeconds: request.options.timeoutSeconds,
					onProgress: (update: SubagentProgressUpdate) => {
						const entry = entries[index]
						if (update.latestToolCall) entry.latestToolCall = update.latestToolCall
						if (update.stats) applyStats(entry, update.stats)
					},
				}),
			),
		)
		config.taskState.isExecutingSubagent = false
		results.forEach((result: SubagentExecResult, index) => {
			const entry = entries[index]
			entry.status = result.status
			entry.result = result.result
			entry.error = result.error
			applyStats(entry, result.stats)
		})
		const finalStatus: ClineSaySubagentStatus["status"] = entries.some((entry) => entry.status === "timeout")
			? "timeout"
			: entries.some((entry) => entry.status === "failed")
				? "failed"
				: "completed"
		await config.callbacks.say(
			"subagent",
			JSON.stringify(buildStatusPayload("batch", finalStatus, entries, { background: false, timeoutSeconds: request.options.timeoutSeconds })),
			undefined,
			undefined,
			false,
			block.ts,
		)
		await emitUsage(config, entries)
		return formatResponse.toolResult(formatSummary(entries))
	}
}
