/**
 * Shared terminal types and interfaces for both VSCode and Standalone terminal managers.
 * These types ensure compatibility between the VSCode-based TerminalManager and
 * the StandaloneTerminalManager used in CLI/JetBrains environments.
 */

import type { CommandStatus, SubagentInjectionState } from "@shared/ExtensionMessage"
import type { ClineToolResponseContent } from "@shared/messages"
import type { EventEmitter } from "events"

// =============================================================================
// Terminal Process Types
// =============================================================================

/**
 * Event types for terminal process
 */
export interface TerminalCompletionDetails {
	/** Process exit code when available */
	exitCode?: number | null
	/** Termination signal when available */
	signal?: NodeJS.Signals | null
}

export interface TerminalProcessEvents {
	line: [line: string]
	continue: []
	completed: [details?: TerminalCompletionDetails]
	error: [error: Error]
	no_shell_integration: []
}

/**
 * Interface for terminal process implementations.
 * Both VscodeTerminalProcess and StandaloneTerminalProcess implement this interface.
 *
 * Events emitted:
 * - 'line': Emitted for each line of output
 * - 'completed': Emitted when the process completes
 * - 'continue': Emitted when continue() is called
 * - 'error': Emitted on process errors
 * - 'no_shell_integration': Emitted when shell integration is not available (VSCode only)
 */
export interface ITerminalProcess extends EventEmitter<TerminalProcessEvents> {
	/**
	 * Whether the process is actively outputting (used to stall API requests)
	 */
	isHot: boolean

	/**
	 * Whether to wait for shell integration before running commands.
	 * VSCode processes may need to wait, standalone processes don't.
	 */
	waitForShellIntegration: boolean

	/**
	 * Continue execution without waiting for completion.
	 * Stops event emission and resolves the promise.
	 * This is called when user clicks "Proceed While Running".
	 */
	continue(): void

	/**
	 * Get output that hasn't been retrieved yet.
	 * @returns The unretrieved output
	 */
	getUnretrievedOutput(): string

	/**
	 * Get completion metadata for the most recent command execution.
	 */
	getCompletionDetails?(): TerminalCompletionDetails

	/**
	 * Terminate the process if it's still running.
	 * Only available for standalone processes (child_process).
	 * VSCode terminal processes cannot be terminated via this interface.
	 *
	 * May be async to allow for graceful shutdown with SIGKILL fallback.
	 */
	terminate?(): void | Promise<void>
}

// =============================================================================
// Terminal Types
// =============================================================================

/**
 * Represents a terminal instance with its metadata and state.
 */
export interface TerminalInfo {
	/** Unique identifier for the terminal */
	id: number
	/** The underlying terminal instance */
	terminal: ITerminal
	/** Whether the terminal is currently executing a command */
	busy: boolean
	/** The last command executed in this terminal */
	lastCommand: string
	/** The shell path used by this terminal (e.g., /bin/bash, /bin/zsh) */
	shellPath?: string
	/** Timestamp of last activity */
	lastActive: number
	/** Pending CWD change path (used for tracking directory changes) */
	pendingCwdChange?: string
	/** Promise resolver for CWD change completion */
	cwdResolved?: { resolve: () => void; reject: (err: Error) => void }
}

/**
 * Minimal terminal interface that both VSCode terminals and standalone terminals implement.
 */
export interface ITerminal {
	/** Terminal name */
	name: string
	/** Promise that resolves to the process ID */
	processId: Promise<number | undefined>
	/** Shell integration information (if available) */
	shellIntegration?: {
		cwd?: { fsPath: string }
		executeCommand?: (command: string) => {
			read: () => AsyncIterable<string>
		}
	}
	/** Send text to the terminal */
	sendText(text: string, addNewLine?: boolean): void
	/** Show the terminal */
	show(): void
	/** Hide the terminal */
	hide(): void
	/** Dispose of the terminal */
	dispose(): void
}

