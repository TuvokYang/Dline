/**
 * StandaloneTerminalManager - Main terminal manager for standalone environments.
 *
 * This class provides the same interface as VSCode's TerminalManager but works
 * in CLI and JetBrains environments by using subprocess management instead of
 * VSCode's terminal API.
 *
 * Also handles background command tracking for "Proceed While Running" functionality:
 * - Logs output to temp files for later retrieval
 * - Tracks command status (running, completed, error, timed_out)
 * - Implements 10-minute hard timeout to prevent zombie processes
 * - Provides summary for environment details
 */

import { DlineTempManager } from "@services/temp"
import { getShellForProfile } from "@utils/shell"
import * as fs from "fs"
import { isCommandCompletionSuccessful } from "../command-completion"
import { DEFAULT_TERMINAL_OUTPUT_LINE_LIMIT } from "../constants"
import { formatTerminalOutputLogLine } from "../output-stream"
import type {
	BackgroundCommand,
	CommandCancellationOwner,
	CommandOrigin,
	ITerminalManager,
	TerminalInfo,
	TerminalLaunchConfiguration,
	TerminalManagerConfiguration,
	TerminalManagerConfigurationResult,
	TerminalOutputLine,
	TerminalOutputStream,
	TerminalProcessResultPromise,
} from "../types"
import { StandaloneTerminalProcess } from "./StandaloneTerminalProcess"
import { StandaloneTerminalRegistry } from "./StandaloneTerminalRegistry"

// Re-export BackgroundCommand for backwards compatibility
export type { BackgroundCommand }

/**
 * Helper function to merge a process with a promise for the TerminalProcessResultPromise type.
 * This allows the returned object to be both awaitable and have event methods.
 */
function mergePromise(process: StandaloneTerminalProcess, promise: Promise<void>): TerminalProcessResultPromise {
	const nativePromisePrototype = (async () => {})().constructor.prototype
	const descriptors = ["then", "catch", "finally"].map((property) => [
		property,
		Reflect.getOwnPropertyDescriptor(nativePromisePrototype, property),
	]) as [string, PropertyDescriptor][]

	for (const [property, descriptor] of descriptors) {
		if (descriptor) {
			const value = (descriptor.value as Function).bind(promise)
			Reflect.defineProperty(process, property, { ...descriptor, value })
		}
	}

	// Ensure terminate() is accessible on the merged promise
	// This allows Task.cancelBackgroundCommand() to kill the process
	if (process.terminate && typeof process.terminate === "function") {
		Object.defineProperty(process, "terminate", {
			value: process.terminate.bind(process),
			writable: false,
			enumerable: false,
			configurable: false,
		})
	}

	return process as unknown as TerminalProcessResultPromise
}

/**
 * Terminal manager for standalone (non-VSCode) environments.
 * Implements ITerminalManager for compatibility with the Task class.
 */
export class StandaloneTerminalManager implements ITerminalManager {
	/** Registry for tracking terminals */
	private registry: StandaloneTerminalRegistry = new StandaloneTerminalRegistry()

	/** Map of terminal ID to process */
	private processes: Map<number, StandaloneTerminalProcess> = new Map()

	/** Set of terminal IDs managed by this instance */
	private terminalIds: Set<number> = new Set()

	/** Timeout for shell integration wait */
	private shellIntegrationTimeout = 5000

	/** Whether terminal reuse is enabled */
	private terminalReuseEnabled = true

	/** Maximum output lines to keep */
	private terminalOutputLineLimit: number = DEFAULT_TERMINAL_OUTPUT_LINE_LIMIT

	/** Default terminal profile */
	private defaultTerminalProfile = "default"

	// =========================================================================
	// Background Command Tracking
	// =========================================================================

	/** Map of background command ID to command info */
	private backgroundCommands: Map<string, BackgroundCommand> = new Map()

	/** Map of background command ID to log file write stream */
	private logStreams: Map<string, fs.WriteStream> = new Map()

	/** Completion signal for asynchronously flushed log streams. */
	private logStreamCompletions: Map<string, Promise<void>> = new Map()

	/** Map of background command ID to timeout handle */
	private backgroundTimeouts: Map<string, NodeJS.Timeout> = new Map()

