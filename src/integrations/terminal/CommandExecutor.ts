/**
 * CommandExecutor - Unified command execution for all terminal modes.
 *
 * This class handles command execution for both VSCode terminal mode and
 * standalone/CLI mode. It uses the shared CommandOrchestrator for the
 * common orchestration logic (buffering, user interaction, result formatting).
 *
 * The differentiation between modes happens at the TerminalManager level:
 * - VscodeTerminalManager → VscodeTerminalProcess (shell integration)
 * - StandaloneTerminalManager → StandaloneTerminalProcess (child_process)
 *
 * IMPORTANT: Background execution mode uses StandaloneTerminalManager to run
 * commands in hidden terminals without cluttering the visible terminal.
 */

import { findLastIndex } from "@shared/array"
import { Logger } from "@/shared/services/Logger"
import { orchestrateCommandExecution } from "./CommandOrchestrator"
import { isCommandCompletionSuccessful } from "./command-completion"
import { StandaloneTerminalManager } from "./standalone/StandaloneTerminalManager"
import type {
	BackgroundCommand,
	CommandCancellationOwner,
	CommandExecutionOptions,
	CommandExecutionOutcome,
	CommandExecutorCallbacks,
	CommandExecutorConfig,
	ITerminalManager,
	ShellIntegrationWarningTracker,
	TerminalProcessResultPromise,
} from "./types"

/**
 * CommandExecutor - Unified command executor for all terminal modes.
 *
 * Uses the shared CommandOrchestrator for common logic and delegates
 * process management to the appropriate TerminalManager.
 */
export class CommandExecutor {
	private cwd: string
	private taskId: string
	private ulid: string
	private terminalExecutionMode: "vscodeTerminal" | "backgroundExec"
	private terminalManager: ITerminalManager
	private standaloneManager: StandaloneTerminalManager
	private callbacks: CommandExecutorCallbacks

	// Track the currently executing foreground process for cancellation
	private currentProcess: TerminalProcessResultPromise | null = null
	private readonly processes = new Map<string, TerminalProcessResultPromise>()
	private readonly cancellationOwners = new Map<string, CommandCancellationOwner>()
	private readonly cancelledActivityIds = new Set<string>()

	private nextActivityNumber = 1

	// Track shell integration warnings to determine when to show background terminal suggestion
	private shellIntegrationWarningTracker: ShellIntegrationWarningTracker = {
		timestamps: [],
		lastSuggestionShown: undefined,
	}

	constructor(config: CommandExecutorConfig, callbacks: CommandExecutorCallbacks) {
		this.cwd = config.cwd
		this.taskId = config.taskId
		this.ulid = config.ulid
		this.terminalExecutionMode = config.terminalExecutionMode
		this.terminalManager = config.terminalManager
		this.callbacks = callbacks

		// When in backgroundExec mode, the terminalManager is already a StandaloneTerminalManager
		// created by Task. We should reuse it so that Task.getEnvironmentDetails() can see
		// the terminals and processes we create (for isHot logic, busy terminals, etc.)
		if (config.terminalExecutionMode === "backgroundExec" && config.terminalManager instanceof StandaloneTerminalManager) {
			// Reuse the same instance that Task is using
			this.standaloneManager = config.terminalManager
			Logger.info(`[CommandExecutor] Reusing Task's StandaloneTerminalManager for backgroundExec mode`)
		} else {
			// Create a standalone manager for background execution support.
			this.standaloneManager = new StandaloneTerminalManager()
			Logger.info(`[CommandExecutor] Created new StandaloneTerminalManager`)

			// Copy settings from the provided terminalManager to ensure consistency
			if ("shellIntegrationTimeout" in config.terminalManager) {
				const tm = config.terminalManager as any
				this.standaloneManager.setShellIntegrationTimeout(tm.shellIntegrationTimeout || 4000)
				this.standaloneManager.setTerminalReuseEnabled(tm.terminalReuseEnabled ?? true)
				this.standaloneManager.setTerminalOutputLineLimit(tm.terminalOutputLineLimit || 500)
			}
		}
	}