/**
 * Terminal process result interface.
 * @deprecated Use ITerminalProcess instead.
 * This is kept for backwards compatibility.
 */
export type ITerminalProcessResult = ITerminalProcess

/**
 * Promise-like interface for terminal process results.
 * Combines Promise<void> with ITerminalProcess for flexible usage.
 * This allows the process to be awaited while also providing access to events.
 */
export type TerminalProcessResultPromise = Promise<void> &
	ITerminalProcess & {
		/** Listen for line output events */
		on(event: "line", listener: (line: string) => void): TerminalProcessResultPromise
		/** Listen for completion event */
		on(event: "completed", listener: (details?: TerminalCompletionDetails) => void): TerminalProcessResultPromise
		/** Listen for continue event */
		on(event: "continue", listener: () => void): TerminalProcessResultPromise
		/** Listen for error events */
		on(event: "error", listener: (error: Error) => void): TerminalProcessResultPromise
		/** Listen for no shell integration event */
		on(event: "no_shell_integration", listener: () => void): TerminalProcessResultPromise
		/** Listen once for any event */
		once(event: string, listener: (...args: any[]) => void): TerminalProcessResultPromise
	}

/**
 * Interface for terminal managers (both VSCode and Standalone implementations).
 * Defines the contract that both implementations must follow.
 */
export interface ITerminalManager {
	/**
	 * Run a command in the specified terminal.
	 * @param terminalInfo The terminal to run the command in
	 * @param command The command to execute
	 * @returns A promise-like object that emits events and resolves on completion
	 */
	runCommand(terminalInfo: TerminalInfo, command: string): TerminalProcessResultPromise

	/**
	 * Get or create a terminal for the specified working directory.
	 * @param cwd The working directory for the terminal
	 * @returns The terminal info for an available terminal
	 */
	getOrCreateTerminal(cwd: string): Promise<TerminalInfo>

	/**
	 * Get terminals filtered by busy state.
	 * @param busy Whether to get busy or idle terminals
	 * @returns Array of terminal info with id and last command
	 */
	getTerminals(busy: boolean): { id: number; lastCommand: string }[]

	/**
	 * Get output that hasn't been retrieved yet from a terminal.
	 * @param terminalId The terminal ID
	 * @returns The unretrieved output string
	 */
	getUnretrievedOutput(terminalId: number): string

	/**
	 * Check if a terminal's process is actively outputting.
	 * @param terminalId The terminal ID
	 * @returns Whether the process is hot
	 */
	isProcessHot(terminalId: number): boolean

	/**
	 * Dispose of all terminals and clean up resources.
	 */
	disposeAll(): void

	/**
	 * Set the timeout for waiting for shell integration.
	 * @param timeout Timeout in milliseconds
	 */
	setShellIntegrationTimeout(timeout: number): void

	/**
	 * Enable or disable terminal reuse.
	 * @param enabled Whether to enable terminal reuse
	 */
	setTerminalReuseEnabled(enabled: boolean): void

	/**
	 * Set the maximum number of output lines to keep.
	 * @param limit Maximum number of lines
	 */
	setTerminalOutputLineLimit(limit: number): void

	/**
	 * Set the default terminal profile.
	 * @param profile The profile identifier
	 */
	setDefaultTerminalProfile(profile: string): void

	/**
	 * Process output lines, potentially truncating if over limit.
	 * @param outputLines Array of output lines
	 * @param overrideLimit Optional limit override
	 * @returns Processed output string
	 */
	processOutput(outputLines: string[], overrideLimit?: number): string
}

/**
 * Options for creating a standalone terminal.
 */
export interface StandaloneTerminalOptions {
	/** Terminal name */
	name?: string
	/** Working directory */
	cwd?: string
	/** Shell path to use */
	shellPath?: string
}

// =============================================================================
// Background Command Types
// =============================================================================

/**
 * Represents a command running in the background after user clicked "Proceed While Running".
 * Used by StandaloneTerminalManager to track background commands.
 */
