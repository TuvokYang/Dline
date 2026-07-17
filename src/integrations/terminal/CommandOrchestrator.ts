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
import { ClineTempManager } from "@services/temp"
import { COMMAND_CANCEL_TOKEN } from "@shared/ExtensionMessage"
import * as fs from "fs"
import { Logger } from "@/shared/services/Logger"
import {
	BUFFER_STUCK_TIMEOUT_MS,
	CHUNK_BYTE_SIZE,
	CHUNK_DEBOUNCE_MS,
	CHUNK_LINE_COUNT,
	COMPLETION_TIMEOUT_MS,
	MAX_BYTES_BEFORE_FILE,
	MAX_LINES_BEFORE_FILE,
	SUMMARY_LINES_TO_KEEP,
} from "./constants"
import type {
	CommandExecutorCallbacks,
	ITerminalManager,
	OrchestrationOptions,
	OrchestrationResult,
	TerminalCompletionDetails,
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
		onOutputLine,
		showShellIntegrationSuggestion,
		onProceedWhileRunning,
		terminalType = "vscode",
		suppressUserInteraction = false,
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

	const clearCommandState = async (exitCode?: number | null) => {
		callbacks.updateBackgroundCommandState(false)

		// Do not overwrite skipped or cancelled command state
		if (didCancelViaUi) {
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
					await callbacks.updateClineMessage(idx, {
						commandStatus: "completed",
						exitCode: exitCode ?? undefined,
					})
				} catch (e) {
					Logger.error(`[clearCommandState] updateClineMessage failed: ${e}`)
				}
			}
		}
	}

	process.once("completed", (details) => {
		clearCommandState(details?.exitCode)
	})
	process.once("error", () => {
		clearCommandState(-1) // mark as failed
	})
	process.catch(() => {
		clearCommandState(-1)
	})

	let userFeedback: { text?: string; images?: string[]; files?: string[] } | undefined
	let didContinue = false
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

					// Notify caller to start background command tracking
					// Pass existing output lines so they can be written to the log file
					// and send log file path to UI if tracking was started
					if (onProceedWhileRunning) {
						const trackingResult = onProceedWhileRunning(outputLines)

						// Clear timers first
						if (chunkTimer) {
							clearTimeout(chunkTimer)
							chunkTimer = null
						}
						if (completionTimer) {
							clearTimeout(completionTimer)
							completionTimer = null
						}

						// Set early return result BEFORE resuming the process
						// This prevents the orchestrator's listener from processing new lines
						const result = terminalManager.processOutput(outputLines)
						const logMsg = trackingResult?.logFilePath ? `Log file: ${trackingResult.logFilePath}\n` : ""
						const outputMsg = result.length > 0 ? `Output so far:\n${result}` : ""

						backgroundTrackingResult = {
							userRejected: false,
							result: `Command is running in the background. You can proceed with other tasks.\n${logMsg}${outputMsg}`,
							completed: false,
							outputLines,
						}

						// Send log file message to UI BEFORE resuming the process
						// This ensures the message appears before any new output lines
						if (trackingResult?.logFilePath) {
							await say("command_output", `\n📋 Output is being logged to: ${trackingResult.logFilePath}`)
						}

						// Now resume the process - any new lines will be handled by the background tracker
						process.continue()
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
	let totalOutputBytes = 0
	let totalLineCount = 0
	let firstLines: string[] = [] // Keep first N lines for summary
	let lastLines: string[] = [] // Keep last N lines for summary (circular buffer)

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

		// Set up file logging using ClineTempManager for proper cleanup
		largeOutputLogPath = ClineTempManager.createTempFilePath("large-output")
		largeOutputLogStream = fs.createWriteStream(largeOutputLogPath, { flags: "a" })

		// Write all existing lines to file in a single batch to reduce I/O overhead
		if (outputLines.length > 0) {
			largeOutputLogStream.write(`${outputLines.join("\n")}\n`)
		}

		// Keep first N lines for summary
		firstLines = outputLines.slice(0, SUMMARY_LINES_TO_KEEP)

		// Keep last N lines for summary (will be updated as more lines come in)
		lastLines = outputLines.slice(-SUMMARY_LINES_TO_KEEP)

		// FINALLY: Notify user (now this will appear at the end after all buffered output)
		await say(
			"command_output",
			`\n📋 Output is large (${outputLines.length} lines, ${Math.round(totalOutputBytes / 1024)}KB). Writing to: ${largeOutputLogPath}`,
		)
	}

	/**
	 * Clean up file-based logging resources.
	 */
	const cleanupFileBased = () => {
		if (largeOutputLogStream) {
			largeOutputLogStream.end()
			largeOutputLogStream = null
		}
	}

	const outputLines: string[] = []
	const handleOutputLine = async (line: string): Promise<void> => {
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
		if (!isWritingToFile && (outputLines.length >= MAX_LINES_BEFORE_FILE || totalOutputBytes >= MAX_BYTES_BEFORE_FILE)) {
			await switchToFileBased()
		}

		if (isWritingToFile) {
			// Write to file instead of keeping in memory
			if (largeOutputLogStream) {
				largeOutputLogStream.write(`${line}\n`)
			}

			// Update last lines circular buffer for summary
			lastLines.push(line)
			if (lastLines.length > SUMMARY_LINES_TO_KEEP) {
				lastLines.shift()
			}
		} else {
			// Normal behavior - keep in memory
			outputLines.push(line)
		}

		// Notify caller about output line (for background command tracking)
		if (onOutputLine) {
			onOutputLine(line)
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
			// After "Proceed While Running" (without background tracking): stream output via partial updates
			// But throttle if we're in file mode to avoid flooding UI
			if (!isWritingToFile) {
				partialSayLines.push(line)
				const combined = partialSayLines.join("\n")
				if (partialSayOutputTs === undefined) {
					partialSayOutputTs = await say("command_output", combined, undefined, undefined, true, undefined, cmdTs)
				} else {
					await say("command_output", combined, undefined, undefined, true, partialSayOutputTs)
				}
			}
		}
	}
	process.on("line", (line: string) => {
		enqueueOutputWork(() => handleOutputLine(line))
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
			if (!didContinue && outputBuffer.length > 0) {
				await flushBuffer(true)
			}
			// Finalize any partial say output: persist the final accumulated output
			if (partialSayOutputTs !== undefined) {
				const finalOutput = partialSayLines.join("\n")
				await say("command_output", finalOutput, undefined, undefined, false, partialSayOutputTs)
			}
		})()
		void completionWork.catch((error) => {
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

	// Handle timeout if specified, or wait for process to complete
	if (!didCancelViaUi) {
		if (timeoutSeconds) {
			let timeoutId: NodeJS.Timeout | undefined
			const timeoutPromise = new Promise<never>((_, reject) => {
				timeoutId = setTimeout(() => {
					reject(new Error("COMMAND_TIMEOUT"))
				}, timeoutSeconds * 1000)
			})

			try {
				await Promise.race([process, timeoutPromise])
			} catch (error: unknown) {
				if (error instanceof Error && error.message === "COMMAND_TIMEOUT") {
					// Timeout triggers "Proceed While Running" behavior
					didContinue = true
					// Release any pending command_output ask before transitioning state.
					releaseAnyPendingCommandOutputAsk()

					// Clear all our timers first
					if (chunkTimer) {
						clearTimeout(chunkTimer)
						chunkTimer = null
					}
					if (completionTimer) {
						clearTimeout(completionTimer)
						completionTimer = null
					}
					await outputWork

					// If background tracking is available (standalone mode only), use it
					// This writes output to a log file and detaches the command
					if (onProceedWhileRunning) {
						const trackingResult = onProceedWhileRunning(outputLines)

						// Set early return result BEFORE resuming the process
						// This prevents the orchestrator's listener from processing new lines
						const result = terminalManager.processOutput(outputLines)
						const logMsg = trackingResult?.logFilePath ? `Log file: ${trackingResult.logFilePath}\n` : ""
						const outputMsg = result.length > 0 ? `Output so far:\n${result}` : ""

						backgroundTrackingResult = {
							userRejected: false,
							result: `Command timed out after ${timeoutSeconds} seconds. Running in background.\n${logMsg}${outputMsg}`,
							completed: false,
							outputLines,
						}

						// Send log file message to UI BEFORE resuming the process
						if (trackingResult?.logFilePath) {
							await say(
								"command_output",
								`\n⏱️ Command timed out. Output is being logged to: ${trackingResult.logFilePath}`,
							)
						}

						// Now resume the process - any new lines will be handled by the background tracker
						process.continue()
						// Clean up file-based logging if active before returning
						cleanupFileBased()
						return backgroundTrackingResult
					}

					// VSCode terminal mode: no background tracking available
					// Just continue the process and return timeout result
					process.continue()

					// Drain output already emitted before returning the timeout result.
					await outputWork
					const result = terminalManager.processOutput(outputLines)

					return {
						userRejected: false,
						result: `Command execution timed out after ${timeoutSeconds} seconds. ${result.length > 0 ? `\nOutput so far:\n${result}` : ""}`,
						completed: false,
						outputLines,
					}
				}

				// Re-throw other errors
				throw error
			} finally {
				if (timeoutId) {
					clearTimeout(timeoutId)
				}
			}
		} else {
			// Backward-compatible fallback for direct orchestrator callers.
			await process
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
		cleanupFileBased()
		return backgroundTrackingResult
	}

	// Clear timer if process completes normally
	if (completionTimer) {
		clearTimeout(completionTimer)
		completionTimer = null
	}

	// Clean up file-based logging if active
	cleanupFileBased()

	// Build result based on whether we used file-based logging
	let result: string
	let resultOutputLines: string[]

	if (isWritingToFile) {
		// Build summary from first and last lines
		const skippedLines = totalLineCount - firstLines.length - lastLines.length
		const summaryLines = [...firstLines, `\n... (${skippedLines} lines written to ${largeOutputLogPath}) ...\n`, ...lastLines]
		result = terminalManager.processOutput(summaryLines)
		resultOutputLines = summaryLines
	} else {
		result = terminalManager.processOutput(outputLines)
		resultOutputLines = outputLines
	}

	if (didCancelViaUi) {
		return {
			userRejected: true,
			result: formatResponse.toolResult(
				`Command cancelled. ${result.length > 0 ? `\nOutput captured before cancellation:\n${result}` : ""}`,
			),
			completed: false,
			outputLines: resultOutputLines,
			logFilePath: largeOutputLogPath || undefined,
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
			outputLines: resultOutputLines,
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
		const statusMessage = hasExitCode
			? exitCode === 0
				? "Command executed successfully (exit code 0)."
				: `Command failed with exit code ${exitCode}.`
			: signal
				? `Command terminated by signal ${signal}.`
				: "Command executed."

		return {
			userRejected: false,
			result: `${statusMessage}${result.length > 0 ? `\nOutput:\n${result}` : ""}${logFileMsg}`,
			completed: true,
			outputLines: resultOutputLines,
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
		outputLines: resultOutputLines,
		logFilePath: largeOutputLogPath || undefined,
		exitCode: completionDetails?.exitCode,
		signal: completionDetails?.signal,
	}
}