	/**
	 * Run a command in the specified terminal.
	 * @param terminalInfo The terminal to run the command in
	 * @param command The command to execute
	 * @returns A promise-like object that emits events and resolves on completion
	 */
	runCommand(terminalInfo: TerminalInfo, command: string): TerminalProcessResultPromise {
		terminalInfo.busy = true
		terminalInfo.lastCommand = command

		const process = new StandaloneTerminalProcess()
		this.processes.set(terminalInfo.id, process)

		process.once("completed", () => {
			terminalInfo.busy = false
		})

		process.once("error", (_error: Error) => {
			terminalInfo.busy = false
		})

		// Create promise for the process
		const promise = new Promise<void>((resolve, reject) => {
			process.once("continue", () => resolve())
			process.once("error", (error: Error) => reject(error))
		})

		// Run the command immediately (no shell integration wait needed)
		process.run(terminalInfo.terminal, command)

		// Return merged promise/process object
		return mergePromise(process, promise)
	}

	/**
	 * Get or create a terminal for the specified working directory.
	 * @param cwd The working directory for the terminal
	 * @returns The terminal info for an available terminal
	 */
	async getOrCreateTerminal(cwd: string, launchConfiguration?: TerminalLaunchConfiguration): Promise<TerminalInfo> {
		const terminals = this.registry.getAllTerminals()
		const expectedShellPath = this.getConfiguredShellPath(this.defaultTerminalProfile)
		const expectedConfigurationId = launchConfiguration?.configurationId

		// Find available terminal with matching CWD
		const matchingTerminal = terminals.find((t) => {
			if (t.busy) {
				return false
			}
			return (
				(t.terminal as any)._cwd === cwd &&
				t.shellPath === expectedShellPath &&
				t.configurationId === expectedConfigurationId
			)
		})

		if (matchingTerminal) {
			this.terminalIds.add(matchingTerminal.id)
			return matchingTerminal
		}

		// Find any available terminal if reuse is enabled
		if (this.terminalReuseEnabled) {
			const availableTerminal = terminals.find(
				(t) => !t.busy && t.shellPath === expectedShellPath && t.configurationId === expectedConfigurationId,
			)
			if (availableTerminal) {
				// Change directory
				await this.runCommand(availableTerminal, `cd "${cwd}"`)
				;(availableTerminal.terminal as any)._cwd = cwd
				if (availableTerminal.terminal.shellIntegration?.cwd) {
					availableTerminal.terminal.shellIntegration.cwd.fsPath = cwd
				}
				this.terminalIds.add(availableTerminal.id)
				return availableTerminal
			}
		}

		// Create new terminal
		const newTerminalInfo = this.registry.createTerminal({
			cwd: cwd,
			name: `Dline Terminal ${this.registry.size + 1}`,
			shellPath: expectedShellPath,
			environment: launchConfiguration?.environment,
			configurationId: expectedConfigurationId,
		})
		this.terminalIds.add(newTerminalInfo.id)
		return newTerminalInfo
	}

	/**
	 * Get terminals filtered by busy state.
	 * @param busy Whether to get busy or idle terminals
	 * @returns Array of terminal info with id and last command
	 */
	getTerminals(busy: boolean): { id: number; lastCommand: string }[] {
		const allTerminalIds = Array.from(this.terminalIds)

		const terminals = allTerminalIds
			.map((id) => this.registry.getTerminal(id))
			.filter((t): t is TerminalInfo => {
				if (t === undefined) {
					return false
				}
				return t.busy === busy
			})
			.map((t) => ({ id: t.id, lastCommand: t.lastCommand }))

		return terminals
	}

	/**
	 * Get output that hasn't been retrieved yet from a terminal.
	 * @param terminalId The terminal ID
	 * @returns The unretrieved output string
	 */
	getUnretrievedOutput(terminalId: number): string {
		if (!this.terminalIds.has(terminalId)) {
			return ""
		}
		const process = this.processes.get(terminalId)
		return process ? process.getUnretrievedOutput() : ""
	}

	/**
	 * Check if a terminal's process is actively outputting.
	 * @param terminalId The terminal ID
	 * @returns Whether the process is hot
	 */
	isProcessHot(terminalId: number): boolean {
		const process = this.processes.get(terminalId)
		return process ? process.isHot : false
	}

