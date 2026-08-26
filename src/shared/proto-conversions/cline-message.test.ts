import { ClineAsk } from "@shared/proto/dline/ui"
import { describe, expect, it } from "vitest"
import { convertClineMessageToProto, convertProtoToClineMessage } from "./cline-message"

describe("ClineMessage command identity conversion", () => {
	it("preserves command activity state across the proto boundary", () => {
		const applicationMessage = {
			ts: 100,
			type: "say" as const,
			say: "command" as const,
			text: "sleep 10",
			activityId: "command-100-1",
			commandStatus: "cancelled" as const,
			commandExecutionMode: "background" as const,
			commandCanMoveToBackground: true,
		}

		const protoMessage = convertClineMessageToProto(applicationMessage)
		const roundTripMessage = convertProtoToClineMessage(protoMessage)

		expect(protoMessage.activityId).toBe("command-100-1")
		expect((protoMessage as unknown as { commandExecutionMode?: string }).commandExecutionMode).toBe("background")
		expect(roundTripMessage).toMatchObject({
			activityId: "command-100-1",
			commandStatus: "cancelled",
			commandExecutionMode: "background",
			commandCanMoveToBackground: true,
		})
	})

	it("round-trips the canonical TODO-list interaction through proto enum 20", () => {
		const applicationMessage = {
			ts: 101,
			type: "ask" as const,
			ask: "change_todo_list" as const,
			text: JSON.stringify({ plan: "# Plan\n- [ ] First item", reason: "Review" }),
		}

		const protoMessage = convertClineMessageToProto(applicationMessage)
		const roundTripMessage = convertProtoToClineMessage(protoMessage)

		expect(ClineAsk.CHANGE_TODO_LIST).toBe(20)
		expect(protoMessage.ask).toBe(ClineAsk.CHANGE_TODO_LIST)
		expect(roundTripMessage.ask).toBe("change_todo_list")
	})

	it("preserves the compaction conversation range across the Webview proto boundary", () => {
		const applicationMessage = {
			ts: 102,
			type: "say" as const,
			say: "tool" as const,
			compactionConversationRange: {
				logicalTurnRange: [2, 5] as const,
				apiConversationRange: [4, 11] as const,
				preCompactionApiEndIndex: 13,
			},
		}

		const protoMessage = convertClineMessageToProto(applicationMessage)
		const roundTripMessage = convertProtoToClineMessage(protoMessage)

		expect(protoMessage.compactionConversationRange).toEqual({
			logicalTurnStartIndex: 2,
			logicalTurnEndIndex: 5,
			apiConversationStartIndex: 4,
			apiConversationEndIndex: 11,
			preCompactionApiEndIndex: 13,
		})
		expect(roundTripMessage.compactionConversationRange).toEqual(applicationMessage.compactionConversationRange)
	})
})