export type CommandOrigin = "explicit_background" | "foreground"

export type CommandCancellationOwner = "explicit" | "task"

export interface BackgroundCommand {
	/** Unique identifier for the background command */
	id: string
	/** The command string being executed */
	command: string
	/** Timestamp when the command started */
	startTime: number
	/** Current status of the command */
	status: "running" | "completed" | "error" | "timed_out" | "cancelled"
	/** How the command entered background execution. */
	origin: CommandOrigin
	/** Lifecycle boundary allowed to cancel this command. */
	cancellationOwner: CommandCancellationOwner
	/** Path to the log file after buffered output has crossed the spill limit. */
	logFilePath?: string
	/** Number of output lines captured in memory or on disk */
	lineCount: number
	/** Exit code if the command completed or errored */
	exitCode?: number
	/** Context injection lifecycle state for background command visibility */
	injectionState?: SubagentInjectionState
	/** The terminal process running the command */
	process: TerminalProcessResultPromise
}

// =============================================================================
// Command Executor Types
// =============================================================================

/**
 * Tracker for shell integration warnings to determine when to show background terminal suggestion.
 * Used internally by CommandExecutor to track warning frequency.
 */
export interface ShellIntegrationWarningTracker {
	/** Timestamps of recent shell integration warnings */
	timestamps: number[]
	/** Timestamp when the suggestion was last shown */
	lastSuggestionShown?: number
}

/**
 * Represents an active background command that can be cancelled
 * @deprecated Use BackgroundCommand instead
 */
export interface ActiveBackgroundCommand {
	process: {
		terminate?: () => void
		continue?: () => void
	}
	command: string
	outputLines: string[]
}

/**
 * Response from an ask() call
 */
export interface AskResponse {
	response: string // "yesButtonClicked" | "noButtonClicked" | "messageResponse"
	text?: string
	images?: string[]
	files?: string[]
}

/**
 * Callbacks for CommandExecutor to interact with Task state
 * These are bound methods from the Task class that allow CommandExecutor
 * to update UI and state without owning that state directly.
 */
export interface CommandExecutorCallbacks {
	/** Display a message in the chat UI (non-blocking) */
	say: (
		type: string,
		text?: string,
		images?: string[],
		files?: string[],
		partial?: boolean,
		existingTs?: number,
		commandTs?: number,
	) => Promise<number | undefined>
	/**
	 * Ask the user a question and wait for response (blocking)
	 * This is used for "Proceed While Running" flow where we need to wait for user input
	 */
	ask: (type: string, text?: string, partial?: boolean, options?: { commandTs?: number }) => Promise<AskResponse>
	/** Resolve the currently pending ask (if any). Used to release command_output waits on terminal lifecycle transitions. */
	resolvePendingAsk?: (response: AskResponse["response"]) => void
	/** Update the background command running state in the controller */
	updateBackgroundCommandState: (running: boolean) => void
	/**
	 * Update a cline message by index
	 * Supports updating commandCompleted status and/or text content
	 */
	updateClineMessage: (
		index: number,
		updates: { text?: string; exitCode?: number; commandStatus?: CommandStatus; logPath?: string; activityId?: string },
	) => Promise<void>
	/** Get cline messages array */
	getClineMessages: () => Array<{ ask?: string; say?: string; text?: string }>
	/** Add content to user message for next API request */
	addToUserMessageContent: (content: { type: string; text: string }) => void
	/** Mark that command execution may have modified workspace files. */
	markWorkspaceScanRequired?: () => void
	/** Register a command in the task-local activity monitor. */
	createCommandActivity?: (input: {
		activityId: string
		command: string
		executionMode: "foreground" | "background"
		cancellationOwner: CommandCancellationOwner
		cancel: () => void | Promise<void>
	}) => void
	/** Apply a lightweight activity patch without rebuilding ExtensionState. */
	updateCommandActivity?: (
		activityId: string,
		patch: {
			status?: "running" | "cancelling" | "completed" | "failed" | "timeout" | "cancelled"
			executionMode?: "foreground" | "background"
			latestEvent?: string
			error?: string
			lineCount?: number
			logPath?: string
		},
	) => void
	/** Append one bounded command output delta to the activity monitor. */
	appendCommandActivityOutput?: (activityId: string, text: string) => void
}

