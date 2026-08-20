import type { ToolUse } from "@core/assistant-message"
import { getPrompt } from "@core/prompts/i18n"
import { ClineDefaultTool } from "@/shared/tools"
import { hasValidTodoItem } from "../../focus-chain/file-utils"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import { interactionId, interactionTurnId, type TaskConfig } from "../types/TaskConfig"
import { sayFeedbackOnce } from "../utils/UserFeedbackUtils"

/**
 * Handles focus chain change tool.
 * Allows AI to request plan changes with user approval.
 */
export class FocusChainHandler implements IToolHandler {
	readonly name = ClineDefaultTool.CHANGE_TODO_LIST

	getDescription(block: ToolUse): string {
		return `[${block.name}] Request TODO list change`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const newPlan = (block.params as Record<string, string>).new_plan?.trim()
		const reason = (block.params as Record<string, string>).reason || ""

		if (!newPlan || !hasValidTodoItem(newPlan)) {
			return getPrompt("focusChain", "focusChainChangeMissing")
		}

		// Check auto-approval
		if (config.autoApprovalSettings.actions.focusChain) {
			await config.callbacks.focusChainForceUpdate(newPlan)

			// Send tool say message so webview renders the focus chain change with "Auto Approved" label
			const toolMessage = JSON.stringify({
				tool: "focusChainChanged",
				path: newPlan,
				content: reason,
			})
			await config.callbacks.say("tool", toolMessage)

			return getPrompt("focusChain", "focusChainChangeApproved")
		}

		const askData = JSON.stringify({ plan: newPlan, reason })
		const outcome = await config.interactions.open({
			turnId: interactionTurnId(block),
			interactionId: interactionId(block),
			kind: "change_todo_list",
			presentation: askData,
			existingTs: block.ts,
		})
		const responseText = outcome.draft?.text
		const images = outcome.draft?.images
		const files = outcome.draft?.files
		const isApproved = outcome.actionId === "approve"

		if (!isApproved) {
			// Write user_feedback before denying so the AI sees the user's input
			if (responseText || (images && images.length > 0) || (files && files.length > 0)) {
				await sayFeedbackOnce(config, "noButtonClicked", responseText, images, files)
			}
			return getPrompt("focusChain", "focusChainChangeDenied")
		}

		const approvedPlan = this.selectPlan(newPlan, outcome.selection?.values ?? [])

		// Clean approvedPlan for focus chain file:
		// - Remove "[-] - " lines (rejected items)
		// - Convert "[+] - " prefix to "- " (approved items)
		// - Remove empty section headings
		// - Keep "- [x]" lines as-is (already completed)
		const focusChainPlan = this.cleanForFocusChain(approvedPlan).trim()
		if (!hasValidTodoItem(focusChainPlan)) {
			return getPrompt("focusChain", "focusChainChangeNoItemsApproved")
		}
		await config.callbacks.focusChainForceUpdate(focusChainPlan)
		return getPrompt("focusChain", "focusChainChangeApproved")
	}

	/** Build the approved plan from stable pending-item indices. */
	private selectPlan(plan: string, selection: string[]): string {
		const selected = new Set(selection)
		let pendingIndex = 0
		return plan
			.split("\n")
			.filter((line) => {
				if (!line.trim().startsWith("- [ ]")) {
					return true
				}
				const keep = selected.has(String(pendingIndex))
				pendingIndex += 1
				return keep
			})
			.join("\n")
	}

	/**
	 * Clean a marked plan for focus chain file output.
	 */
	private cleanForFocusChain(markedPlan: string): string {
		const lines = markedPlan.split("\n")
		const result: string[] = []
		let pendingHeading: string | null = null

		for (const line of lines) {
			const trimmed = line.trim()
			if (trimmed.startsWith("## ")) {
				pendingHeading = trimmed
			} else if (trimmed.startsWith("[-] - ")) {
				// Rejected item — skip
			} else if (trimmed.startsWith("[+] - ")) {
				if (pendingHeading) {
					result.push(pendingHeading)
					pendingHeading = null
				}
				result.push(trimmed.replace(/^\[\+\]\s*-\s*\[\s*\]\s*/, "- [ ] "))
			} else if (trimmed.startsWith("- [")) {
				if (pendingHeading) {
					result.push(pendingHeading)
					pendingHeading = null
				}
				result.push(trimmed)
			} else if (trimmed.startsWith("# ") || trimmed === "") {
				if (pendingHeading) {
					result.push(pendingHeading)
					pendingHeading = null
				}
				result.push(trimmed)
			}
		}
		return result.join("\n")
	}
}
