import type { ClineMessage } from "@shared/ExtensionMessage"
import type { TaskSnapshot } from "./TaskSnapshot"

/**
 * Finds the active approval block recorded by a task snapshot.
 * @param snapshot Snapshot to inspect.
 * @returns Active snapshot approval block, or undefined when none exists.
 */
function getSnapshotBlock(snapshot: TaskSnapshot): NonNullable<TaskSnapshot["approval"]>["blocks"][number] | undefined {
	const blocks = snapshot.approval?.blocks ?? []
	if (snapshot.approval?.activeCallId) {
		const active = blocks.find((block) => block.callId === snapshot.approval?.activeCallId)
		if (active) return active
	}
	return blocks.find((block) => block.phase === "awaiting_approval") ?? blocks.find((block) => block.phase === "executing")
}

/**
 * Maps a tool name to the ask type used by the UI message stream.
 * @param toolName Tool name stored in snapshot approval metadata.
 * @returns Ask type expected for the tool approval message.
 */
function toolNameToAskType(toolName: string): ClineMessage["ask"] {
	switch (toolName) {
		case "execute_command":
			return "command"
		case "spawn_task":
			return "spawn_task"
		case "browser_action":
			return "browser_action_launch"
		case "use_mcp_tool":
		case "access_mcp_resource":
			return "use_mcp_server"
		case "use_subagents":
			return "use_subagents"
		case "focus_chain_change":
			return "focus_chain_change"
		default:
			return "tool"
	}
}

/**
 * Checks whether tail UI messages prove that an awaiting ask has already been consumed.
 * @param snapshot Snapshot that introduced the awaiting ask.
 * @param messages Full UI message list loaded from history.
 * @param awaitingAsk Ask message referenced by the snapshot.
 * @returns True when later messages move past the awaiting ask.
 */
function isAwaitingConsumed(snapshot: TaskSnapshot, messages: ClineMessage[], awaitingAsk: ClineMessage): boolean {
	const anchorTs = Math.max(snapshot.timestamp, awaitingAsk.ts)
	return messages.some((message) => {
		if (message.ts <= anchorTs) return false
		if (message.say === "user_feedback") return true
		if (message.say === "api_req_started" && (message.conversationHistoryIndex ?? -1) > snapshot.apiIndex) return true
		if (message.type === "ask" && message.ts !== awaitingAsk.ts) return true
		return false
	})
}

/**
 * Replays UI messages after a snapshot anchor to find the still-active ask, if any.
 * @param snapshot Snapshot used as the recovery checkpoint.
 * @param messages Full UI message list loaded from history.
 * @returns Active ask message, or undefined when tail messages consumed the snapshot awaiting state.
 */
export function findAnchoredAsk(snapshot: TaskSnapshot | undefined, messages: ClineMessage[]): ClineMessage | undefined {
	if (!snapshot) return undefined

	if (snapshot.awaiting?.messageTs !== undefined && snapshot.awaiting.taskAsk) {
		const awaitingAsk = messages.find(
			(message) =>
				message.type === "ask" &&
				message.ts === snapshot.awaiting?.messageTs &&
				message.ask === snapshot.awaiting.taskAsk,
		)
		if (!awaitingAsk) return undefined
		return isAwaitingConsumed(snapshot, messages, awaitingAsk) ? undefined : awaitingAsk
	}

	const activeBlock = getSnapshotBlock(snapshot)
	const anchorApiIndex = activeBlock?.apiIndex ?? snapshot.resume?.assistantApiIndex ?? snapshot.apiIndex
	const expectedAsk = activeBlock ? toolNameToAskType(activeBlock.name) : undefined

	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]
		if (message.type !== "ask") continue
		if (message.conversationHistoryIndex !== anchorApiIndex) continue
		if (expectedAsk && message.ask !== expectedAsk) continue
		return message
	}

	if (expectedAsk) {
		for (let i = messages.length - 1; i >= 0; i--) {
			const message = messages[i]
			if (message.type === "ask" && message.ask === expectedAsk) {
				return message
			}
		}
	}

	return undefined
}