	/**
	 * Process output lines, potentially truncating if over limit.
	 * @param outputLines Array of output lines
	 * @param overrideLimit Optional limit override
	 * @returns Processed output string
	 */
	processOutput(outputLines: string[], overrideLimit?: number): string {
		const limit = overrideLimit !== undefined ? overrideLimit : this.terminalOutputLineLimit
		if (outputLines.length > limit) {
			const halfLimit = Math.floor(limit / 2)
			const start = outputLines.slice(0, halfLimit)
			const end = outputLines.slice(outputLines.length - halfLimit)
			return `${start.join("\n")}\n... (output truncated) ...\n${end.join("\n")}`.trim()
		}
		return outputLines.join("\n").trim()
	}

	/**
	 * Dispose of all terminals and clean up resources.
	 */
	disposeAll(): void {
		// Dispose background commands first
		this.disposeBackgroundCommands()

		// Terminate all processes
		for (const [_terminalId, process] of this.processes) {
			if (process?.terminate) {
				process.terminate()
			}
		}

		// Clear all tracking
		this.terminalIds.clear()
		this.processes.clear()

		// Dispose all terminals
		for (const terminalInfo of this.registry.getAllTerminals()) {
			terminalInfo.terminal.dispose()
		}

		this.registry.clear()
	}

	configure(configuration: TerminalManagerConfiguration): TerminalManagerConfigurationResult {
		this.shellIntegrationTimeout = configuration.shellIntegrationTimeout
		this.terminalReuseEnabled = configuration.terminalReuseEnabled
		this.terminalOutputLineLimit = configuration.terminalOutputLineLimit
		return this.configureDefaultTerminalProfile(configuration.defaultTerminalProfile)
	}

	getConfiguration(): TerminalManagerConfiguration {
		return Object.freeze({
			shellIntegrationTimeout: this.shellIntegrationTimeout,
			terminalReuseEnabled: this.terminalReuseEnabled,
			terminalOutputLineLimit: this.terminalOutputLineLimit,
			defaultTerminalProfile: this.defaultTerminalProfile,
		})
	}

	/**
	 * Set the default terminal profile.
	 * @param profile The profile identifier
	 * @returns Object with information about closed terminals and remaining busy terminals
	 */
	private configureDefaultTerminalProfile(profile: string): TerminalManagerConfigurationResult {
		const previousProfile = this.defaultTerminalProfile
		this.defaultTerminalProfile = profile

		// If profile changed, handle terminal cleanup like TerminalManager does
		if (previousProfile !== profile) {
			return this.handleTerminalProfileChange(this.getConfiguredShellPath(profile))
		}

		return { closedCount: 0, busyTerminals: [] }
	}

	private getConfiguredShellPath(profileId: string): string | undefined {
		return profileId === "default" && process.platform !== "win32" ? undefined : getShellForProfile(profileId)
	}

	// Additional methods required for TerminalManager compatibility

	/** Disposables array (for VSCode compatibility) */
	disposables: any[] = []

	/**
	 * Find a TerminalInfo by its terminal instance.
	 * @param terminal The terminal instance to find
	 * @returns The terminal info or undefined
	 */
	findTerminalInfoByTerminal(terminal: any): TerminalInfo | undefined {
		const terminals = this.registry.getAllTerminals()
		return terminals.find((t) => t.terminal === terminal)
	}

	/**
	 * Check if a terminal's CWD matches its expected pending change.
	 * @param terminalInfo The terminal info to check
	 * @returns Whether the CWD matches
	 */
	isCwdMatchingExpected(terminalInfo: TerminalInfo): boolean {
		if (!(terminalInfo as any).pendingCwdChange) {
			return false
		}
		const currentCwd = (terminalInfo.terminal as any)._cwd
		const targetCwd = (terminalInfo as any).pendingCwdChange
		return currentCwd === targetCwd
	}

	/**
	 * Filter terminals based on a provided criteria function.
	 * @param filterFn Function that accepts TerminalInfo and returns boolean
	 * @returns Array of terminals that match the criteria
	 */
	filterTerminals(filterFn: (terminal: TerminalInfo) => boolean): TerminalInfo[] {
		const terminals = this.registry.getAllTerminals()
		return terminals.filter(filterFn)
	}

