/**
 * CommandOrchestrator - Shared command execution orchestration logic.
 *
 * This module contains the common orchestration logic for command execution
 * that is shared between VSCode and Standalone terminal modes. It handles:
 * - Output buffering and chunking
 * - User interaction (ask/say callbacks)
 * - "Proceed While Running" behavior
 * - Timeout handling
 * - Result formatting
 *
 * The actual process spawning/management is handled by the TerminalProcess
 * implementations (VscodeTerminalProcess, StandaloneTerminalProcess).
 */

import { formatResponse } from "@core/prompts/responses"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { TerminalHangStage, TerminalUserInterventionAction, telemetryService } from "@services/telemetry"
import { DlineTempManager } from "@services/temp"
import { COMMAND_CANCEL_TOKEN } from "@shared/ExtensionMessage"
import * as fs from "fs"
import { Logger } from "@/shared/services/Logger"
import { isCommandCompletionSuccessful } from "./command-completion"
import { appendCommandLogPath } from "./command-result"
import {
	BUFFER_STUCK_TIMEOUT_MS,
	CHUNK_BYTE_SIZE,
	CHUNK_DEBOUNCE_MS,
	CHUNK_LINE_COUNT,
	COMPLETION_TIMEOUT_MS,
	DEFAULT_TERMINAL_OUTPUT_LINE_LIMIT,
	MAX_BYTES_BEFORE_FILE,
} from "./constants"
import { formatTerminalOutput, formatTerminalOutputLogLine, splitTerminalOutput } from "./output-stream"
import type {
	CommandExecutorCallbacks,
	ITerminalManager,
	OrchestrationOptions,
	OrchestrationResult,
	TerminalCompletionDetails,
	TerminalOutputLine,
	TerminalOutputStream,
	TerminalProcessResultPromise,
} from "./types"

/**
 * Orchestrate command execution with shared logic for buffering, user interaction, and result formatting.
 *
 * @param process The terminal process (implements ITerminalProcess)
 * @param terminalManager The terminal manager (for processOutput)
 * @param callbacks The executor callbacks for UI interaction
 * @param options Orchestration options
 * @returns The orchestration result
 */