	/**
	 * Execute a command in the terminal.
	 *
	 * Routing logic:
	 * 1. Background mode commands use StandaloneTerminalManager
	 * 2. Regular commands use the configured terminal manager
	 *
	 * @param command The command to execute
	 * @param timeoutSeconds Optional timeout in seconds
	 * @returns Structured execution outcome with completion metadata
	 */
	async execute(
		command: string,
		timeoutSeconds: number | undefined,
		options?: CommandExecutionOptions,
	): Promise<CommandExecutionOutcome> {
		// Strip leading `cd` to workspace from command
		const workspaceCdPrefix = `cd ${this.cwd} && `
		if (command.startsWith(workspaceCdPrefix)) {
			command = command.substring(workspaceCdPrefix.length)
		}

		// Select the appropriate terminal manager
		const useStandalone =
			options?.startInBackground || options?.useBackgroundExecution || this.terminalExecutionMode === "backgroundExec"
		const manager = useStandalone ? this.standaloneManager : this.terminalManager
		Logger.debug(`[Task ${this.taskId}] Executing command in ${useStandalone ? "standalone" : "VSCode"} terminal: ${command}`)
		this.callbacks.markWorkspaceScanRequired?.()

		// Get terminal and run command
		const terminalInfo = await manager.getOrCreateTerminal(this.cwd)
		if (options?.startInBackground) {
			terminalInfo.terminal.hide()
		} else {
			terminalInfo.terminal.show()
		}
		const process = manager.runCommand(terminalInfo, command)
		const activityId = `command_${options?.commandTs ?? Date.now()}_${this.nextActivityNumber++}`
		const cancellationOwner: CommandCancellationOwner = options?.startInBackground ? "explicit" : "task"
		let activityLineCount = 0
		this.processes.set(activityId, process)
		this.cancellationOwners.set(activityId, cancellationOwner)
		if (options?.commandTs) {
			const messages = this.callbacks.getClineMessages() as Array<{ ts?: number }>
			const commandIndex = messages.findIndex((message) => message.ts === options.commandTs)
			if (commandIndex !== -1) await this.callbacks.updateClineMessage(commandIndex, { activityId })
		}
		this.callbacks.createCommandActivity?.({
			activityId,
			command,
			executionMode: options?.startInBackground ? "background" : "foreground",
			cancellationOwner,
			cancel: async () => {
				await this.cancelCommand(activityId)
			},
		})

		const markCommandMessageCancelled = (): void => {
			if (!options?.commandTs) return
			const messages = this.callbacks.getClineMessages() as Array<{ ts?: number }>
			const commandIndex = messages.findIndex((message) => message.ts === options.commandTs)
			if (commandIndex !== -1) {
				void this.callbacks.updateClineMessage(commandIndex, { commandStatus: "cancelled" })
			}
		}

		// Track the current foreground process until completion or background handoff.
		this.currentProcess = process
		const clearCurrentProcess = () => {
			if (this.currentProcess === process) this.currentProcess = null
			this.processes.delete(activityId)
			this.cancellationOwners.delete(activityId)
		}
		process.once("completed", clearCurrentProcess)
		process.once("error", clearCurrentProcess)
		process.once("completed", (details) => {
			const cancelled = this.cancelledActivityIds.has(activityId)
			const failed = !isCommandCompletionSuccessful(details)
			this.callbacks.updateCommandActivity?.(activityId, {
				status: cancelled ? "cancelled" : failed ? "failed" : "completed",
				latestEvent: cancelled ? "Cancelled by user" : failed ? "Command failed" : "Command completed",
				error: cancelled
					? undefined
					: details?.signal
						? `Terminated by ${details.signal}`
						: typeof details?.exitCode !== "number"
							? "Command completion could not be verified because no exit code was reported"
							: undefined,
				lineCount: activityLineCount,
			})
			if (cancelled) markCommandMessageCancelled()
		})
		process.once("error", (error: Error) => {
			const cancelled = this.cancelledActivityIds.has(activityId)
			this.callbacks.updateCommandActivity?.(activityId, {
				status: cancelled ? "cancelled" : "failed",
				latestEvent: cancelled ? "Cancelled by user" : "Command failed",
				error: cancelled ? undefined : error.message,
				lineCount: activityLineCount,
			})
			if (cancelled) markCommandMessageCancelled()
		})

		// Use shared orchestration logic
		// The StandaloneTerminalManager handles background command tracking internally
		let backgroundCommand: BackgroundCommand | undefined
		const result = await orchestrateCommandExecution(process, manager, this.callbacks, {
			activityId,
			isCancellationRequested: () => this.cancelledActivityIds.has(activityId),
			command,
			timeoutSeconds,
			suppressUserInteraction: options?.suppressUserInteraction,
			commandTs: options?.commandTs,
			onOutputLine: (line) => {
				activityLineCount++
				this.callbacks.appendCommandActivityOutput?.(activityId, `${line}\n`)
				this.callbacks.updateCommandActivity?.(activityId, {
					latestEvent: line.trim() || "Command produced output",
					lineCount: activityLineCount,
				})
			},
			// When "Proceed While Running" is triggered, track the command in the manager
			// Returns the log file path so the orchestrator can send it to the UI
			// existingOutput contains all output lines captured so far
			onProceedWhileRunning: useStandalone
				? (existingOutput: string[]) => {
						if (backgroundCommand) {
							return {
								backgroundCommandId: backgroundCommand.id,
								logFilePath: backgroundCommand.logFilePath,
							}
						}
						backgroundCommand = this.standaloneManager.trackBackgroundCommand(
							process,
							command,
							activityId,
							existingOutput,
							{
								origin: options?.startInBackground ? "explicit_background" : "foreground",
								cancellationOwner,
							},
							{
								onOutputLine: (line) => {
									activityLineCount++
									this.callbacks.appendCommandActivityOutput?.(activityId, `${line}\n`)
									this.callbacks.updateCommandActivity?.(activityId, {
										latestEvent: line.trim() || "Command produced output",
										lineCount: activityLineCount,
									})
								},
								onTimeout: () => {
									this.callbacks.updateCommandActivity?.(activityId, {
										status: "timeout",
										latestEvent: "Background command timed out",
										lineCount: activityLineCount,
									})
								},
								onLogFileCreated: (logFilePath) => {
									this.callbacks.updateCommandActivity?.(activityId, { logPath: logFilePath })
									if (!options?.commandTs) return
									const messages = this.callbacks.getClineMessages() as Array<{ ts?: number }>
									const commandIndex = messages.findIndex((message) => message.ts === options.commandTs)
									if (commandIndex !== -1) {
										void this.callbacks.updateClineMessage(commandIndex, { logPath: logFilePath })
									}
								},
							},
						)
						this.callbacks.updateCommandActivity?.(activityId, {
							executionMode: "background",
							latestEvent: "Continuing in background",
							lineCount: activityLineCount,
							logPath: backgroundCommand.logFilePath,
						})
						return {
							backgroundCommandId: backgroundCommand.id,
							logFilePath: backgroundCommand.logFilePath,
						}
					}
				: undefined,
			startInBackground: options?.startInBackground,
			showShellIntegrationSuggestion: this.shouldShowBackgroundTerminalSuggestion(),
			terminalType: useStandalone ? "standalone" : "vscode",
		})

		if (result.logFilePath && options?.commandTs) {
			const messages = this.callbacks.getClineMessages() as Array<{ ts?: number }>
			const commandIndex = messages.findIndex((message) => message.ts === options.commandTs)
			if (commandIndex !== -1) {
				await this.callbacks.updateClineMessage(commandIndex, { logPath: result.logFilePath })
			}
		}

		// If the command was cancelled externally (via cancel button), return a clear cancellation message
		// This ensures the AI agent knows the command was cancelled by the user
		if (this.cancelledActivityIds.delete(activityId)) {
			const outputSoFar =
				result.outputLines.length > 0
					? `\nOutput captured before cancellation:\n${manager.processOutput(result.outputLines)}`
					: ""
			return {
				userRejected: true,
				result: `Command was cancelled by the user.${outputSoFar}`,
				completed: false,
				exitCode: result.exitCode,
				signal: result.signal,
			}
		}

		return result
	}