	/**
	 * Close terminals that match the provided criteria.
	 * @param filterFn Function that accepts TerminalInfo and returns boolean for terminals to close
	 * @param force If true, closes even busy terminals
	 * @returns Number of terminals closed
	 */
	closeTerminals(filterFn: (terminal: TerminalInfo) => boolean, force = false): number {
		const terminalsToClose = this.filterTerminals(filterFn)
		let closedCount = 0

		for (const terminalInfo of terminalsToClose) {
			if (terminalInfo.busy && !force) {
				continue
			}

			this.terminalIds.delete(terminalInfo.id)
			this.processes.delete(terminalInfo.id)
			terminalInfo.terminal.dispose()
			this.registry.removeTerminal(terminalInfo.id)
			closedCount++
		}

		return closedCount
	}

	/**
	 * Handle terminal management when the terminal profile changes.
	 * @param newShellPath New shell path to use
	 * @returns Object with information about closed terminals and remaining busy terminals
	 */
	handleTerminalProfileChange(newShellPath: string | undefined): {
		closedCount: number
		busyTerminals: TerminalInfo[]
	} {
		const closedCount = this.closeTerminals(
			(terminal) => !terminal.busy && (terminal as any).shellPath !== newShellPath,
			false,
		)
		const busyTerminals = this.filterTerminals((terminal) => terminal.busy && (terminal as any).shellPath !== newShellPath)
		return { closedCount, busyTerminals }
	}

	/**
	 * Force closure of all terminals (including busy ones).
	 * @returns Number of terminals closed
	 */
	closeAllTerminals(): number {
		return this.closeTerminals(() => true, true)
	}

	// =========================================================================
	// Background Command Tracking Methods
	// =========================================================================