export async function orchestrateCommandExecution(
	process: TerminalProcessResultPromise,
	terminalManager: ITerminalManager,
	callbacks: CommandExecutorCallbacks,
	options: OrchestrationOptions,
): Promise<OrchestrationResult> {
	const {
		timeoutSeconds,
		startedAt: configuredStartedAt,
		deadlineAt: configuredDeadlineAt,
		synchronous = false,
		handoffSeconds = 10,
		onHandoffAvailable,
		handoffRequest,
		onTimeout,
		onOutputLine,
		showShellIntegrationSuggestion,
		onProceedWhileRunning,
		startInBackground = false,
		terminalType = "vscode",
		suppressUserInteraction = false,
		activityId,
	} = options

	const say = async (
		type: Parameters<CommandExecutorCallbacks["say"]>[0],
		text?: Parameters<CommandExecutorCallbacks["say"]>[1],
		images?: Parameters<CommandExecutorCallbacks["say"]>[2],
		files?: Parameters<CommandExecutorCallbacks["say"]>[3],
		partial?: Parameters<CommandExecutorCallbacks["say"]>[4],
		existingTs?: Parameters<CommandExecutorCallbacks["say"]>[5],
		commandTs?: Parameters<CommandExecutorCallbacks["say"]>[6],
	): Promise<Awaited<ReturnType<CommandExecutorCallbacks["say"]>>> => {
		if (suppressUserInteraction) {
			return undefined
		}

		// Inject commandTs for command_output messages so the frontend can associate them
		if (type === "command_output" && cmdTs && !commandTs) {
			commandTs = cmdTs
		}
		return callbacks.say(type, text, images, files, partial, existingTs, commandTs)
	}

	const ask = async (
		type: Parameters<CommandExecutorCallbacks["ask"]>[0],
		text?: Parameters<CommandExecutorCallbacks["ask"]>[1],
		partial?: Parameters<CommandExecutorCallbacks["ask"]>[2],
		options?: Parameters<CommandExecutorCallbacks["ask"]>[3],
	): Promise<Awaited<ReturnType<CommandExecutorCallbacks["ask"]>> | undefined> => {
		if (suppressUserInteraction) {
			return undefined
		}

		// Inject commandTs for command_output messages so the frontend can associate them
		if (type === "command_output" && cmdTs && !options?.commandTs) {
			options = { ...options, commandTs: cmdTs }
		}
		return callbacks.ask(type, text, partial, options)
	}

	// Track command execution state
	callbacks.updateBackgroundCommandState(true)

	// Use commandTs from options if provided (handler passes block.ts).
	// Fall back to searching for pending command for backward compatibility.
	let cmdTs: number | undefined = options.commandTs
	const initialMessages = callbacks.getClineMessages() as Array<{ ask?: string; say?: string; ts: number }>
	if (!cmdTs) {
		for (let i = initialMessages.length - 1; i >= 0; i--) {
			if (
				(initialMessages[i] as any).commandStatus === "pending" &&
				(initialMessages[i].ask === "command" || initialMessages[i].say === "command")
			) {
				cmdTs = initialMessages[i].ts
				break
			}
		}
	}
	// Find the first pending command (by array order, FIFO) to mark it as running
	const initialCmdIndex = initialMessages.findIndex(
		(m) => (m.ask === "command" || m.say === "command") && (m as any).commandStatus === "pending",
	)
	if (initialCmdIndex !== -1) {
		await callbacks.updateClineMessage(initialCmdIndex, { commandStatus: "running" })
	}

	const clearCommandState = async (details?: TerminalCompletionDetails, didError = false) => {
		callbacks.updateBackgroundCommandState(false)

		// Do not overwrite any canonical cancellation terminal state.
		if (didCancelViaUi || options.isCancellationRequested?.()) {
			return
		}

		// Mark the command message as completed with exit code
		if (cmdTs) {
			const msgs = callbacks.getClineMessages() as Array<{ ts: number; commandStatus?: string }>
			const idx = msgs.findIndex((m) => m.ts === cmdTs)
			if (idx !== -1) {
				// Preserve skipped status set by the cancel branch
				if ((msgs[idx] as any).commandStatus === "skipped") {
					return
				}
				try {
					const exitCode = details?.exitCode
					const failed = didError || !isCommandCompletionSuccessful(details)
					await callbacks.updateClineMessage(idx, {
						commandStatus: failed ? "failed" : "completed",
						exitCode: exitCode ?? (didError ? -1 : undefined),
					})
				} catch (e) {
					Logger.error(`[clearCommandState] updateClineMessage failed: ${e}`)
				}
			}
		}
	}

	process.once("completed", (details) => {
		void clearCommandState(details)
	})
	process.once("error", () => {
		void clearCommandState(undefined, true)
	})
	process.catch(() => {
		void clearCommandState(undefined, true)
	})

	let userFeedback: { text?: string; images?: string[]; files?: string[] } | undefined
	// Command output is presentation state, not an interaction. Stream it from
	// the first chunk; a blocking command_output ask has no canonical response
	// and used to hold every later chunk until process completion.
	let didContinue = true
	let didCancelViaUi = false
	let backgroundTrackingResult: OrchestrationResult | null = null // Set when background tracking returns early
	// Track partial (incremental) say output for post-continue phase
	let partialSayOutputTs: number | undefined
	const partialSayLines: string[] = []

	// Chunked terminal output buffering
	let outputBuffer: string[] = []
	let outputBufferSize = 0
	let chunkTimer: NodeJS.Timeout | null = null

	// Track if buffer gets stuck
	let bufferStuckTimer: NodeJS.Timeout | null = null
	let commandOutputAskSequence = 0
	let pendingCommandOutputAskId: number | null = null
	let releasePendingCommandOutputAsk: (() => void) | null = null
	let completed = false
	let completionDetails: TerminalCompletionDetails | undefined
	let completionTimer: NodeJS.Timeout | null = null
	let completionWork: Promise<void> = Promise.resolve()
	let outputWork: Promise<void> = Promise.resolve()

	const enqueueOutputWork = (work: () => Promise<void>): void => {
		outputWork = outputWork.then(work).catch((error) => {
			Logger.error(`[CommandOrchestrator] Failed to process terminal output: ${error}`)
		})
	}

	const drainOutputQueue = async (): Promise<void> => {
		while (true) {
			const pendingWork = outputWork
			await pendingWork
			if (pendingWork === outputWork) {
				return
			}
		}
	}

	const clearPendingCommandOutputAsk = () => {
		pendingCommandOutputAskId = null
		releasePendingCommandOutputAsk = null
	}

	const releaseAnyPendingCommandOutputAsk = () => {
		const release = releasePendingCommandOutputAsk
		if (!release) {
			return
		}
		callbacks.resolvePendingAsk?.("messageResponse")
		release()
	}

	/**
	 * Flush buffered output to the UI using ask() which waits for user response.
	 * This is the key mechanism for "Proceed While Running" - when user clicks the button,
	 * the ask() returns with response "yesButtonClicked".
	 */
	const flushBuffer = async (_force = false) => {
		if (outputBuffer.length === 0) {
			return
		}
		const chunk = outputBuffer.join("\n")
		outputBuffer = []
		outputBufferSize = 0

		if (!didContinue && completed) {
			// Completion must never create a new blocking ask. Persist trailing
			// output as a final message while the completion path awaits this work.
			await say("command_output", chunk)
		} else if (!didContinue) {
			// Start timer to detect if buffer gets stuck
			bufferStuckTimer = setTimeout(() => {
				telemetryService.captureTerminalHang(TerminalHangStage.BUFFER_STUCK, terminalType)
				bufferStuckTimer = null
			}, BUFFER_STUCK_TIMEOUT_MS)

			try {
				// Use ask() to present output and wait for user response
				// This enables "Proceed While Running" button functionality
				const interaction = await new Promise<Awaited<ReturnType<CommandExecutorCallbacks["ask"]>> | undefined>(
					(resolve, reject) => {
						const currentAskId = ++commandOutputAskSequence
						pendingCommandOutputAskId = currentAskId

						releasePendingCommandOutputAsk = () => {
							if (pendingCommandOutputAskId !== currentAskId) {
								return
							}
							clearPendingCommandOutputAsk()
							resolve(undefined)
						}

						ask("command_output", chunk)
							.then((result) => {
								if (pendingCommandOutputAskId !== currentAskId) {
									return
								}
								clearPendingCommandOutputAsk()
								resolve(result)
							})
							.catch((error) => {
								if (pendingCommandOutputAskId !== currentAskId) {
									return
								}
								clearPendingCommandOutputAsk()
								reject(error)
							})
					},
				)
				if (!interaction) {
					return
				}
				const { response, text, images, files } = interaction

				if (response === "yesButtonClicked") {
					// Track when user clicks "Proceed While Running"
					telemetryService.captureTerminalUserIntervention(
						TerminalUserInterventionAction.PROCESS_WHILE_RUNNING,
						terminalType,
					)
					// Proceed while running - but still capture user feedback if provided
					if (text || (images && images.length > 0) || (files && files.length > 0)) {
						userFeedback = { text, images, files }
					}
					didContinue = true

					if (onProceedWhileRunning) {
						await transitionToBackground("user", false)
						return
					}

					process.continue()
				} else if (response === "noButtonClicked" && text === COMMAND_CANCEL_TOKEN) {
					telemetryService.captureTerminalUserIntervention(TerminalUserInterventionAction.CANCELLED, terminalType)
					// Set flags BEFORE resuming the process to prevent new lines from being processed
					didCancelViaUi = true
					// Mark command as skipped
					if (cmdTs) {
						const cancelMsgs = callbacks.getClineMessages() as Array<{ ts: number }>
						const cancelCmdIndex = cancelMsgs.findIndex((m) => m.ts === cmdTs)
						if (cancelCmdIndex !== -1) {
							await callbacks.updateClineMessage(cancelCmdIndex, { commandStatus: "skipped" })
						}
					}
					userFeedback = undefined
					didContinue = true
					outputBuffer = []
					outputBufferSize = 0
					// Send cancellation message BEFORE resuming the process
					// This ensures the message appears before any new output lines
					await say("command_output", "Command cancelled")
					// Now resume the process
					process.continue()
				} else {
					userFeedback = { text, images, files }
					didContinue = true
					process.continue()
					// If more output accumulated, flush again
					if (outputBuffer.length > 0) {
						await flushBuffer()
					}
				}
			} catch {
				Logger.error("Error while asking for command output")
			} finally {
				// Clear the stuck timer
				if (bufferStuckTimer) {
					clearTimeout(bufferStuckTimer)
					bufferStuckTimer = null
				}
			}
		} else {
			// After "Proceed While Running": stream output via partial updates to reduce frontend merge pressure
			partialSayLines.push(chunk)
			const combined = partialSayLines.join("\n")
			if (partialSayOutputTs === undefined) {
				partialSayOutputTs = await say("command_output", combined, undefined, undefined, true, undefined, cmdTs)
			} else {
				await say("command_output", combined, undefined, undefined, true, partialSayOutputTs)
			}
		}
	}

	const scheduleFlush = () => {
		if (chunkTimer) {
			clearTimeout(chunkTimer)
		}
		chunkTimer = setTimeout(() => {
			chunkTimer = null
			enqueueOutputWork(() => flushBuffer())
		}, CHUNK_DEBOUNCE_MS)
	}

	// Large output file-based logging state
	let isWritingToFile = false
	let largeOutputLogPath: string | null = null
	let largeOutputLogStream: fs.WriteStream | null = null
	let largeOutputLogCompletion: Promise<void> | null = null
	let totalOutputBytes = 0
	let totalLineCount = 0
	const outputLineLimit = Math.max(
		1,
		terminalManager.getConfiguration?.().terminalOutputLineLimit ?? DEFAULT_TERMINAL_OUTPUT_LINE_LIMIT,
	)
	const firstLineLimit = Math.floor(outputLineLimit / 2)
	const lastLineLimit = outputLineLimit - firstLineLimit
	let firstLines: TerminalOutputLine[] = [] // Keep first N lines for summary
	let lastLines: TerminalOutputLine[] = [] // Keep last N lines for summary (circular buffer)

	/**
	 * Switch to file-based logging when output is too large.
	 * This protects against memory exhaustion from commands with huge output.
	 */
	const switchToFileBased = async () => {
		if (isWritingToFile) return

		isWritingToFile = true

		// FIRST: Flush any pending buffer to UI so the "writing to file" message appears at the end
		if (outputBuffer.length > 0) {
			const chunk = outputBuffer.join("\n")
			outputBuffer = []
			outputBufferSize = 0
			if (!didContinue) {
				// Use say() instead of ask() since we're transitioning to file mode
				await say("command_output", chunk)
			}
		}

		// Clear any pending flush timer
		if (chunkTimer) {
			clearTimeout(chunkTimer)
			chunkTimer = null
		}

		const largeOutputStem = activityId ?? `large-output-${cmdTs ?? Date.now()}`
		largeOutputLogPath = DlineTempManager.createTempFilePath(largeOutputStem)
		const logFd = fs.openSync(largeOutputLogPath, "w")
		largeOutputLogStream = fs.createWriteStream(largeOutputLogPath, { fd: logFd, flags: "w", autoClose: true })
		largeOutputLogCompletion = new Promise<void>((resolve) => {
			largeOutputLogStream?.once("finish", resolve)
			largeOutputLogStream?.once("error", () => resolve())
		})

		// Write all existing lines to file in a single batch to reduce I/O overhead
		if (output.length > 0) {
			largeOutputLogStream.write(`${output.map(formatTerminalOutputLogLine).join("\n")}\n`)
		}

		// Keep first N lines for summary
		firstLines = output.slice(0, firstLineLimit)

		// Keep last N lines for summary (will be updated as more lines come in)
		lastLines = lastLineLimit > 0 ? output.slice(-lastLineLimit) : []

		// FINALLY: Notify user (now this will appear at the end after all buffered output)
		await say(
			"command_output",
			`\n📋 Output is large (${totalLineCount} lines, ${Math.round(totalOutputBytes / 1024)}KB). Writing to: ${largeOutputLogPath}`,
		)
	}

	/**
	 * Clean up file-based logging resources.
	 */
	const finishFileBased = async (): Promise<void> => {
		const stream = largeOutputLogStream
		if (!stream) return
		largeOutputLogStream = null
		stream.end()
		await largeOutputLogCompletion
	}

	const output: TerminalOutputLine[] = []
	const formatOutput = (entries: readonly TerminalOutputLine[]): string =>
		formatTerminalOutput(entries, (lines) => terminalManager.processOutput(lines))

	let commandTiming: { startedAt: number; deadlineAt?: number } | undefined
	type BackgroundTransitionReason = "explicit" | "automatic" | "user"
	const transitionToBackground = async (
		reason: BackgroundTransitionReason,
		drainQueuedOutput: boolean,
	): Promise<OrchestrationResult | undefined> => {
		if (!onProceedWhileRunning) {
			return undefined
		}

		didContinue = true
		if (chunkTimer) {
			clearTimeout(chunkTimer)
			chunkTimer = null
		}
		if (completionTimer) {
			clearTimeout(completionTimer)
			completionTimer = null
		}
		if (drainQueuedOutput) {
			await drainOutputQueue()
		}

		await finishFileBased()
		const timing = commandTiming ?? { startedAt: Date.now(), deadlineAt: configuredDeadlineAt }
		const trackingResult = await onProceedWhileRunning(isWritingToFile ? [] : output, {
			...timing,
			existingLogFilePath: largeOutputLogPath ?? undefined,
			existingLineCount: totalLineCount,
		})
		const logMessage = trackingResult?.logFilePath ? `Log file: ${trackingResult.logFilePath}\n` : ""
		const resultPrefix =
			reason === "automatic"
				? `Command is still running after ${handoffSeconds} seconds and is now tracked in the background.`
				: "Command is running in the background. You can proceed with other tasks."

		backgroundTrackingResult = {
			userRejected: false,
			result: `${resultPrefix}\n${logMessage}`.trimEnd(),
			completed: false,
			...splitTerminalOutput([]),
			backgroundCommandId: trackingResult?.backgroundCommandId,
			logFilePath: trackingResult?.logFilePath,
		}

		if (trackingResult?.logFilePath) {
			await say("command_output", `\n📋 Output is being logged to: ${trackingResult.logFilePath}`)
		}

		process.continue()
		return backgroundTrackingResult
	}

	const handleOutputLine = async (line: string, stream: TerminalOutputStream): Promise<void> => {
		if (didCancelViaUi) {
			return
		}

		// If background tracking is active, don't process lines here
		// The background tracker's listener will handle them
		if (backgroundTrackingResult) {
			return
		}

		const lineBytes = Buffer.byteLength(line, "utf8")
		totalOutputBytes += lineBytes
		totalLineCount++

		// Check if we should switch to file-based logging
		if (!isWritingToFile && (output.length >= outputLineLimit || totalOutputBytes >= MAX_BYTES_BEFORE_FILE)) {
			await switchToFileBased()
		}

		if (isWritingToFile) {
			// Write to file instead of keeping in memory
			if (largeOutputLogStream) {
				largeOutputLogStream.write(`${formatTerminalOutputLogLine({ line, stream })}\n`)
			}

			// Update last lines circular buffer for summary
			lastLines.push({ line, stream })
			if (lastLines.length > lastLineLimit) {
				lastLines.shift()
			}
		} else {
			// Normal behavior - keep in memory
			output.push({ line, stream })
		}

		// Notify caller about output line (for background command tracking)
		if (onOutputLine) {
			onOutputLine(line, stream)
		}

		// Apply buffered streaming (only if not in file mode or still showing initial output)
		if (!didContinue) {
			if (!isWritingToFile) {
				outputBuffer.push(line)
				outputBufferSize += lineBytes
				// Flush if buffer is large enough
				if (outputBuffer.length >= CHUNK_LINE_COUNT || outputBufferSize >= CHUNK_BYTE_SIZE) {
					await flushBuffer()
				} else if (!completed) {
					scheduleFlush()
				}
			}
			// When in file mode, we've already notified the user, so don't keep buffering
		} else {
			// Stream through the same bounded buffer so high-volume commands do not
			// cause one webview update per terminal line.
			if (!isWritingToFile) {
				outputBuffer.push(line)
				outputBufferSize += lineBytes
				if (outputBuffer.length >= CHUNK_LINE_COUNT || outputBufferSize >= CHUNK_BYTE_SIZE) {
					await flushBuffer()
				} else if (!completed) {
					scheduleFlush()
				}
			}
		}
	}
	process.on("line", (line: string, stream: TerminalOutputStream = "combined") => {
		enqueueOutputWork(() => handleOutputLine(line, stream))
	})

	// Start timer to detect if waiting for completion takes too long
	completionTimer = setTimeout(() => {
		if (!completed) {
			telemetryService.captureTerminalHang(TerminalHangStage.WAITING_FOR_COMPLETION, terminalType)
			completionTimer = null
		}
	}, COMPLETION_TIMEOUT_MS)

	process.once("completed", (details?: TerminalCompletionDetails) => {
		completed = true
		completionDetails = details
		// If command completed while command_output ask was pending, release it.
		releaseAnyPendingCommandOutputAsk()
		// Clear the completion timer
		if (completionTimer) {
			clearTimeout(completionTimer)
			completionTimer = null
		}
		if (chunkTimer) {
			clearTimeout(chunkTimer)
			chunkTimer = null
		}
		completionWork = (async () => {
			// EventEmitter does not await async line listeners. Drain the explicit
			// queue before flushing/finalizing so the result cannot lose tail output.
			await outputWork
			if (chunkTimer) {
				clearTimeout(chunkTimer)
				chunkTimer = null
			}
			if (outputBuffer.length > 0) {
				await flushBuffer(true)
			}
			// Finalize any partial say output: persist the final accumulated output
			if (partialSayOutputTs !== undefined) {
				const finalOutput = partialSayLines.join("\n")
				await say("command_output", finalOutput, undefined, undefined, false, partialSayOutputTs)
			}
		})()
		void completionWork.catch((error) => {
			if (error instanceof Error && error.message === "Dline instance aborted") {
				Logger.debug(`[CommandOrchestrator] Terminal output finalization stopped after task abort: ${error.message}`)
				return
			}
			Logger.error(`[CommandOrchestrator] Failed to finalize terminal output: ${error}`)
		})
	})
	process.once("error", () => {
		releaseAnyPendingCommandOutputAsk()
	})

	process.once("no_shell_integration", async () => {
		if (showShellIntegrationSuggestion) {
			await say("shell_integration_warning_with_suggestion")
		} else {
			await say("shell_integration_warning")
		}
	})

	const startedAt = configuredStartedAt ?? (process.started ? await process.started : Date.now())
	const hasFiniteTimeout = timeoutSeconds !== undefined && timeoutSeconds > 0
	const deadlineAt = configuredDeadlineAt ?? (hasFiniteTimeout ? startedAt + timeoutSeconds * 1000 : undefined)
	commandTiming = { startedAt, deadlineAt }

	if (startInBackground && onProceedWhileRunning && !didCancelViaUi) {
		const result = await transitionToBackground("explicit", true)
		if (result) {
			return result
		}
	}

	// Wait for completion, the automatic handoff, the one absolute kill deadline,
	// or an external request to move a synchronous command to the background.
	if (!didCancelViaUi) {
		const handoffMs = handoffSeconds * 1000
		const canAutoHandoff = Boolean(!synchronous && onProceedWhileRunning)
		const canManualHandoff = Boolean(synchronous && onProceedWhileRunning && onHandoffAvailable && handoffRequest)
		if (!hasFiniteTimeout && !canAutoHandoff && !canManualHandoff) {
			// Backward-compatible fallback for direct orchestrator callers.
			await process
		} else {
			type ExecutionBoundary = "completed" | "handoff" | "timeout"
			let handoffTimer: NodeJS.Timeout | undefined
			let handoffAvailableTimer: NodeJS.Timeout | undefined
			let deadlineTimer: NodeJS.Timeout | undefined
			const boundaries: Promise<ExecutionBoundary>[] = [process.then(() => "completed" as const)]

			if (canAutoHandoff) {
				boundaries.push(
					new Promise((resolve) => {
						handoffTimer = setTimeout(() => resolve("handoff"), Math.max(0, startedAt + handoffMs - Date.now()))
					}),
				)
			} else if (canManualHandoff) {
				// Synchronous commands stay in the foreground; once the handoff wait
				// elapsed, publish the footer handoff action and wait for its request.
				handoffAvailableTimer = setTimeout(() => onHandoffAvailable?.(), Math.max(0, startedAt + handoffMs - Date.now()))
				if (handoffRequest) {
					boundaries.push(handoffRequest.promise.then(() => "handoff" as const))
				}
			}
			if (deadlineAt !== undefined) {
				boundaries.push(
					new Promise((resolve) => {
						deadlineTimer = setTimeout(() => resolve("timeout"), Math.max(0, deadlineAt - Date.now()))
					}),
				)
			}

			try {
				const boundary = await Promise.race(boundaries)
				if (boundary === "handoff") {
					const result = await transitionToBackground(canAutoHandoff ? "automatic" : "user", true)
					if (result) return result
				}

				if (boundary === "timeout") {
					didContinue = true
					releaseAnyPendingCommandOutputAsk()
					if (chunkTimer) {
						clearTimeout(chunkTimer)
						chunkTimer = null
					}
					if (completionTimer) {
						clearTimeout(completionTimer)
						completionTimer = null
					}
					onTimeout?.()
					if (process.terminate) {
						await Promise.resolve(process.terminate())
					}
					await drainOutputQueue()
					await clearCommandState(process.getCompletionDetails?.(), true)
					await finishFileBased()
					const currentOutput = formatOutput(output)
					const logFilePath = largeOutputLogPath ?? undefined
					return {
						userRejected: false,
						result: appendCommandLogPath(
							`Command reached its ${timeoutSeconds}-second timeout and was terminated.${
								currentOutput.length > 0 ? `\nOutput captured before termination:\n${currentOutput}` : ""
							}`,
							logFilePath,
						),
						completed: false,
						timedOut: true,
						...splitTerminalOutput(output),
						...process.getCompletionDetails?.(),
						logFilePath,
					}
				}
			} finally {
				if (handoffTimer) clearTimeout(handoffTimer)
				if (handoffAvailableTimer) clearTimeout(handoffAvailableTimer)
				if (deadlineTimer) clearTimeout(deadlineTimer)
			}
		}
	}

	await outputWork
	if (completed) {
		await completionWork
	}

	// Check if we returned early due to background tracking
	// This happens when user clicks "Proceed While Running" with background tracking enabled
	if (backgroundTrackingResult) {
		// Clean up file-based logging if active before returning
		await finishFileBased()
		return backgroundTrackingResult
	}

	// Clear timer if process completes normally
	if (completionTimer) {
		clearTimeout(completionTimer)
		completionTimer = null
	}

	// Clean up file-based logging if active
	await finishFileBased()

	// Build result based on whether we used file-based logging
	let result: string
	let resultOutput: TerminalOutputLine[]

	if (isWritingToFile) {
		// Build summary from first and last lines
		const skippedLines = Math.max(0, totalLineCount - firstLines.length - lastLines.length)
		resultOutput = [...firstLines, ...lastLines]
		const summaryNotice = `... (${skippedLines} lines written to ${largeOutputLogPath}) ...`
		result = [formatOutput(resultOutput), summaryNotice].filter(Boolean).join("\n\n")
	} else {
		result = formatOutput(output)
		resultOutput = output
	}
	const resultLines = splitTerminalOutput(resultOutput)

	if (didCancelViaUi) {
		const logFilePath = largeOutputLogPath ?? undefined
		return {
			userRejected: true,
			result: appendCommandLogPath(
				formatResponse.toolResult(
					`Command cancelled. ${result.length > 0 ? `\nOutput captured before cancellation:\n${result}` : ""}`,
				),
				logFilePath,
			),
			completed: false,
			...resultLines,
			logFilePath,
			exitCode: completionDetails?.exitCode,
			signal: completionDetails?.signal,
		}
	}

	if (userFeedback) {
		await say("user_feedback", userFeedback.text, userFeedback.images, userFeedback.files)

		let fileContentString = ""
		if (userFeedback.files && userFeedback.files.length > 0) {
			fileContentString = await processFilesIntoText(userFeedback.files)
		}

		return {
			userRejected: true,
			result: formatResponse.toolResult(
				`Command is still running in the user's terminal.${
					result.length > 0 ? `\nHere's the output so far:\n${result}` : ""
				}\n\nThe user provided the following feedback:\n<feedback>\n${userFeedback.text}\n</feedback>`,
				userFeedback.images,
				fileContentString,
			),
			completed: false,
			...resultLines,
			logFilePath: largeOutputLogPath || undefined,
			exitCode: completionDetails?.exitCode,
			signal: completionDetails?.signal,
		}
	}

	if (completed) {
		const exitCode = completionDetails?.exitCode
		const signal = completionDetails?.signal
		const hasExitCode = typeof exitCode === "number"
		const logFileMsg = largeOutputLogPath ? `\nFull output saved to: ${largeOutputLogPath}` : ""
		const statusMessage = isCommandCompletionSuccessful(completionDetails)
			? "Command executed successfully (exit code 0)."
			: signal
				? `Command terminated by signal ${signal}.`
				: hasExitCode
					? `Command failed with exit code ${exitCode}.`
					: "Command completion could not be verified because no exit code was reported."

		return {
			userRejected: false,
			result: `${statusMessage}${result.length > 0 ? `\n${result}` : ""}${logFileMsg}`,
			completed: true,
			...resultLines,
			logFilePath: largeOutputLogPath || undefined,
			exitCode,
			signal,
		}
	}
	const logFileMsg = largeOutputLogPath ? `\nFull output saved to: ${largeOutputLogPath}` : ""
	return {
		userRejected: false,
		result: `Command is still running in the user's terminal.${
			result.length > 0 ? `\nHere's the output so far:\n${result}` : ""
		}${logFileMsg}\n\nYou will be updated on the terminal status and new output in the future.`,
		completed: false,
		...resultLines,
		logFilePath: largeOutputLogPath || undefined,
		exitCode: completionDetails?.exitCode,
		signal: completionDetails?.signal,
	}
}
