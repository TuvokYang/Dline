import { Anthropic } from "@anthropic-ai/sdk"
import * as diff from "diff"
import * as path from "path"
import type { Mode } from "@shared/storage/types"
import type { FileInfo } from "@services/glob/list-files"
import { ClineIgnoreController, LOCK_TEXT_SYMBOL } from "../ignore/ClineIgnoreController"
import { getPrompt } from "./i18n"

const CONTEXT_WINDOW_WARNING_THRESHOLD_PERCENT = 50

export const formatResponse = {
	duplicateFileReadNotice: () => getPrompt("responses", "duplicateFileReadNotice"),

	contextTruncationNotice: () => getPrompt("responses", "contextTruncationNotice"),

	processFirstUserMessageForTruncation: () => getPrompt("responses", "continueAssisting"),

	condense: () => getPrompt("responses", "condense"),

	toolDenied: () => getPrompt("responses", "toolDenied"),

	toolError: (error?: string) => getPrompt("responses", "toolError", { error: error ?? "" }),

	clineIgnoreError: (pathStr: string) => getPrompt("responses", "clineIgnoreError", { path: pathStr }),

	permissionDeniedError: (reason: string) => getPrompt("responses", "permissionDeniedError", { reason }),

	noToolsUsed: (usingNativeToolCalls: boolean) =>
		getPrompt("responses", "noToolsUsed", {
			toolReminder: usingNativeToolCalls ? "" : getPrompt("responses", "toolUseInstructionsReminder"),
		}),

	tooManyMistakes: (feedback?: string) => getPrompt("responses", "tooManyMistakes", { feedback: feedback ?? "" }),

	missingToolParameterError: (paramName: string) =>
		getPrompt("responses", "missingToolParameterError", {
			paramName,
			toolReminder: getPrompt("responses", "toolUseInstructionsReminder"),
		}),

	/**
	 * Specialized error for write_to_file when the 'content' parameter is missing.
	 * Provides progressive guidance based on how many times this has happened consecutively,
	 * and includes token budget awareness to help the model understand output constraints.
	 */
	writeToFileMissingContentError: (relPath: string, consecutiveFailures: number, contextUsagePercent?: number): string => {
		const baseError = getPrompt("responses", "writeToFileBaseError", { relPath })

		const contextWarning =
			contextUsagePercent !== undefined && contextUsagePercent > CONTEXT_WINDOW_WARNING_THRESHOLD_PERCENT
				? `\n\n${getPrompt("responses", "writeToFileContextWarning", { contextUsagePercent })}`
				: ""

		if (consecutiveFailures >= 3) {
			// After 3+ failures, be very directive — stop trying write_to_file entirely
			return `${baseError}${contextWarning}\n\n${getPrompt("responses", "writeToFileCriticalFail", { consecutiveFailures })}`
		}
		if (consecutiveFailures >= 2) {
			// After 2 failures, strongly suggest alternative approaches
			const ordinalSuffix = consecutiveFailures === 2 ? "nd" : "rd"
			return `${baseError}${contextWarning}\n\n${getPrompt("responses", "writeToFileSecondFail", { consecutiveFailures, ordinalSuffix })}`
		}
		// First failure — provide helpful guidance
		return `${baseError}${contextWarning}\n\n${getPrompt("responses", "writeToFileFirstFail", {
			toolReminder: getPrompt("responses", "toolUseInstructionsReminder"),
		})}`
	},

	replaceInFileMissingDiffError: (relPath: string): string =>
		getPrompt("responses", "replaceInFileMissingDiffError", { relPath }),

	executeCommandMissingCommandError: (): string => getPrompt("responses", "executeCommandMissingCommandError"),

	invalidMcpToolArgumentError: (serverName: string, toolName: string) =>
		getPrompt("responses", "invalidMcpToolArgumentError", { serverName, toolName }),

	toolResult: (
		text: string,
		images?: string[],
		fileString?: string,
	): string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> => {
		const toolResultOutput = []

		if (!(images && images.length > 0) && !fileString) {
			return text
		}

		const textBlock: Anthropic.TextBlockParam = { type: "text", text }
		toolResultOutput.push(textBlock)

		if (images && images.length > 0) {
			const imageBlocks: Anthropic.ImageBlockParam[] = formatImagesIntoBlocks(images)
			toolResultOutput.push(...imageBlocks)
		}

		if (fileString) {
			const fileBlock: Anthropic.TextBlockParam = { type: "text", text: fileString }
			toolResultOutput.push(fileBlock)
		}

		return toolResultOutput
	},

	imageBlocks: (images?: string[]): Anthropic.ImageBlockParam[] => {
		return formatImagesIntoBlocks(images)
	},

	formatFilesList: (
		absolutePath: string,
		fileInfos: FileInfo[],
		didHitLimit: boolean,
		clineIgnoreController?: ClineIgnoreController,
	): string => {
		// Convert FileInfo to formatted strings with metadata
		const formatted = fileInfos
			.map((info) => {
				const relativePath = path.relative(absolutePath, info.path).toPosix()
				const displayPath = info.isDirectory ? `${relativePath}/` : relativePath

				// Format size: KB for files, empty for directories
				const sizeKB = info.isDirectory ? "" : `${(info.size / 1000).toFixed(1)} KB`

				// Format modification time: YYYY-MM-DD HH:MM
				const mtimeStr =
					info.mtime.getTime() > 0
						? `${info.mtime.getFullYear()}-${String(info.mtime.getMonth() + 1).padStart(2, "0")}-${String(info.mtime.getDate()).padStart(2, "0")} ${String(info.mtime.getHours()).padStart(2, "0")}:${String(info.mtime.getMinutes()).padStart(2, "0")}`
						: ""

				// Format line count
				const lineInfo = info.isDirectory
					? ""
					: info.lineCount !== undefined
						? `${info.lineCount} lines`
						: ""

				// Build metadata suffix
				const metadataParts = [sizeKB, mtimeStr, lineInfo].filter((p) => p.length > 0)
				const metadata = metadataParts.length > 0 ? `  (${metadataParts.join(", ")})` : ""

				return { displayPath, metadata, relativePath }
			})
			// Sort so files are listed under their respective directories
			.sort((a, b) => {
				const aParts = a.relativePath.split("/")
				const bParts = b.relativePath.split("/")
				for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
					if (aParts[i] !== bParts[i]) {
						if (i + 1 === aParts.length && i + 1 < bParts.length) {
							return -1
						}
						if (i + 1 === bParts.length && i + 1 < aParts.length) {
							return 1
						}
						return aParts[i].localeCompare(bParts[i], undefined, {
							numeric: true,
							sensitivity: "base",
						})
					}
				}
				return aParts.length - bParts.length
			})

		const clineIgnoreParsed = clineIgnoreController
			? formatted.map(({ displayPath, metadata }) => {
					const absoluteFilePath = path.resolve(absolutePath, displayPath)
					const isIgnored = !clineIgnoreController.validateAccess(absoluteFilePath)
					if (isIgnored) {
						return `${LOCK_TEXT_SYMBOL} ${displayPath}${metadata}`
					}
					return `${displayPath}${metadata}`
				})
			: formatted.map(({ displayPath, metadata }) => `${displayPath}${metadata}`)

		if (didHitLimit) {
			return `${clineIgnoreParsed.join("\n")}\n\n${getPrompt("responses", "fileListTruncated")}`
		}
		if (clineIgnoreParsed.length === 0 || (clineIgnoreParsed.length === 1 && clineIgnoreParsed[0] === "")) {
			return getPrompt("responses", "noFilesFound")
		}
		return clineIgnoreParsed.join("\n")
	},

	createPrettyPatch: (filename = "file", oldStr?: string, newStr?: string) => {
		// strings cannot be undefined or diff throws exception
		const patch = diff.createPatch(filename.toPosix(), oldStr || "", newStr || "")
		const lines = patch.split("\n")
		const prettyPatchLines = lines.slice(4)
		return prettyPatchLines.join("\n")
	},

	taskResumption: (
		mode: Mode,
		agoText: string,
		cwd: string,
		wasRecent: boolean | 0 | undefined,
		responseText?: string,
		hasPendingFileContextWarnings?: boolean,
	): [string, string] => {
		const resumeTemplate =
			mode === "plan"
				? getPrompt("responses", "taskResumptionPlan", { agoText, cwd: cwd.toPosix() })
				: getPrompt("responses", "taskResumptionAct", { agoText, cwd: cwd.toPosix() })

		const recentNote =
			wasRecent && !hasPendingFileContextWarnings ? `\n\n${getPrompt("responses", "taskResumptionRecentNote")}` : ""

		const taskResumptionMessage = `[TASK RESUMPTION] ${resumeTemplate}${recentNote}`

		let userResponseMessage = ""
		if (responseText) {
			const prefix =
				mode === "plan"
					? getPrompt("responses", "taskResumptionResponsePlanPrefix")
					: getPrompt("responses", "taskResumptionResponseActPrefix")
			userResponseMessage = `${prefix}:\n<user_message>\n${responseText}\n</user_message>`
		} else if (mode === "plan") {
			userResponseMessage = getPrompt("responses", "taskResumptionNoResponsePlan")
		}

		return [taskResumptionMessage, userResponseMessage]
	},

	planModeInstructions: () => getPrompt("responses", "planModeInstructions"),

	/**
	 * Build a checkpoint-restore message for resuming after edited-input restore.
	 * Injects the edited text as a <user_message> block with a short explainer
	 * so the model knows the conversation was rewound and project files may differ.
	 */
	checkpointRestore: (editedText: string): string => {
		return getPrompt("responses", "checkpointRestoreAct", { editedText })
	},

	fileEditWithUserChanges: (
		relPath: string,
		userEdits: string,
		autoFormattingEdits: string | undefined,
		wroteLines: number,
		savedLines: number,
		formatterChanged: boolean,
		newProblemsMessage: string | undefined,
	) => {
		const rel = relPath.toPosix()
		const formatterNotice = formatterChanged ? getPrompt("responses", "formatterChangedNotice", {}) : ""
		return `${getPrompt("responses", "fileEditUserChangesHead", { userEdits })}${autoFormattingEdits ? getPrompt("responses", "fileEditAutoFormattingWithChanges", { autoFormattingEdits }) : ""}${getPrompt("responses", "fileEditUpdatedContent", { relPath: rel, wroteLines, savedLines })}${formatterNotice}${getPrompt("responses", "fileEditNotesWithChanges", { newProblemsMessage: newProblemsMessage ?? "" })}`
	},

	fileEditWithoutUserChanges: (
		relPath: string,
		autoFormattingEdits: string | undefined,
		wroteLines: number,
		savedLines: number,
		formatterChanged: boolean,
		newProblemsMessage: string | undefined,
		deletedLines?: number,
		addedLines?: number,
	) => {
		const rel = relPath.toPosix()
		const formatterNotice = formatterChanged ? getPrompt("responses", "formatterChangedNotice", {}) : ""
		const isReplace = deletedLines !== undefined && addedLines !== undefined
		const successTemplate = isReplace
			? getPrompt("responses", "replaceEditSuccessContent", { relPath: rel, deletedLines, addedLines, savedLines })
			: getPrompt("responses", "fileEditSuccessContent", { relPath: rel, wroteLines, savedLines })
		return `${successTemplate}${autoFormattingEdits ? getPrompt("responses", "fileEditAutoFormattingWithoutChanges", { autoFormattingEdits }) : ""}${formatterNotice}${getPrompt("responses", "fileEditNotesWithoutChanges", { newProblemsMessage: newProblemsMessage ?? "" })}`
	},

	diffErrorReminder: () => getPrompt("responses", "diffErrorReminder"),

	toolAlreadyUsed: (toolName: string) => getPrompt("responses", "toolAlreadyUsed", { toolName }),

	repeatedToolCall: (toolName: string, count: number) => getPrompt("responses", "repeatedToolCall", { toolName, count }),

	clineIgnoreInstructions: (content: string) =>
		getPrompt("responses", "clineIgnoreInstructions", { lockSymbol: LOCK_TEXT_SYMBOL, content }),

	clineRulesGlobalDirectoryInstructions: (globalClineRulesFilePath: string, content: string) =>
		getPrompt("responses", "clineRulesGlobalDirInstructions", {
			globalPath: globalClineRulesFilePath.toPosix(),
			content,
		}),

	clineRulesLocalDirectoryInstructions: (workspaceName: string, content: string) =>
		getPrompt("responses", "clineRulesLocalDirInstructions", { workspaceName, content }),

	clineRulesLocalFileInstructions: (workspaceName: string, content: string) =>
		getPrompt("responses", "clineRulesLocalFileInstructions", { workspaceName, content }),

	windsurfRulesLocalFileInstructions: (cwd: string, content: string) =>
		getPrompt("responses", "windsurfRulesLocalFileInstructions", { cwd: cwd.toPosix(), content }),

	cursorRulesLocalFileInstructions: (cwd: string, content: string) =>
		getPrompt("responses", "cursorRulesLocalFileInstructions", { cwd: cwd.toPosix(), content }),

	cursorRulesLocalDirectoryInstructions: (cwd: string, content: string) =>
		getPrompt("responses", "cursorRulesLocalDirInstructions", { cwd: cwd.toPosix(), content }),

	agentsRulesLocalFileInstructions: (cwd: string, content: string) =>
		getPrompt("responses", "agentsRulesLocalFileInstructions", { cwd: cwd.toPosix(), content }),

	fileContextWarning: (editedFiles: string[]): string => {
		const fileCount = editedFiles.length
		const fileVerb = fileCount === 1 ? "file has" : "files have"
		const fileDemonstrativePronoun = fileCount === 1 ? "this file" : "these files"
		const filePersonalPronoun = fileCount === 1 ? "it" : "they"
		const filesList = editedFiles.map((file) => ` ${path.resolve(file).toPosix()}`).join("\n")

		return getPrompt("responses", "fileContextWarning", {
			fileCount,
			fileVerb,
			fileDemonstrativePronoun,
			filePersonalPronoun,
			filesList,
		})
	},
}

// to avoid circular dependency
const formatImagesIntoBlocks = (images?: string[]): Anthropic.ImageBlockParam[] => {
	return images
		? images.map((dataUrl) => {
				// data:image/png;base64,base64string
				const [rest, base64] = dataUrl.split(",")
				const mimeType = rest.split(":")[1].split(";")[0]
				return {
					type: "image",
					source: {
						type: "base64",
						media_type: mimeType,
						data: base64,
					},
				} as Anthropic.ImageBlockParam
			})
		: []
}