	/** Cancel exactly one command by its stable activity identity. */
	async cancelCommand(activityId: string): Promise<boolean> {
		const process = this.processes.get(activityId)
		if (!process?.terminate || !this.markCancellationRequested(activityId)) return false
		const background = this.standaloneManager.getBackgroundCommand(activityId)
		if (background?.status === "running") {
			if (this.standaloneManager.cancelBackgroundCommand(activityId)) return true
			this.cancelledActivityIds.delete(activityId)
			return false
		}
		await Promise.resolve(process.terminate())
		return true
	}

	/** Mark one cancellation request exactly once across every command control surface. */
	private markCancellationRequested(activityId: string): boolean {
		if (this.cancelledActivityIds.has(activityId)) return false
		this.cancelledActivityIds.add(activityId)
		this.callbacks.updateCommandActivity?.(activityId, {
			status: "cancelling",
			latestEvent: "Cancellation requested",
		})
		return true
	}

	/**
	 * Cancel all running commands (both foreground and background).
	 *
	 * This method cancels:
	 * 1. All detached background commands (those that were "proceeded while running")
	 * 2. The current foreground process (if one is actively running)
	 *
	 * @returns true if any commands were cancelled, false otherwise
	 */
	async cancelBackgroundCommand(): Promise<boolean> {
		return this.cancelCommands()
	}