	/**
	 * Track a command that will continue running in the background.
	 * Called when user clicks "Proceed While Running".
	 * Creates an activity-owned log immediately and appends all output in event order.
	 * Retains the command's original absolute deadline across the handoff.
	 *
	 * @param process The terminal process to track
	 * @param command The command string being executed
	 * @param activityId Stable command activity identity used by storage and presentation.
	 * @param existingOutput Output lines already captured before tracking started
	 * @returns The background command info with its durable log path.
	 */
	trackBackgroundCommand(
		process: TerminalProcessResultPromise,
		command: string,
		activityId: string,
		existingOutput: TerminalOutputLine[] = [],
		ownership: {
			origin: CommandOrigin
			cancellationOwner: CommandCancellationOwner
			startedAt?: number
			deadlineAt?: number
			existingLogFilePath?: string
			existingLineCount?: number
		} = {
			origin: "foreground",
			cancellationOwner: "task",
		},
		callbacks?: {
			onOutputLine?: (line: string, stream: TerminalOutputStream) => void
			onTimeout?: () => void
			onLogFileCreated?: (logFilePath: string) => void
		},
	): BackgroundCommand {
		if (this.backgroundCommands.has(activityId)) {
			throw new Error(`Background command is already tracked: ${activityId}`)
		}

		const logFilePath = ownership.existingLogFilePath ?? DlineTempManager.createTempFilePath(activityId)
		const logFlags = ownership.existingLogFilePath ? "a" : "w"
		const logFd = fs.openSync(logFilePath, logFlags)
		const logStream = fs.createWriteStream(logFilePath, { fd: logFd, flags: logFlags, autoClose: true })
		const logCompletion = new Promise<void>((resolve) => {
			logStream.once("finish", resolve)
			logStream.once("error", () => resolve())
		})
		this.logStreams.set(activityId, logStream)
		this.logStreamCompletions.set(activityId, logCompletion)

		const backgroundCommand: BackgroundCommand = {
			id: activityId,
			command,
			startTime: ownership.startedAt ?? Date.now(),
			deadlineAt: ownership.deadlineAt,
			status: "running",
			origin: ownership.origin,
			cancellationOwner: ownership.cancellationOwner,
			logFilePath,
			lineCount: ownership.existingLineCount ?? existingOutput.length,
			injectionState: "pending",
			process,
		}

		if (existingOutput.length > 0) {
			logStream.write(`${existingOutput.map(formatTerminalOutputLogLine).join("\n")}\n`)
		}
		callbacks?.onLogFileCreated?.(logFilePath)

		// Pipe future process output to log file
		process.on("line", (line: string, stream: TerminalOutputStream = "combined") => {
			backgroundCommand.lineCount++
			this.appendBackgroundOutput(backgroundCommand, { line, stream })
			callbacks?.onOutputLine?.(line, stream)
		})

		if (ownership.deadlineAt !== undefined) {
			const remainingMs = Math.max(0, ownership.deadlineAt - Date.now())
			const timeoutId = setTimeout(() => {
				if (backgroundCommand.status === "running") {
					backgroundCommand.status = "timed_out"
					callbacks?.onTimeout?.()
					this.appendBackgroundNote(backgroundCommand, "[TIMEOUT] Process reached its command deadline")
					this.finishBackgroundLog(activityId)

					if (process.terminate) {
						void Promise.resolve(process.terminate())
					}
				}
			}, remainingMs)
			this.backgroundTimeouts.set(activityId, timeoutId)
		}

		// Listen for completion - clear timeout
		process.on("completed", (details) => {
			// Guard: Skip if already handled by timeout
			if (backgroundCommand.status !== "running") {
				return
			}
			const timeout = this.backgroundTimeouts.get(activityId)
			if (timeout) {
				clearTimeout(timeout)
				this.backgroundTimeouts.delete(activityId)
			}
			const exitCode = details?.exitCode
			const signal = details?.signal
			if (typeof exitCode === "number") {
				backgroundCommand.exitCode = exitCode
			}

			if (isCommandCompletionSuccessful(details)) {
				backgroundCommand.status = "completed"
			} else {
				backgroundCommand.status = "error"
				if (typeof exitCode === "number" && exitCode !== 0) {
					this.appendBackgroundNote(backgroundCommand, `[EXIT_CODE] Process exited with code ${exitCode}`)
				}
				if (signal) {
					this.appendBackgroundNote(backgroundCommand, `[SIGNAL] Process terminated by signal ${signal}`)
				}
				if (typeof exitCode !== "number" && !signal) {
					this.appendBackgroundNote(backgroundCommand, "[UNKNOWN_EXIT] Process completion did not include an exit code")
				}
			}
			this.finishBackgroundLog(activityId)
		})

		// Listen for errors - clear timeout
		process.on("error", (error: Error) => {
			// Guard: Skip if already handled by timeout
			if (backgroundCommand.status !== "running") {
				return
			}
			const timeout = this.backgroundTimeouts.get(activityId)
			if (timeout) {
				clearTimeout(timeout)
				this.backgroundTimeouts.delete(activityId)
			}
			backgroundCommand.status = "error"
			// Try to extract exit code from error message if available
			const exitCodeMatch = error.message.match(/exit code (\d+)/)
			if (exitCodeMatch) {
				backgroundCommand.exitCode = Number.parseInt(exitCodeMatch[1], 10)
			}
			this.finishBackgroundLog(activityId)
		})

		this.backgroundCommands.set(activityId, backgroundCommand)
		return backgroundCommand
	}

	/** Read output from the activity-owned log after flushing all preceding writes. */
	async readBackgroundCommandOutput(id: string): Promise<string> {
		const command = this.backgroundCommands.get(id)
		if (!command) {
			return ""
		}

		const activeStream = this.logStreams.get(id)
		if (command.status === "running" && activeStream) {
			await new Promise<void>((resolve) => activeStream.write("", () => resolve()))
		} else {
			await this.logStreamCompletions.get(id)
		}
		return command.logFilePath ? fs.promises.readFile(command.logFilePath, "utf8") : ""
	}

	private appendBackgroundOutput(command: BackgroundCommand, output: TerminalOutputLine): void {
		const line = formatTerminalOutputLogLine(output)
		this.logStreams.get(command.id)?.write(`${line}\n`)
	}

	private appendBackgroundNote(command: BackgroundCommand, note: string): void {
		this.logStreams.get(command.id)?.write(`\n${note}\n`)
	}

	private finishBackgroundLog(id: string): void {
		const logStream = this.logStreams.get(id)
		if (!logStream) {
			return
		}
		logStream.end()
		this.logStreams.delete(id)
	}

	/**
	 * Get a specific background command by ID.
	 */
	getBackgroundCommand(id: string): BackgroundCommand | undefined {
		return this.backgroundCommands.get(id)
	}

	/**
	 * Get all tracked background commands.
	 */
	getAllBackgroundCommands(): BackgroundCommand[] {
		return Array.from(this.backgroundCommands.values())
	}

