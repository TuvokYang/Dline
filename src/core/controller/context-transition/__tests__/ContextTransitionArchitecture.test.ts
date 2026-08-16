import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve("src/core")

async function read(relativePath: string): Promise<string> {
	return readFile(path.join(root, relativePath), "utf8")
}

/** Lock the approved transition ownership and interaction boundaries. */
describe("ContextTransition architecture", () => {
	it("uses one engine as the only Profile and Mode transaction state owner", async () => {
		const [engine, modeAdapter, profileAdapter] = await Promise.all([
			read("controller/context-transition/ContextTransitionEngine.ts").catch(() => ""),
			read("controller/mode-switch/ModeSwitchCoordinator.ts"),
			read("controller/profile-switch/ProfileSwitchCoordinator.ts"),
		])

		expect(engine).toContain("export class ContextTransitionEngine")
		expect(modeAdapter).toContain("ContextTransitionEngine")
		expect(profileAdapter).toContain("ContextTransitionEngine")
		expect(modeAdapter).not.toMatch(/private\s+(?:readonly\s+)?(?:snapshot|operation)\b/)
		expect(profileAdapter).not.toMatch(/private\s+(?:readonly\s+)?(?:snapshot|operation)\b/)
	})

	it("keeps Profile projection from fabricating a result for the awaiting interaction", async () => {
		const task = await read("task/index.ts")
		const start = task.indexOf("async projectProfileSwitchTargetUsage(")
		const end = task.indexOf("\n\t/** Assemble one non-destructive complete target candidate", start)
		const method = task.slice(start, end)

		expect(start).toBeGreaterThanOrEqual(0)
		expect(end).toBeGreaterThan(start)
		expect(method).not.toContain("projectContextTransitionCompactionContinuation")
	})

	it("keeps conversational handlers and InteractionCoordinator unaware of compaction control signals", async () => {
		const paths = [
			"task/interaction/InteractionCoordinator.ts",
			"task/tools/handlers/AskFollowupQuestionToolHandler.ts",
			"task/tools/handlers/AttemptCompletionHandler.ts",
			"task/tools/handlers/GenerateReportHandler.ts",
			"task/tools/handlers/MakePlanHandler.ts",
			"task/tools/handlers/QnaRespondHandler.ts",
			"task/tools/handlers/StatusUpdateHandler.ts",
		]
		const sources = await Promise.all(paths.map(read))

		for (const source of sources) {
			expect(source).not.toContain("respondForModeCompaction")
			expect(source).not.toContain("MODE_SWITCH_COMPACT_SIGNAL")
			expect(source).not.toContain("isCompactSignal")
			expect(source).not.toContain("CONTEXT_TRANSITION_COMPACTION_RESULT")
		}
	})
})
