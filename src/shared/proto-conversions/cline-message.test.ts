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
})