	/** Cancel only foreground work owned by the Task lifecycle. */
	async cancelTaskOwnedCommands(): Promise<boolean> {
		return this.cancelCommands("task")
	}

	/** Cancel commands matching one lifecycle owner, or all commands for explicit user cancellation. */
	private async cancelCommands(cancellationOwner?: CommandCancellationOwner): Promise<boolean> {
		let cancelled = false

		// 1. Cancel detached background commands owned by this lifecycle.
		const runningCommands = this.standaloneManager.getRunningBackgroundCommands(cancellationOwner)
		const detachedActivityIds = new Set<string>()
		for (const cmd of runningCommands) {
			if (!this.markCancellationRequested(cmd.id)) continue
			if (this.standaloneManager.cancelBackgroundCommand(cmd.id)) {
				detachedActivityIds.add(cmd.id)
				cancelled = true
				Logger.info(`Cancelled background command: ${cmd.command}`)
			} else {
				this.cancelledActivityIds.delete(cmd.id)
			}
		}

		// 2. Cancel the current foreground process when it was not already terminated as detached work.
		const currentActivity = [...this.processes.entries()].find(([, process]) => process === this.currentProcess)
		const currentOwner = currentActivity ? this.cancellationOwners.get(currentActivity[0]) : undefined
		if (currentActivity && detachedActivityIds.has(currentActivity[0])) {
			this.currentProcess = null
		} else if (currentActivity && (!cancellationOwner || currentOwner === cancellationOwner)) {
			if (await this.cancelCommand(currentActivity[0])) {
				this.currentProcess = null
				cancelled = true
				Logger.info("Cancelled foreground command")
			}
		}

		// 3. Update UI state and notify user by modifying existing message
		// We modify the previous command_output message instead of sending a new say()
		// to avoid interfering with any pending ask() dialogs (which would cause
		// "Current ask promise was ignored" errors)
		if (cancelled) {
			this.callbacks.updateBackgroundCommandState(false)

			// Wait for terminal buffers to flush before updating the message
			// This prevents the cancellation notice from appearing in the middle of output
			await new Promise((resolve) => setTimeout(resolve, 300))

			// Find the last command_output message and update it
			const messages = this.callbacks.getClineMessages()
			const lastCommandOutputIndex = findLastIndex(messages, (m) => m.ask === "command_output")
			if (lastCommandOutputIndex !== -1) {
				const existingText = messages[lastCommandOutputIndex].text || ""
				const cancellationNotice = "\n\nCommand(s) cancelled by user."
				await this.callbacks.updateClineMessage(lastCommandOutputIndex, {
					text: existingText + cancellationNotice,
				})
			}
		}

		return cancelled
	}

