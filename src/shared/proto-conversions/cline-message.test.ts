import { describe, expect, it } from "vitest"
import { convertClineMessageToProto, convertProtoToClineMessage } from "./cline-message"

describe("ClineMessage command identity conversion", () => {
	it("preserves activityId and cancelled status across the proto boundary", () => {
		const applicationMessage = {
			ts: 100,
			type: "say" as const,
			say: "command" as const,
			text: "sleep 10",
			activityId: "command-100-1",
			commandStatus: "cancelled" as const,
		}

		const protoMessage = convertClineMessageToProto(applicationMessage)
		const roundTripMessage = convertProtoToClineMessage(protoMessage)

		expect(protoMessage.activityId).toBe("command-100-1")
		expect(roundTripMessage).toMatchObject({
			activityId: "command-100-1",
			commandStatus: "cancelled",
		})
	})
})