/**
 * Optional per-command execution behavior overrides.
 */
export interface CommandExecutionOptions {
	/**
	 * Force command execution in standalone/background terminal mode for this command.
	 * This is useful for subagent runs and headless-style execution flows.
	 */
	useBackgroundExecution?: boolean
	/** Start the command as a Dline-owned background process and return immediately. */
	startInBackground?: boolean
	/**
	 * Suppress command interaction/output UI messages (ask/say) for this command execution.
	 * Command output is still captured and returned as the tool result.
	 */
	suppressUserInteraction?: boolean
	/** ts of the command message, passed from handler to associate outputs */
	commandTs?: number
}

/**
 * Configuration for CommandExecutor
 */
export interface CommandExecutorConfig {
	/** Working directory for command execution */
	cwd: string
	/** Task ID for tracking */
	taskId: string
	/** Unique task identifier */
	ulid: string
	/** Terminal execution mode */
	terminalExecutionMode: "vscodeTerminal" | "backgroundExec"
	/** The primary terminal manager (VSCode or Standalone) */
	terminalManager: ITerminalManager
}

/** Alias for backwards compatibility */
export type FullCommandExecutorConfig = CommandExecutorConfig

// =============================================================================
// Command Orchestrator Types
// =============================================================================

/**
 * Options for command orchestration
 */
export interface OrchestrationOptions {
	/** Stable identity shared by command activity and owned log files. */
	activityId?: string
	/** Return whether this command is in the canonical cancellation transaction. */
	isCancellationRequested?: () => boolean
	/** The command being executed */
	command: string
	/** Optional timeout in seconds */
	timeoutSeconds?: number
	/** Callback to track output lines for background command tracking */
	onOutputLine?: (line: string) => void
	/** Whether to show shell integration warning with suggestion */
	showShellIntegrationSuggestion?: boolean
	/**
	 * Callback invoked when user clicks "Proceed While Running".
	 * Used to start background command tracking in the terminal manager.
	 * @param existingOutput The output lines captured so far (to write to log file)
	 * @returns The log file path if tracking was started, undefined otherwise
	 */
	onProceedWhileRunning?: (existingOutput: string[]) => { backgroundCommandId: string; logFilePath?: string } | undefined
	/** Start in background without waiting for timeout or user intervention. */
	startInBackground?: boolean
	/**
	 * The type of terminal being used for telemetry tracking.
	 * Defaults to "vscode" for backward compatibility.
	 */
	terminalType?: "vscode" | "standalone"
	/**
	 * If true, suppresses command-output ask/say UI interactions.
	 * Output is still collected and included in the final result.
	 */
	suppressUserInteraction?: boolean
	/** ts of the command message, passed from handler to associate outputs */
	commandTs?: number
}

/**
 * Result of command orchestration
 */
export interface CommandExecutionOutcome {
	/** Whether execution was rejected or cancelled by the user. */
	userRejected: boolean
	/** Tool result returned to the model. */
	result: ClineToolResponseContent
	/** Whether the command reached a terminal completion event. */
	completed: boolean
	/** Process exit code when available. */
	exitCode?: number | null
	/** Process termination signal when available. */
	signal?: NodeJS.Signals | null
	/** Stable background command identifier when execution was detached. */
	backgroundCommandId?: string
	/** Background log path when available. */
	logFilePath?: string
}

export interface OrchestrationResult extends CommandExecutionOutcome {
	/** All output lines captured */
	outputLines: string[]
	/** Path to log file if output was too large and written to file */
	logFilePath?: string
}
