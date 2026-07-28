import { COMMAND_OUTPUT_STRING, COMMAND_REQ_APP_STRING } from "@shared/combineCommandSequences"
import { ClineMessage } from "@shared/ExtensionMessage"
import AnsiUp from "ansi-to-html"
import DOMPurify from "dompurify"
import { TerminalIcon } from "lucide-react"
import { memo, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import CodeBlock from "../common/CodeBlock"
import { OpenFilePathLink } from "../common/OpenFilePathLink"
import ExpandHandle from "./ExpandHandle"

// ANSI color converter instance (shared across renders for performance)
const ansiUp = new AnsiUp()

// ANSI escape sequence regex pattern for detection
const ANSI_ESCAPE_PATTERN = /\x1b\[[\d;]*[A-Za-z]/

/**
 * Check if a string contains ANSI escape sequences.
 */
function hasAnsiSequences(text: string): boolean {
	return ANSI_ESCAPE_PATTERN.test(text)
}

export const CommandOutputContent = memo(
	({
		output,
		isOutputFullyExpanded,
		onToggle,
		isContainerExpanded,
		isCommandActive = false,
		logPath,
	}: {
		output: string
		isOutputFullyExpanded: boolean
		onToggle: () => void
		isContainerExpanded: boolean
		isCommandActive?: boolean
		logPath?: string
	}) => {
		const outputLines = output.split("\n")
		const lineCount = outputLines.length
		const shouldAutoShow = lineCount <= 5
		const outputRef = useRef<HTMLDivElement>(null)

		useEffect(() => {
			// Auto-scroll to bottom when streaming output grows
			if (outputRef.current) {
				outputRef.current.scrollTop = outputRef.current.scrollHeight
				setTimeout(() => {
					if (outputRef.current) {
						outputRef.current.scrollTop = outputRef.current.scrollHeight
					}
				}, 50)
			}
		}, [output])

		if (!isContainerExpanded) {
			return null
		}

		const logPathPattern = /(?:📋 Output is being logged to:|⏱️ Command timed out\. Output is being logged to:)\s*([^\n]+)/
		const logFilePathMatch = output.match(logPathPattern)
		const logFilePath = logPath ?? (logFilePathMatch ? logFilePathMatch[1].trim() : null)
		const logPathLineStart = output.search(
			/(?:📋 Output is being logged to:|⏱️ Command timed out\. Output is being logged to:)/,
		)

		/**
		 * Render ANSI-colored output as sanitized HTML.
		 * Converts ANSI escape sequences to HTML spans with inline styles.
		 */
		const renderAnsiOutput = (text: string) => {
			const rawHtml = ansiUp.toHtml(text)
			const cleanHtml = DOMPurify.sanitize(rawHtml, {
				ALLOWED_TAGS: ["span", "br"],
				ALLOWED_ATTR: ["style"],
			})
			return (
				<pre
					className="text-white p-3 m-0 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all"
					dangerouslySetInnerHTML={{ __html: cleanHtml }}
					style={{ backgroundColor: "var(--vscode-editor-background, #1e1e1e)" }}
				/>
			)
		}

		const renderOutput = () => {
			// If output contains ANSI escape sequences, render with color support
			if (hasAnsiSequences(output)) {
				if (!logFilePath) {
					return renderAnsiOutput(output)
				}
				// Split around log file path and render each segment with ANSI support
				const logPathLineEnd = logPathLineStart >= 0 ? output.indexOf("\n", logPathLineStart) : -1
				const beforeLogPath = logPathLineStart >= 0 ? output.substring(0, logPathLineStart) : output
				const afterLogPath = logPathLineEnd !== -1 ? output.substring(logPathLineEnd) : ""
				return (
					<div className="border border-editor-group-border rounded-sm">
						{beforeLogPath && renderAnsiOutput(beforeLogPath)}
						<div className="px-3 py-2 mx-2 my-1.5 rounded-sm bg-banner-background hover:brightness-110 transition-colors">
							<OpenFilePathLink filePath={logFilePath} label="📋 Output is being logged to:" />
						</div>
						{afterLogPath && renderAnsiOutput(afterLogPath)}
					</div>
				)
			}

			// Fallback: no ANSI sequences, use standard CodeBlock rendering
			if (!logFilePath) {
				return <CodeBlock forceWrap={true} source={`${"```"}shell\n${output}\n${"```"}`} />
			}
			const logPathLineEnd = logPathLineStart >= 0 ? output.indexOf("\n", logPathLineStart) : -1
			const beforeLogPath = logPathLineStart >= 0 ? output.substring(0, logPathLineStart) : output
			const afterLogPath = logPathLineEnd !== -1 ? output.substring(logPathLineEnd) : ""
			return (
				<div className="border border-editor-group-border rounded-sm">
					{beforeLogPath && <CodeBlock forceWrap={true} source={`${"```"}shell\n${beforeLogPath}\n${"```"}`} />}
					<div className="px-3 py-2 mx-2 my-1.5 rounded-sm bg-banner-background hover:brightness-110 transition-colors">
						<OpenFilePathLink filePath={logFilePath} label="📋 Output is being logged to:" />
					</div>
					{afterLogPath && <CodeBlock forceWrap={true} source={`${"```"}shell\n${afterLogPath}\n${"```"}`} />}
				</div>
			)
		}

		// Compute max-height: semi-collapse (20% ≈ 120px) vs expanded (60% ≈ 360px)
		const maxH = shouldAutoShow ? undefined : isOutputFullyExpanded ? "max-h-[360px]" : "max-h-[120px]"

		return (
			<div
				className={cn("w-full relative pb-0 overflow-visible border-t border-editor-group-border bg-code rounded-sm", {
					"rounded-b-none": lineCount > 5 && !shouldAutoShow,
				})}>
				<div
					className={cn("text-white scroll-smooth bg-code overflow-auto", {
						[maxH || ""]: !!maxH,
						"overflow-y-visible": shouldAutoShow,
					})}
					ref={outputRef}>
					<div className="bg-code">{renderOutput()}</div>
				</div>
				{lineCount > 5 && !shouldAutoShow && <ExpandHandle isExpanded={isOutputFullyExpanded} onToggle={onToggle} />}
			</div>
		)
	},
)

CommandOutputContent.displayName = "CommandOutputContent"

export const CommandOutputRow = memo(
	({
		message,
		isCommandExecuting = false,
		isCommandPending = false,
		isCommandCompleted = false,
		isCommandFailed = false,
		isCommandCancelled = false,
		isBackgroundExec = false,
		onCancelCommand,
		icon,
		title,
		isOutputFullyExpanded,
		setIsOutputFullyExpanded,
		isCollapsed,
		onToggleCollapsed,
	}: {
		message: ClineMessage
		exitCode?: number | null
		isCommandExecuting?: boolean
		isCommandPending?: boolean
		isCommandCompleted?: boolean
		isCommandFailed?: boolean
		isCommandCancelled?: boolean
		isBackgroundExec?: boolean
		isLast?: boolean
		onCancelCommand?: () => void
		icon?: JSX.Element | null
		title?: JSX.Element | null
		isOutputFullyExpanded: boolean
		setIsOutputFullyExpanded: (expanded: boolean) => void
		isCollapsed: boolean
		onToggleCollapsed: () => void
	}) => {
		const exitCode = message.exitCode
		const colors = getStatusColor(isCommandExecuting, isCommandPending, isCommandCompleted, isCommandFailed, exitCode)
		const statusText = getCommandStatusText(
			isCommandExecuting,
			isCommandPending,
			isCommandCompleted,
			isCommandFailed,
			isCommandCancelled,
			exitCode,
		)
		const isActive = isCommandExecuting || isCommandPending

		const splitMessage = (text: string) => {
			const outputIndex = text.indexOf(COMMAND_OUTPUT_STRING)
			if (outputIndex === -1) {
				return { command: text, output: "" }
			}
			return {
				command: text.slice(0, outputIndex).trim(),
				output: text
					.slice(outputIndex + COMMAND_OUTPUT_STRING.length)
					.trim()
					.replace(/\x09/g, "→   ")
					.replace(/\x08/g, "⌫")
					.replace(/\x0C/g, "⏏")
					.replace(/\x0B/g, "⇳"),
			}
		}

		const { command: rawCommand, output } = splitMessage(message.text || "")

		const requestsApproval = rawCommand.endsWith(COMMAND_REQ_APP_STRING)
		const command = requestsApproval ? rawCommand.slice(0, -COMMAND_REQ_APP_STRING.length) : rawCommand
		const showCancelButton = isActive && typeof onCancelCommand === "function"

		const commandHeader = (
			<div className="flex items-center gap-2.5 mb-3">
				{icon}
				{title}
			</div>
		)

		// Collapsed bar — shows compact state for both completed and running commands
		if (isCollapsed) {
			return (
				<>
					{commandHeader}
					<div
						className={cn("w-full flex items-center gap-2 p-2 rounded-xs transition-colors border", {
							"bg-success/10 border-success/30": exitCode === 0,
							"bg-error/10 border-error/30": exitCode != null && exitCode !== 0,
							"bg-editor-warning-foreground/10 border-editor-warning-foreground/30": isCommandPending,
							"bg-description/10 border-description/30": exitCode == null && !isCommandPending,
							"bg-success/5 border-success/20": isCommandExecuting,
						})}>
						<button
							className="flex min-w-0 flex-1 items-center gap-2 cursor-pointer"
							onClick={onToggleCollapsed}
							type="button">
							<TerminalIcon className={cn("size-2 shrink-0", isActive && "animate-pulse", colors.text)} />
							<span className="text-sm text-left truncate flex-1 opacity-70">{command}</span>
						</button>
						{showCancelButton && (
							<Button className="border" onClick={onCancelCommand} size="sm" variant="danger">
								Cancel
							</Button>
						)}
					</div>
				</>
			)
		}

		return (
			<>
				{commandHeader}
				<div
					className="bg-code rounded-sm border border-editor-group-border"
					style={{ transition: "all 0.3s ease-in-out" }}>
					{command && (
						<div
							className={cn(
								"bg-code flex items-center justify-between px-2 py-2.5 border-b border-editor-group-border rounded-sm rounded-b-none overflow-hidden",
								{
									"cursor-pointer": true,
								},
							)}
							onClick={onToggleCollapsed}>
							<div className="flex items-center gap-2 flex-1 min-w-0">
								<TerminalIcon className={cn("size-2 shrink-0", colors.text)} />
								<span className={cn("font-medium text-base shrink-0", colors.text)}>{statusText}</span>
							</div>
							<div className="flex items-center gap-2 shrink-0">
								{showCancelButton && (
									<Button
										className="border"
										onClick={(e) => {
											e.stopPropagation()
											onCancelCommand?.()
										}}
										size="sm"
										variant="danger">
										Cancel
									</Button>
								)}
							</div>
						</div>
					)}

					<div
						className={cn("opacity-60 text-sm", {
							"bg-success/5": exitCode === 0,
							"bg-error/10": exitCode != null && exitCode !== 0,
							"bg-code": exitCode == null || exitCode === undefined,
						})}>
						<CodeBlock forceWrap={true} source={`${"```"}shell\n${command}\n${"```"}`} />
					</div>

					{(output.length > 0 || message.logPath) && (
						<CommandOutputContent
							isCommandActive={isActive}
							isContainerExpanded={true}
							isOutputFullyExpanded={isOutputFullyExpanded}
							logPath={message.logPath}
							onToggle={() => setIsOutputFullyExpanded(!isOutputFullyExpanded)}
							output={output}
						/>
					)}
				</div>
				{requestsApproval && (
					<div className="flex items-center gap-2.5 p-2 text-[12px] text-editor-warning-foreground">
						<i className="codicon codicon-warning" />
						<span>The model has determined this command requires explicit approval.</span>
					</div>
				)}
			</>
		)
	},
)

CommandOutputRow.displayName = "CommandOutputRow"

const CommandStatusMap = {
	running: "Running",
	pending: "Pending",
	success: "Success",
	failed: "Failed",
	cancelled: "Cancelled",
	completed: "Completed",
	skipped: "Skipped",
}

function getCommandStatusText(
	isExecuting: boolean,
	isPending: boolean,
	isCompleted: boolean,
	isFailed: boolean,
	isCancelled: boolean,
	exitCode?: number | null,
): string {
	if (isExecuting) return CommandStatusMap.running
	if (isPending) return CommandStatusMap.pending
	if (isFailed) return CommandStatusMap.failed
	if (isCancelled) return CommandStatusMap.cancelled
	if (isCompleted) {
		if (exitCode === 0) return CommandStatusMap.success
		if (exitCode != null) return CommandStatusMap.failed
		return CommandStatusMap.completed
	}
	return CommandStatusMap.skipped
}

function getStatusColor(
	isExecuting: boolean,
	isPending: boolean,
	isCompleted: boolean,
	isFailed: boolean,
	exitCode?: number | null,
): { dot: string; text: string } {
	if (isExecuting) return { dot: "bg-info animate-pulse", text: "text-info" }
	if (isPending) return { dot: "bg-editor-warning-foreground", text: "text-editor-warning-foreground" }
	if (isFailed) return { dot: "bg-error", text: "text-error" }
	if (isCompleted) {
		if (exitCode === 0) return { dot: "bg-success", text: "text-success" }
		if (exitCode != null) return { dot: "bg-error", text: "text-error" }
	}
	return { dot: "bg-description", text: "text-description" }
}
