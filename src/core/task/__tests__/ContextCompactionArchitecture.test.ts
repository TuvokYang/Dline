import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

const taskPath = path.resolve("src/core/task/index.ts")
const sessionPath = path.resolve("src/core/task/ContextCompactionSession.ts")
const preCompactExecutorPath = path.resolve("src/core/hooks/precompact-executor.ts")

/** Lock the single compaction execution boundary before implementation. */
describe("ContextCompaction architecture", () => {
	it("routes automatic, manual, Profile, and Mode triggers through one session", async () => {
		const [task, session] = await Promise.all([readFile(taskPath, "utf8"), readFile(sessionPath, "utf8").catch(() => "")])

		expect(session).toContain("export class ContextCompactionSession")
		expect(session).toContain("auto_compaction")
		expect(session).toContain("task_header")
		expect(session).toContain("manual_compact_command")
		expect(session).toContain("profile_switch")
		expect(session).toContain("mode_switch")
		expect(task).toContain("ContextCompactionSession")
		expect(task).not.toContain("!manualCompactionOperation")
	})

	it("routes a manual compaction command directly through the Session without replaying canonical history", async () => {
		const task = await readFile(taskPath, "utf8")
		const methodStart = task.indexOf("async recursivelyMakeClineRequests(")
		const methodEnd = task.indexOf("\n\tasync loadContext(", methodStart)
		const method = task.slice(methodStart, methodEnd)

		expect(method).toContain("this.runManualContextCompaction(")
		expect(task).toContain('trigger: "manual_compact_command"')
		expect(method).not.toContain("this.compactionRequestReplay.begin(")
		expect(method).not.toContain("pendingManualCompactionRegeneration")
		expect(method).not.toContain("overwriteApiConversationHistory(")
	})

	it("uses flush or tail truncation instead of full history rewrites in compaction cleanup", async () => {
		const [task, preCompactExecutor] = await Promise.all([
			readFile(taskPath, "utf8"),
			readFile(preCompactExecutorPath, "utf8"),
		])
		const manualCleanupStart = task.indexOf("private async discardFailedManualCompactionAttempt(")
		const automaticCleanupStart = task.indexOf("private async discardFailedCompactionAttempt(", manualCleanupStart)
		const cleanupEnd = task.indexOf("private parsePreviousTokens(", automaticCleanupStart)
		const deferredStart = task.indexOf("private async deferCurrentTurn(", cleanupEnd)
		const deferredEnd = task.indexOf("private async restoreDeferredTurn(", deferredStart)
		const cleanup = task.slice(manualCleanupStart, cleanupEnd)
		const deferred = task.slice(deferredStart, deferredEnd)

		expect(preCompactExecutor).toContain("await params.messageStateHandler.flushApiConversationHistory()")
		expect(preCompactExecutor).not.toContain("overwriteApiConversationHistory(")
		expect(cleanup).toContain("truncateApiConversationHistory(historyIndex + 1)")
		expect(cleanup).not.toContain("overwriteApiConversationHistory(")
		expect(deferred).toContain("truncateApiConversationHistory(apiHistory.length - 1)")
		expect(deferred).not.toContain("overwriteApiConversationHistory(")
	})

	it("keeps Pass planning and execution out of the recursive ordinary request method", async () => {
		const task = await readFile(taskPath, "utf8")
		const methodStart = task.indexOf("async recursivelyMakeClineRequests(")
		const methodEnd = task.indexOf("\n\tasync loadContext(", methodStart)
		const method = task.slice(methodStart, methodEnd)

		expect(methodStart).toBeGreaterThanOrEqual(0)
		expect(methodEnd).toBeGreaterThan(methodStart)
		expect(method).not.toContain("planNextCompactionPass(")
		expect(method).not.toContain("runTargetWindowFittingPass(")
		expect(method).not.toContain("evaluateTargetWindowFitting(")
		expect(method).not.toContain("forceModeCompact")
	})
})
