import type { BackgroundCommand } from "@integrations/terminal"
import type { SubagentInjectionState } from "@shared/ExtensionMessage"
import type { SubagentJobManager, SubagentJobRecord } from "../tools/subagent/SubagentJobManager"

export interface InjectableBackgroundCommand extends BackgroundCommand {
	injectionState?: SubagentInjectionState
}

export interface BackgroundCommandProvider {
	listBackgroundCommands(): InjectableBackgroundCommand[]
}

export interface BackgroundContextInjectorOptions {
	subagentJobManager: SubagentJobManager
	commandProvider?: BackgroundCommandProvider
}

export interface BackgroundResultSection {
	text: string
	subagentIds: string[]
	commandIds: string[]
}

export interface BackgroundEnvironmentSection {
	text: string
	commandLineCounts: Array<{ id: string; lineCount: number }>
}

export interface BackgroundSubagentProvider {
	getSubagentJobManager(): SubagentJobManager
}

export interface BackgroundResultConsumer {
	markBackgroundCommandsInjected(ids: string[]): void
	markBackgroundCommandsConsumed(ids: string[]): void
}

/**
 * Build a task-local background section for environment details.
 * @param subagentProvider Provider exposing the task-local subagent job manager.
 * @param commandProvider Provider exposing task-local background commands.
 * @returns Markdown sections, or an empty string when no background work is visible.
 */
export function buildTaskBackgroundSection(
	subagentProvider: BackgroundSubagentProvider,
	commandProvider?: BackgroundCommandProvider,
): string {
	return buildTaskBackgroundEnvironmentSection(subagentProvider, commandProvider).text
}

/** Build Environment metadata together with the exact command line-count snapshot it represents. */
export function buildTaskBackgroundEnvironmentSection(
	subagentProvider: BackgroundSubagentProvider,
	commandProvider?: BackgroundCommandProvider,
): BackgroundEnvironmentSection {
	const injector = new BackgroundContextInjector({
		subagentJobManager: subagentProvider.getSubagentJobManager(),
		commandProvider,
	})
	return injector.buildEnvironmentSectionWithMetadata()
}

/**
 * Build task-local injectable background results for the next model request.
 * @param subagentProvider Provider exposing the task-local subagent job manager.
 * @param commandProvider Provider exposing task-local background commands.
 * @returns Result markdown with lifecycle ids.
 */
export function buildTaskBackgroundResults(
	subagentProvider: BackgroundSubagentProvider,
	commandProvider?: BackgroundCommandProvider,
): Promise<BackgroundResultSection> {
	const injector = new BackgroundContextInjector({
		subagentJobManager: subagentProvider.getSubagentJobManager(),
		commandProvider,
	})
	return injector.buildResultSection()
}

/**
 * Formats task-local background subagent and command state for model context.
 */
export class BackgroundContextInjector {
	private readonly subagentJobManager: SubagentJobManager
	private readonly commandProvider?: BackgroundCommandProvider

	/**
	 * Create a background context injector.
	 * @param options Task-local background state providers.
	 */
	constructor(options: BackgroundContextInjectorOptions) {
		this.subagentJobManager = options.subagentJobManager
		this.commandProvider = options.commandProvider
	}

	/**
	 * Build environment_details sections for non-consumed background work.
	 * @returns Markdown sections, or an empty string when no background work is visible.
	 */
	buildEnvironmentSection(): string {
		return this.buildEnvironmentSectionWithMetadata().text
	}

	/** Build Environment text and capture the exact output counts described by that text. */
	buildEnvironmentSectionWithMetadata(): BackgroundEnvironmentSection {
		const commands = this.listVisibleCommands()
		const sections = [this.buildSubagentSection(), this.buildCommandSection(commands)].filter((section) => section.length > 0)
		return {
			text: sections.join("\n\n"),
			commandLineCounts: commands.map((command) => ({ id: command.id, lineCount: command.lineCount })),
		}
	}

	/**
	 * Build injectable background result context and pending lifecycle ids.
	 * @returns Result markdown with subagent and command ids to mark as injected.
	 */
	async buildResultSection(): Promise<BackgroundResultSection> {
		const subagentResults = this.buildSubagentResults()
		const commandResults = await this.buildCommandResults()
		const sections = [subagentResults.text, commandResults.text].filter((section) => section.length > 0)
		return {
			text: sections.length > 0 ? ["# Background Results", ...sections].join("\n") : "",
			subagentIds: subagentResults.ids,
			commandIds: commandResults.ids,
		}
	}

