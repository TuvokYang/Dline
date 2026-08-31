import type { ToolParamName, ToolUse } from "@core/assistant-message"
import { AGENT_IGNORE_FILE, type IgnoreController } from "@core/ignore/IgnoreController"

export type ValidationResult = { ok: true } | { ok: false; error: string }

/**
 * Lightweight validator used by new tool handlers.
 * The legacy ToolExecutor switch remains unchanged and does not depend on this.
 */
export class ToolValidator {
	constructor(private readonly ignoreController: IgnoreController) {}

	/**
	 * Verifies required parameters exist on the tool block.
	 * Returns a message suitable for displaying in an error.
	 */
	assertRequiredParams(block: ToolUse, ...params: ToolParamName[]): ValidationResult {
		for (const p of params) {
			// params are stored under block.params using their tag name
			const val = (block as any)?.params?.[p]
			if (val === undefined || val === null || String(val).trim() === "") {
				return { ok: false, error: `Missing required parameter '${p}' for tool '${block.name}'.` }
			}
		}
		return { ok: true }
	}

	/**
	 * Verify that a path may be opened.
	 *
	 * Uses the read scope, so only agent-authored rules apply: a path excluded
	 * from version control is still readable. Callers should pass a repo-relative
	 * (workspace-relative) path.
	 */
	checkClineIgnorePath(relPath: string): ValidationResult {
		const accessAllowed = this.ignoreController.validateAccess(relPath, "read")
		if (!accessAllowed) {
			return {
				ok: false,
				error: `Access to path '${relPath}' is blocked by ${AGENT_IGNORE_FILE} settings.`,
			}
		}
		return { ok: true }
	}
}