	/** Return whether any active command is owned by the Task lifecycle. */
	hasTaskOwnedCommand(): boolean {
		if (this.standaloneManager.getRunningBackgroundCommands("task").length > 0) return true
		const currentActivity = [...this.processes.entries()].find(([, process]) => process === this.currentProcess)
		return Boolean(currentActivity && this.cancellationOwners.get(currentActivity[0]) === "task")
	}

	/**
	 * Check if there are any active background commands.
	 * Delegates to StandaloneTerminalManager.
	 */
	hasActiveBackgroundCommand(): boolean {
		return this.standaloneManager.hasActiveBackgroundCommands()
	}

	/**
	 * Get a summary of background commands for environment details.
	 * Delegates to StandaloneTerminalManager which tracks multiple commands.
	 */
	getBackgroundCommandSummary(): string | undefined {
		const summary = this.standaloneManager.getBackgroundCommandsSummary()
		return summary || undefined
	}

	/**
	 * List task-local background commands for environment details injection.
	 * @returns All background commands tracked by the standalone manager.
	 */
	listBackgroundCommands(): BackgroundCommand[] {
		return this.standaloneManager.getAllBackgroundCommands()
	}

	/** Read output retained in memory or in the lazily-created background log. */
	readBackgroundCommandOutput(command: BackgroundCommand): Promise<string> {
		return this.standaloneManager.readBackgroundCommandOutput(command.id)
	}

	/**
	 * Mark background commands as injected into model context.
	 * @param ids Background command identifiers.
	 */
	markBackgroundCommandsInjected(ids: string[]): void {
		this.standaloneManager.markBackgroundCommandsInjected(ids)
	}

	/**
	 * Mark background commands as consumed by a sent model request.
	 * @param ids Background command identifiers.
	 */
	markBackgroundCommandsConsumed(ids: string[]): void {
		this.standaloneManager.markBackgroundCommandsConsumed(ids)
	}

	/**
	 * Determines whether to show the background terminal suggestion.
	 * Shows suggestion if there have been 3+ shell integration warnings in the last hour,
	 * and we haven't shown the suggestion in the last hour.
	 *
	 * @returns true if the suggestion should be shown, false otherwise
	 */
	private shouldShowBackgroundTerminalSuggestion(): boolean {
		const oneHourAgo = Date.now() - 60 * 60 * 1000

		// Clean old timestamps (older than 1 hour)
		this.shellIntegrationWarningTracker.timestamps = this.shellIntegrationWarningTracker.timestamps.filter(
			(ts) => ts > oneHourAgo,
		)

		// Add current warning
		this.shellIntegrationWarningTracker.timestamps.push(Date.now())

		// Check if we've shown suggestion recently (within last hour)
		if (
			this.shellIntegrationWarningTracker.lastSuggestionShown &&
			Date.now() - this.shellIntegrationWarningTracker.lastSuggestionShown < 60 * 60 * 1000
		) {
			return false
		}

		// Show suggestion if 3+ warnings in last hour
		if (this.shellIntegrationWarningTracker.timestamps.length >= 3) {
			this.shellIntegrationWarningTracker.lastSuggestionShown = Date.now()
			return true
		}

		return false
	}
}
