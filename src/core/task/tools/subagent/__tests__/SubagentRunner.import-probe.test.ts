import { describe, it } from "vitest"

describe("SubagentRunner import probe", () => {
	it("verifies SubagentRunner import graph resolves", { timeout: 60_000 }, async () => {
		const specs = [
			"@core/api",
			"@core/context/instructions/user-instructions/skills",
			"@core/prompts/system-prompt",
			"@/hosts/host-provider",
			"@/shared/proto/dline/models",
			"@/shared/services/Logger",
			"@/shared/tools",
			"../../../TaskState",
			"../SubagentBuilder",
			"../SubagentRunner",
		]

		for (const spec of specs) {
			console.error(`[import-probe] importing ${spec}`)
			try {
				await import(spec)
				console.error(`[import-probe] ok ${spec}`)
			} catch (error) {
				console.error(`[import-probe] FAIL ${spec}`)
				console.error(error)
				throw error
			}
		}
	})
})
