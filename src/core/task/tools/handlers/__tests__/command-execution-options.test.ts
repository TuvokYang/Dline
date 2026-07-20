import { strict as assert } from "node:assert"
import { describe, it } from "vitest"
import { parseCommandExecutionOptions } from "../command-execution-options"

describe("parseCommandExecutionOptions", () => {
	it("defaults short commands to foreground with a bounded wait", () => {
		assert.deepEqual(parseCommandExecutionOptions("echo ready", undefined, undefined), {
			background: false,
			timeoutSeconds: 30,
		})
	})

	it("uses the extended timeout policy for recognized long-running commands", () => {
		assert.deepEqual(parseCommandExecutionOptions("npm test", undefined, undefined), {
			background: false,
			timeoutSeconds: 300,
		})
	})

	it("parses explicit background and positive integer timeout values", () => {
		assert.deepEqual(parseCommandExecutionOptions("npm test", "true", "45"), {
			background: true,
			timeoutSeconds: 45,
		})
		assert.deepEqual(parseCommandExecutionOptions("npm test", "false", "15"), {
			background: false,
			timeoutSeconds: 15,
		})
	})

	it("falls back for invalid, zero, negative, and fractional timeout values", () => {
		for (const timeout of ["invalid", "0", "-2", "2.5"]) {
			assert.equal(parseCommandExecutionOptions("echo ready", undefined, timeout).timeoutSeconds, 30)
		}
	})

	it("treats every non-true background value as false", () => {
		for (const background of [undefined, "", "false", "TRUE ", "1"]) {
			assert.equal(parseCommandExecutionOptions("echo ready", background, undefined).background, false)
		}
	})
})