	/**
	 * Build the background subagent environment section.
	 * @returns Markdown section for visible subagent jobs.
	 */
	private buildSubagentSection(): string {
		const jobs = this.subagentJobManager.listJobs().filter((job) => job.injectionState !== "consumed")
		if (jobs.length === 0) return ""
		return ["# Background Subagents", ...jobs.map((job) => this.formatSubagent(job))].join("\n")
	}

	/**
	 * Format one subagent job for environment details.
	 * @param job Job record to format.
	 * @returns One markdown list item.
	 */
	private formatSubagent(job: SubagentJobRecord): string {
		const task = job.task || job.subagentName || job.prompt
		return `- ${job.jobId}: ${job.status} — ${task}`
	}

	/**
	 * Build completed subagent results for model context.
	 * @returns Markdown text and subagent ids that are ready to mark injected.
	 */
	private buildSubagentResults(): { text: string; ids: string[] } {
		const results = this.subagentJobManager.listInjectableResults()
		if (results.length === 0) return { text: "", ids: [] }
		const lines = ["## Background Subagent Results"]
		const ids: string[] = []
		for (const result of results) {
			if (result.kind === "single") {
				ids.push(result.job.jobId)
				lines.push(this.formatSubagentResult(result.job))
				continue
			}
			ids.push(result.batch.batchJobId)
			lines.push(`- ${result.batch.batchJobId}: ${result.batch.status}`)
			for (const job of result.jobs) {
				lines.push(`  ${this.formatSubagentResult(job)}`)
			}
		}
		return { text: lines.join("\n"), ids }
	}

	/**
	 * Format one completed subagent result for model context.
	 * @param job Job record to format.
	 * @returns Markdown list item with result or error details.
	 */
	private formatSubagentResult(job: SubagentJobRecord): string {
		const task = job.task || job.subagentName || job.prompt
		const detail = job.result || job.error || "No result content."
		return `- ${job.jobId}: ${job.status} — ${task}\n  ${detail}`
	}

	/**
	 * Build the background command environment section.
	 * @returns Markdown section for visible background commands.
	 */
	private listVisibleCommands(): InjectableBackgroundCommand[] {
		return this.commandProvider?.listBackgroundCommands().filter((command) => command.injectionState !== "consumed") ?? []
	}

	private buildCommandSection(commands: InjectableBackgroundCommand[]): string {
		if (commands.length === 0) return ""
		return ["# Background Commands", ...commands.map((command) => this.formatCommand(command))].join("\n")
	}

	/**
	 * Format one background command for environment details.
	 * @param command Background command to format.
	 * @returns One markdown list item.
	 */
	private formatCommand(command: InjectableBackgroundCommand): string {
		const outputChange = Math.max(0, command.lineCount - (command.lastApiSentLineCount ?? 0))
		const lineLabel = outputChange === 1 ? "line" : "lines"
		return [
			`- function_id: ${command.functionId ?? "unavailable"}`,
			`  status: ${command.status}`,
			`  output change since last API send: +${outputChange} ${lineLabel}`,
			`  command: ${command.command}`,
			`  log: ${command.logFilePath ?? "unavailable"}`,
		].join("\n")
	}

	/**
	 * Build completed background command results for model context.
	 * @returns Markdown text and command ids that are ready to mark injected.
	 */
	private async buildCommandResults(): Promise<{ text: string; ids: string[] }> {
		const commands =
			this.commandProvider
				?.listBackgroundCommands()
				.filter((command) => command.status !== "running" && (command.injectionState ?? "pending") === "pending") ?? []
		if (commands.length === 0) return { text: "", ids: [] }
		const lines = ["## Background Command Results"]
		const ids: string[] = []
		for (const command of commands) {
			ids.push(command.id)
			lines.push(this.formatCommandResult(command))
		}
		return { text: lines.join("\n"), ids }
	}

	/**
	 * Format one completed background command result for model context.
	 * @param command Background command to format.
	 * @returns Markdown list item with completion metadata and the durable log path.
	 */
	private formatCommandResult(command: InjectableBackgroundCommand): string {
		const exitCode = command.exitCode ?? "unavailable"
		const lineLabel = command.lineCount === 1 ? "output line" : "output lines"
		const logFilePath = command.logFilePath ?? "unavailable"
		return `- ${command.id}: ${command.status} - ${command.command}\n  Exit code: ${exitCode}; ${command.lineCount} ${lineLabel}; log: ${logFilePath}`
	}
}
