import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

const taskSourcePath = path.resolve("src/core/task/index.ts")

function extractMethod(source: string, startMarker: string, endMarker: string): string {
	const start = source.indexOf(startMarker)
	const end = source.indexOf(endMarker, start)
	if (start < 0 || end < 0) {
		throw new Error(`Unable to locate Task request boundary: ${startMarker}`)
	}
	return source.slice(start, end)
}

describe("Task request API boundary", () => {
	it("captures the API scope before the first request-local await", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async recursivelyMakeClineRequests(", "async loadContext(")
		const scopeIndex = method.indexOf("const requestScope = createRequestApiScope(")
		const firstAwaitIndex = method.indexOf("await ")

		expect(scopeIndex).toBeGreaterThanOrEqual(0)
		expect(firstAwaitIndex).toBeGreaterThan(scopeIndex)
	})

	it("does not compact a restored tool-result transaction before its durable admission boundary", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async recursivelyMakeClineRequests(", "async loadContext(")
		const compactionCapability = method.indexOf(
			"const canCompactBeforeAdmission = transaction.beforeApiRequestStarted === undefined",
		)
		const compactionGate = method.indexOf("if (canCompactBeforeAdmission &&")
		const deferredTurnCall = method.indexOf("shouldDeferCurrentTurn({")

		expect(compactionCapability).toBeGreaterThanOrEqual(0)
		expect(compactionGate).toBeGreaterThan(compactionCapability)
		expect(deferredTurnCall).toBeGreaterThan(compactionGate)
	})

	it("does not read the mutable handler after creating the request scope", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async recursivelyMakeClineRequests(", "async loadContext(")
		const scopeIndex = method.indexOf("const requestScope = createRequestApiScope(")
		const scopeEndIndex = method.indexOf("\n\t\t)\n", scopeIndex)
		const requestBody = method.slice(scopeEndIndex + "\n\t\t)\n".length)

		expect(scopeEndIndex).toBeGreaterThan(scopeIndex)
		expect(requestBody).not.toMatch(/\bthis\.api\b/)
	})

	it("ends the failed request chain after scheduling an automatic retry without cancelling the task", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async recursivelyMakeClineRequests(", "async loadContext(")
		const retryBranchStart = method.indexOf("if (retryDecision.shouldRetry) {")
		const retryBranchEnd = method.indexOf("if (retryDecision.shouldPrompt) {", retryBranchStart)
		const retryBranch = method.slice(retryBranchStart, retryBranchEnd)

		expect(retryBranchStart).toBeGreaterThanOrEqual(0)
		expect(retryBranchEnd).toBeGreaterThan(retryBranchStart)
		expect(retryBranch).toContain("void runDelayedStreamRetry({")
		expect(retryBranch).toContain("return true")
		expect(retryBranch).not.toContain("await this.cancelTask()")
		expect(retryBranch).not.toContain("await this.reinitExistingTaskFromId(")
	})

	it("does not start a second request chain after a manual retry continuation is accepted", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async recursivelyMakeClineRequests(", "async loadContext(")
		const promptBranchStart = method.indexOf("if (retryDecision.shouldPrompt) {")
		const promptBranchEnd = method.indexOf("// needs to happen after the say", promptBranchStart)
		const promptBranch = method.slice(promptBranchStart, promptBranchEnd)

		expect(promptBranchStart).toBeGreaterThanOrEqual(0)
		expect(promptBranchEnd).toBeGreaterThan(promptBranchStart)
		expect(promptBranch).toContain("await this.recoverApiFailure({")
		expect(promptBranch).toContain("return true")
		expect(promptBranch).not.toContain('return outcome.actionId === "start_new_task"')
	})

	it("routes provider operations in attemptApiRequest through the frozen scope", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async *attemptApiRequest(", "// Block identity is now assigned")

		expect(method).toContain("const { api, providerInfo } = requestScope")
		expect(method).toContain("api.createMessage(")
		expect(method).toContain("api.parseError?.(")
		expect(method).not.toMatch(/\bthis\.api\b/)
		expect(method).not.toContain("this.getCurrentProviderInfo()")
	})
})