	/**
	 * Mark background commands as injected into model context.
	 * @param ids Background command identifiers.
	 */
	markBackgroundCommandsInjected(ids: string[]): void {
		this.markBackgroundCommands(ids, "injected")
	}

	/**
	 * Mark background commands as consumed by a sent model request.
	 * @param ids Background command identifiers.
	 */
	markBackgroundCommandsConsumed(ids: string[]): void {
		this.markBackgroundCommands(ids, "consumed")
	}

	/**
	 * Move background command injection state forward only.
	 * @param ids Background command identifiers.
	 * @param state Requested injection lifecycle state.
	 */
	private markBackgroundCommands(ids: string[], state: NonNullable<BackgroundCommand["injectionState"]>): void {
		for (const id of ids) {
			const command = this.backgroundCommands.get(id)
			if (!command) continue
			const current = command.injectionState ?? "pending"
			if (this.canMoveInjectionState(current, state)) command.injectionState = state
		}
	}

	/**
	 * Check whether a background command injection state transition is valid.
	 * @param current Current injection lifecycle state.
	 * @param next Requested injection lifecycle state.
	 * @returns True when the transition moves forward by one step.
	 */
	private canMoveInjectionState(
		current: NonNullable<BackgroundCommand["injectionState"]>,
		next: NonNullable<BackgroundCommand["injectionState"]>,
	): boolean {
		const order: Record<NonNullable<BackgroundCommand["injectionState"]>, number> = { pending: 0, injected: 1, consumed: 2 }
		return order[next] === order[current] + 1
	}

	/**
	 * Get only running background commands.
	 */
	getRunningBackgroundCommands(cancellationOwner?: CommandCancellationOwner): BackgroundCommand[] {
		return this.getAllBackgroundCommands().filter(
			(command) => command.status === "running" && (!cancellationOwner || command.cancellationOwner === cancellationOwner),
		)
	}

	/**
	 * Check if there are any active background commands.
	 */
	hasActiveBackgroundCommands(): boolean {
		return this.getRunningBackgroundCommands().length > 0
	}

	/**
	 * Cancel/terminate a specific background command.
	 * @param id The background command ID to cancel
	 * @returns true if cancelled, false if not found or already completed
	 */
	cancelBackgroundCommand(id: string): boolean {
		const command = this.backgroundCommands.get(id)
		if (!command || command.status !== "running") {
			return false
		}

		// Clear timeout
		const timeout = this.backgroundTimeouts.get(id)
		if (timeout) {
			clearTimeout(timeout)
			this.backgroundTimeouts.delete(id)
		}

		this.appendBackgroundNote(command, "[CANCELLED] Command cancelled by user")
		this.finishBackgroundLog(id)

		// Terminate process
		if (command.process && typeof (command.process as any).terminate === "function") {
			;(command.process as any).terminate()
		}

		command.status = "cancelled"
		return true
	}

	/**
	 * Get a summary string for environment details.
	 * Shows running background commands with duration, line count, and log paths.
	 */
	getBackgroundCommandsSummary(): string {
		const running = this.getRunningBackgroundCommands()
		if (running.length === 0) {
			return ""
		}

		const lines = [`# Background Commands (${running.length} running)`]
		for (const c of running) {
			const duration = Math.round((Date.now() - c.startTime) / 1000 / 60)
			const outputLocation = c.logFilePath ? `log: ${c.logFilePath}` : "log unavailable"
			lines.push(`- ${c.command} (running ${duration}m, ${c.lineCount} lines, ${outputLocation})`)
		}
		return lines.join("\n")
	}

	/**
	 * Clean up all background command resources.
	 * Called when disposing the manager.
	 */
	disposeBackgroundCommands(): void {
		// Clear all timeouts
		for (const [_id, timeout] of this.backgroundTimeouts) {
			clearTimeout(timeout)
		}
		this.backgroundTimeouts.clear()

		// Close all log streams
		for (const [_id, logStream] of this.logStreams) {
			try {
				logStream.end()
			} catch (_error) {
				// Ignore errors when closing log streams
			}
		}
		this.logStreams.clear()
		this.logStreamCompletions.clear()

		// Clear command tracking
		this.backgroundCommands.clear()
	}
}
