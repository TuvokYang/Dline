import type { ToolUse } from "@core/assistant-message"
import { getPrompt, renderPrompt } from "@core/prompts/i18n"
import { getReadablePath } from "@utils/path"
import { HostProvider } from "@/hosts/host-provider"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

/** Structured reference entry for JSON payload. */
interface RefEntry {
	file: string
	line: number
	character: number
	context: string
}

export class FindReferencesHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.FIND_REFERENCES

	getDescription(block: ToolUse): string {
		const params = block.params as Record<string, unknown> | undefined
		return `[find_references] ${String(params?.file_path || "?")}`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const config = uiHelpers.getConfig()
		if (config.isSubagentExecution) return
		const params = block.params as Record<string, unknown> | undefined
		const rawPath = String(params?.file_path || "")
		await uiHelpers.say(
			"tool",
			JSON.stringify({
				tool: "findReferences",
				path: getReadablePath(config.cwd, rawPath),
				operationIsLocatedInWorkspace: true,
			}),
			undefined,
			undefined,
			true,
			block.ts,
		)
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const p = block.params as Record<string, unknown> | undefined
		const filePath = String(p?.file_path || "")
		const line = Number(p?.line || 0)
		const character = Number(p?.character || 0)
		const errMsg = (msg: string) => {
			config.callbacks
				.say(
					"tool",
					JSON.stringify({
						tool: "findReferences",
						path: getReadablePath(config.cwd, filePath),
						content: msg,
						operationIsLocatedInWorkspace: true,
					}),
					undefined,
					undefined,
					false,
					block.ts,
				)
				.catch(() => {})
			return msg
		}
		if (!filePath || !line || !character) return errMsg("Error: missing required parameters.")

		try {
			const r = await HostProvider.language.findReferences({ filePath, line, character })
			if (!r.hasLspSupport) return errMsg(getPrompt("findReferences", "noLspSupport"))
			if (r.errorMessage) {
				return errMsg(renderPrompt("findReferences", "errorPrefix", { ERROR: r.errorMessage }))
			}
			if (!r.references?.length) return errMsg(getPrompt("findReferences", "noReferences"))

			// Build structured references array
			const refs: RefEntry[] = r.references.map((ref: any) => ({
				file: getReadablePath(config.cwd, ref.filePath),
				line: ref.startLine,
				character: ref.startCharacter,
				context: ref.contextLine,
			}))

			// Infer symbol name from first reference's context line at the given character
			const symbolName = extractSymbolAt(r.references[0].contextLine, 1)

			// Build human-readable content
			const grouped = new Map<string, string[]>()
			for (const ref of r.references) {
				const rel = getReadablePath(config.cwd, ref.filePath)
				if (!grouped.has(rel)) grouped.set(rel, [])
				grouped.get(rel)?.push(`L${ref.startLine}:${ref.startCharacter}  ${ref.contextLine}`)
			}
			const parts: string[] = []
			for (const [rel, lines] of grouped) parts.push(`${rel}\n${lines.join("\n")}`)
			const content = parts.join("\n\n")

			const uniqueFiles = new Set(r.references.map((ref: any) => ref.filePath)).size
			config.callbacks
				.say(
					"tool",
					JSON.stringify({
						tool: "findReferences",
						path: getReadablePath(config.cwd, filePath),
						symbolName,
						files: uniqueFiles,
						count: r.references.length,
						references: refs,
						content,
						operationIsLocatedInWorkspace: true,
					}),
					undefined,
					undefined,
					false,
					block.ts,
				)
				.catch(() => {})
			return content
		} catch (e) {
			return errMsg(renderPrompt("findReferences", "errorPrefix", { ERROR: String(e) }))
		}
	}
}

/**
 * Extract a symbol name from a context line at the given 1-based character offset.
 * Returns the word starting at that position, or empty string if not found.
 */
function extractSymbolAt(contextLine: string, character: number): string {
	const idx = character - 1
	if (idx < 0 || idx >= contextLine.length) return ""
	const substr = contextLine.substring(idx)
	const match = substr.match(/^(\w+)/)
	return match ? match[1] : ""
}
