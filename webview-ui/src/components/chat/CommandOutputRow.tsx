import { COMMAND_OUTPUT_STRING, COMMAND_REQ_APP_STRING } from "@shared/combineCommandSequences"
import { ClineMessage } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/cline/common"
import { TerminalIcon } from "lucide-react"
import { memo, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { FileServiceClient } from "@/services/grpc-client"
import CodeBlock from "../common/CodeBlock"
import ExpandHandle from "./ExpandHandle"

export const CommandOutputContent = memo(
	({
		output,
		isOutputFullyExpanded,
		onToggle,
		isContainerExpanded,
	}: {
		output: string
		isOutputFullyExpanded: boolean
		onToggle: () => void
		isContainerExpanded: boolean
	}) => {
		const outputLines = output.split("\n")
		const lineCount = outputLines.length
		const shouldAutoShow = lineCount <= 5
		const outputRef = useRef<HTMLDivElement>(null)

		useEffect(() => {
			if (!isOutputFullyExpanded && outputRef.current) {
				outputRef.current.scrollTop = outputRef.current.scrollHeight
				setTimeout(() => {
					if (outputRef.current) {
						outputRef.current.scrollTop = outputRef.current.scrollHeight
					}
				}, 50)
			}
		}, [output, isOutputFullyExpanded])

		if (!isContainerExpanded) {
			return null
		}

		const logFilePathMatch = output.match(/📋 Output is being logged to: ([^\n]+)/)
		const logFilePath = logFilePathMatch ? logFilePathMatch[1].trim() : null

		const renderOutput = () => {
			if (!logFilePath) {
				return <CodeBlock forceWrap={true} source={`${"```"}shell\n${output}\n${"```"}`} />
			}
			const logPathLineStart = output.indexOf("📋 Output is being logged to:")
			const logPathLineEnd = output.indexOf("\n", logPathLineStart)
			const beforeLogPath = output.substring(0, logPathLineStart)
			const afterLogPath = logPathLineEnd !== -1 ? output.substring(logPathLineEnd) : ""
			const fileName = logFilePath.split("/").pop() || logFilePath
			return (
				<div className="border border-editor-group-border rounded-sm">
					{beforeLogPath && <CodeBlock forceWrap={true} source={`${"```"}shell\n${beforeLogPath}\n${"```"}`} />}
					<div
						className="flex flex-wrap items-center gap-1.5 px-3 py-2 mx-2 my-1.5 rounded-sm bg-banner-background cursor-pointer hover:brightness-110 transition-colors"
						onClick={() => {
							FileServiceClient.openFile(StringRequest.create({ value: logFilePath })).catch((err) =>
								console.error("Failed to open log file:", err),
							)
						}}
						title={`Click to open: ${logFilePath}`}>
						<span className="shrink-0">📋 Output is being logged to:</span>
						<span className="text-vscode-textLink-foreground underline break-all">{fileName}</span>
					</div>
					{afterLogPath && <CodeBlock forceWrap={true} source={`${"```"}shell\n${afterLogPath}\n${"```"}`} />}
				</div>
			)
		}

		return (
			<div
				className={cn("w-full relative pb-0 overflow-visible border-t border-editor-group-border bg-code rounded-sm", {
					"rounded-b-none": lineCount > 5,
				})}>
				<div
					className={cn("text-white scroll-smooth bg-code overflow-y-auto", {
						"max-h-[75px]": !shouldAutoShow && !isOutputFullyExpanded,
						"max-h-[200px]": !shouldAutoShow && isOutputFullyExpanded,
						"overflow-y-visible": shouldAutoShow,
					})}
					ref={outputRef}>
					<div className="bg-code">{renderOutput()}</div>
				</div>
				{lineCount > 5 && <ExpandHandle isExpanded={isOutputFullyExpanded} onToggle={onToggle} />}
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
		isBackgroundExec = false,
		onCancelCommand,
		icon,
		title,
		isOutputFullyExpanded,
		setIsOutputFullyExpanded,
	}: {
		message: ClineMessage
		exitCode?: number | null
		isCommandExecuting?: boolean
		isCommandPending?: boolean
		isCommandCompleted?: boolean
		isBackgroundExec?: boolean
		isLast?: boolean
		onCancelCommand?: () => void
		icon?: JSX.Element | null
		title?: JSX.Element | null
		isOutputFullyExpanded: boolean
		setIsOutputFullyExpanded: (expanded: boolean) => void
	}) => {
		const exitCode = message.exitCode
		const colors = getStatusColor(isCommandExecuting, isCommandPending, isCommandCompleted, exitCode)
		const statusText = getCommandStatusText(isCommandExecuting, isCommandPending, isCommandCompleted, exitCode)
		const isActive = isCommandExecuting || isCommandPending
		const [isCollapsed, setIsCollapsed] = useState(false)

		// Auto-collapse when command completes, expand when running/pending
		useEffect(() => {
			if (isCommandCompleted && !isActive) {
				setIsCollapsed(true)
			} else if (isActive) {
				setIsCollapsed(false)
			}
		}, [isCommandCompleted, isActive])

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
					.split("")
					.map((char) => {
						switch (char) {
							case "\t":
								return "→   "
							case "\b":
								return "⌫"
							case "\f":
								return "⏏"
							case "\v":
								return "⇳"
							default:
								return char
						}
					})
					.join(""),
			}
		}

		const { command: rawCommand, output } = splitMessage(message.text || "")

		const requestsApproval = rawCommand.endsWith(COMMAND_REQ_APP_STRING)
		const command = requestsApproval ? rawCommand.slice(0, -COMMAND_REQ_APP_STRING.length) : rawCommand
		const showCancelButton = isActive && typeof onCancelCommand === "function" && isBackgroundExec

		const commandHeader = (
			<div className="flex items-center gap-2.5 mb-3">
				{icon}
				{title}
			</div>
		)

		// Collapsed bar with colored background by exitCode
		if (isCollapsed && isCommandCompleted) {
			return (
				<>
					{commandHeader}
					<button
						className={cn(
							"w-full flex items-center gap-2 p-2 rounded-xs cursor-pointer transition-colors border",
							{
								"bg-success/10 border-success/30": exitCode === 0,
								"bg-error/10 border-error/30": exitCode != null && exitCode !== 0,
								"bg-description/10 border-description/30": exitCode == null,
							},
						)}
						onClick={() => setIsCollapsed(false)}
						type="button">
						<TerminalIcon className={cn("size-2 shrink-0", colors.text)} />
						<span className="text-sm text-left truncate flex-1 opacity-70">{command}</span>
					</button>
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
									"cursor-pointer": isCommandCompleted,
								},
							)}
							onClick={() => {
								if (isCommandCompleted) setIsCollapsed(true)
							}}>
							<div className="flex items-center gap-2 flex-1 min-w-0">
								<TerminalIcon className={cn("size-2 shrink-0", colors.text)} />
								<span className={cn("font-medium text-base shrink-0", colors.text)}>{statusText}</span>
							</div>
							<div className="flex items-center gap-2 shrink-0">
								{showCancelButton && (
									<Button
										onClick={(e) => {
											e.stopPropagation()
											if (isBackgroundExec) {
												onCancelCommand?.()
											} else {
												alert(
													"This command is running in the VSCode terminal. You can manually stop it using Ctrl+C in the terminal, or switch to Background Execution mode in settings for cancellable commands.",
												)
											}
										}}
										size="sm"
										variant="secondary">
										{isBackgroundExec ? "cancel" : "stop"}
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

					{output.length > 0 && (
						<CommandOutputContent
							isContainerExpanded={true}
							isOutputFullyExpanded={isOutputFullyExpanded}
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
	completed: "Completed",
	skipped: "Skipped",
}

function getCommandStatusText(isExecuting: boolean, isPending: boolean, isCompleted: boolean, exitCode?: number | null): string {
	if (isExecuting) return CommandStatusMap.running
	if (isPending) return CommandStatusMap.pending
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
	exitCode?: number | null,
): { dot: string; text: string } {
	if (isExecuting) return { dot: "bg-success animate-pulse", text: "text-success" }
	if (isPending) return { dot: "bg-editor-warning-foreground", text: "text-editor-warning-foreground" }
	if (isCompleted) {
		if (exitCode === 0) return { dot: "bg-success", text: "text-success" }
		if (exitCode != null) return { dot: "bg-error", text: "text-error" }
	}
	return { dot: "bg-description", text: "text-description" }
}
