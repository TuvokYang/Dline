import { strict as assert } from "node:assert"
import { ClineDefaultTool } from "@shared/tools"
import { describe, it } from "vitest"
import { isToolUseAutoApproved } from "../ToolExecutor"

describe("isToolUseAutoApproved", () => {
	it("requires manual approval for command when LLM requires approval and only safe auto-approve is enabled", () => {
		const autoApproved = isToolUseAutoApproved(ClineDefaultTool.BASH, { requires_approval: "true" }, [true, false])

		assert.equal(autoApproved, false)
	})

	it("auto-approves command when LLM does not require approval and safe auto-approve is enabled", () => {
		const autoApproved = isToolUseAutoApproved(ClineDefaultTool.BASH, { requires_approval: "false" }, [true, false])

		assert.equal(autoApproved, true)
	})

	it("auto-approves command when LLM requires approval and all command auto-approve is enabled", () => {
		const autoApproved = isToolUseAutoApproved(ClineDefaultTool.BASH, { requires_approval: "true" }, [true, true])

		assert.equal(autoApproved, true)
	})
})
