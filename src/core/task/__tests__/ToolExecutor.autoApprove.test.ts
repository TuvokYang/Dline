import { strict as assert } from "node:assert"
import path from "node:path"
import { ClineDefaultTool } from "@shared/tools"
import { describe, it } from "vitest"
import type { ToolUse } from "../../assistant-message"
import { isBlockAutoApproved, isToolUseAutoApproved } from "../ToolExecutor"

/**
 * Build a complete tool-use block for auto-approval tests.
 * @param name Tool name under test.
 * @param params Tool params supplied by the assistant.
 * @returns Complete ToolUse block accepted by production helpers.
 */
function makeBlock(name: ClineDefaultTool, params: ToolUse["params"]): ToolUse {
	return {
		type: "tool_use",
		function_id: `test_${name}`,
		dline_tid: `test_tid_${name}`,
		name,
		params,
		partial: false,
		ts: 1,
	}
}

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

	it("requires manual approval for read_file outside workspace when external reads are disabled", () => {
		const cwd = path.resolve("/workspace/project")
		const externalPath = path.resolve("/workspace/secret.txt")
		const autoApproved = isBlockAutoApproved(makeBlock(ClineDefaultTool.FILE_READ, { path: externalPath }), {
			cwd,
			autoApproveResult: [true, false],
		})

		assert.equal(autoApproved, false)
	})

	it("uses path scope for read-only auto-approval settings", () => {
		const cwd = path.resolve("/workspace/project")
		const tools = [
			ClineDefaultTool.FILE_READ,
			ClineDefaultTool.LIST_FILES,
			ClineDefaultTool.SEARCH,
			ClineDefaultTool.LIST_CODE_DEF,
		]

		for (const toolName of tools) {
			const localApproved = isBlockAutoApproved(makeBlock(toolName, { path: "src/index.ts" }), {
				cwd,
				autoApproveResult: [true, false],
			})
			const externalDenied = isBlockAutoApproved(makeBlock(toolName, { path: path.resolve("/workspace/secret.txt") }), {
				cwd,
				autoApproveResult: [true, false],
			})
			const externalApproved = isBlockAutoApproved(makeBlock(toolName, { path: path.resolve("/workspace/secret.txt") }), {
				cwd,
				autoApproveResult: [true, true],
			})
			const missingPathDenied = isBlockAutoApproved(makeBlock(toolName, {}), {
				cwd,
				autoApproveResult: [true, true],
			})

			assert.equal(localApproved, true, `${toolName} local path should be auto-approved`)
			assert.equal(externalDenied, false, `${toolName} external path should require approval`)
			assert.equal(externalApproved, true, `${toolName} external path should honor external auto-approval`)
			assert.equal(missingPathDenied, false, `${toolName} missing path should require approval`)
		}
	})
})
