import type { ToolUse } from "@core/assistant-message"
import { getPrompt } from "@core/prompts/i18n"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"

/**
 * Handles focus chain change tool.
 * Allows AI to request plan changes with user approval.
 */
export class FocusChainHandler implements IToolHandler {
	readonly name = ClineDefaultTool.FOCUS_CHAIN_CHANGE

	getDescription(block: ToolUse): string {
		return `[${block.name}] Request focus chain plan change`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const newPlan = (block.params as Record<string, string>).new_plan
		const reason = (block.params as Record<string, string>).reason || ""

		if (!newPlan) {
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

		// Capture message ts when ask is created, so we can update it after approval
		let askMessageTs: number | undefined
		const askData = JSON.stringify({ plan: newPlan, reason })
		const {
			response,
			text: responseText,
			images,
			files,
		} = await config.callbacks.ask("focus_chain_change", askData, false, {
			onTsCreated: (ts) => {
				askMessageTs = ts
			},
		})

		// Only yesButtonClicked (bottom Approve button) is approval.
		// Everything else (noButtonClicked, messageResponse, direct input, etc.) is denial.
		const isApproved = response === "yesButtonClicked"

		if (!isApproved) {
			// Write user_feedback before denying so the AI sees the user's input
			if (responseText || (images && images.length > 0) || (files && files.length > 0)) {
				await config.callbacks.say("user_feedback", responseText ?? "", images, files)
			}
			// Deny: mark all items as [-] in message.text, do NOT touch focus chain file
			if (askMessageTs !== undefined) {
				const deniedPlan = this.buildRejectedMark(newPlan)
				const messages = config.messageState.clineMessages
				const idx = messages.findIndex((m) => m.ts === askMessageTs)
				if (idx >= 0) {
					const updatedText = JSON.stringify({ plan: deniedPlan, reason })
					await config.callbacks.updateClineMessage(idx, { text: updatedText })
					await config.messageState.updateTaskHistory()
				}
			}
			return getPrompt("focusChain", "focusChainChangeDenied")
		}

		// Approve: use responseText (selected plan with [+]/[-] markers) or full newPlan
		const approvedPlan = responseText && responseText !== "Approve" ? responseText : newPlan

		// Persist selected plan into the ask message text (ui_message.jsonl) for readonly rendering
		if (askMessageTs !== undefined) {
			const messages = config.messageState.clineMessages
			const idx = messages.findIndex((m) => m.ts === askMessageTs)
			if (idx >= 0) {
				const updatedText = JSON.stringify({ plan: approvedPlan, reason })
				await config.callbacks.updateClineMessage(idx, { text: updatedText })
				await config.messageState.updateTaskHistory()
			}
		}

		// Clean approvedPlan for focus chain file:
		// - Remove "[-] - " lines (rejected items)
		// - Convert "[+] - " prefix to "- " (approved items)
		// - Remove empty section headings
		// - Keep "- [x]" lines as-is (already completed)
		const focusChainPlan = this.cleanForFocusChain(approvedPlan)
		if (focusChainPlan) {
			await config.callbacks.focusChainForceUpdate(focusChainPlan)
		}
		return getPrompt("focusChain", "focusChainChangeApproved")
	}

	/**
	 * Build a version of the plan where all pending items are marked as rejected ([-]).
	 * Existing "- [x]" items stay as-is.
	 */
	private buildRejectedMark(plan: string): string {
		return plan
			.split("\n")
			.map((line) => {
				const trimmed = line.trim()
				// Keep headings and title as-is
				if (trimmed.startsWith("# ")) return trimmed
				// Mark pending items as rejected, keep completed items as-is
				if (trimmed.startsWith("- [ ]")) {
					return trimmed.replace("- [ ]", "[-] - [ ]")
				}
				// Keep existing markers (if any) and other lines
				return trimmed
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
