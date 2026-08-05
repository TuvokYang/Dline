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

	it("prepares forced truncation only after deferring the current tool turn", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async recursivelyMakeClineRequests(", "async loadContext(")
		const deferredTurnCall = method.indexOf("shouldCompact = await this.deferCurrentTurn(userContent)")
		const forcedTruncationCall = method.indexOf("await this.prepareModeSwitchCompaction(")

		expect(deferredTurnCall).toBeGreaterThanOrEqual(0)
		expect(forcedTruncationCall).toBeGreaterThan(deferredTurnCall)
	})

	it("drops all completed middle turns before a forced source-mode summary", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "private async prepareModeSwitchCompaction(", "/** Merge a confirmation-owned draft")

		expect(method).toContain('"none"')
		expect(method).not.toContain('"lastTwo"')
	})

	it("restores the deferred tool turn before releasing the mode-switch commit barrier", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async recursivelyMakeClineRequests(", "async loadContext(")
		const restoreCall = method.indexOf("await this.restoreDeferredTurn(userContent)")
		const markAppliedCall = method.indexOf("await this.modeSwitchCompaction.markApplied()")

		expect(restoreCall).toBeGreaterThanOrEqual(0)
		expect(markAppliedCall).toBeGreaterThan(restoreCall)
	})

	it("preserves a prepared mode-compaction tail across the context-length retry", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(
			source,
			"private async handleContextWindowExceededError(",
			"/**\n\t * Build the current system prompt",
		)

		expect(method).toContain(
			"if (!(this.modeSwitchCompaction.shouldForce() && this.taskState.conversationHistoryDeletedRange))",
		)
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
		expect(retryBranch).toContain("this.scheduleAutoRetry(")
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

	it("passes the frozen hosted tools to ordinary requests and disables them for internal compaction", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async *attemptApiRequest(", "// Block identity is now assigned")

		expect(method).toContain("requestScope.requestToolIds.length > 0 ? [] : requestScope.webSearchRoutingPlan.serverTools")
		expect(method).toContain("api.createMessage(systemPrompt, apiConversationMessages, tools, { serverTools })")
	})

	it("uses the request-frozen Web Tools switch for the prompt and ToolExecutor", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const promptMethod = extractMethod(source, "private async buildPromptContext(", "async *attemptApiRequest(")
		const requestMethod = extractMethod(source, "async *attemptApiRequest(", "// Block identity is now assigned")

		expect(promptMethod).toContain("clineWebToolsEnabled: webToolsEnabled")
		expect(promptMethod).not.toContain('getGlobalSettingsKey("clineWebToolsEnabled")')
		expect(requestMethod).toMatch(
			/this\.buildPromptContext\(\s*providerInfo,\s*requestScope\.webToolsEnabled,\s*requestScope\.webSearchRoutingPlan,?\s*\)/,
		)
		expect(requestMethod).toMatch(
			/this\.toolExecutor\.setWebSearchRoutingPlan\(\s*requestScope\.webSearchRoutingPlan,\s*requestScope\.webToolsEnabled,\s*requestScope\.requestToolIds\.length === 0,?\s*\)/,
		)
	})

	it("uses the dedicated browser capability before the legacy image fallback", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "private async buildPromptContext(", "async *attemptApiRequest(")

		expect(method).toContain("capabilities?.supportsBrowserAction ??")
		expect(method).toContain("capabilities?.supportsImages ??")
		expect(method.indexOf("supportsBrowserAction")).toBeLessThan(method.indexOf("supportsImages"))
	})

	it("classifies user cancellation before reporting either API request failure boundary", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const firstChunkBoundary = extractMethod(source, "async *attemptApiRequest(", "// Block identity is now assigned")
		const iteratorStart = firstChunkBoundary.indexOf("const iterator = stream[Symbol.asyncIterator]()")
		const firstChunkCatchStart = firstChunkBoundary.indexOf("} catch (error) {", iteratorStart)
		const firstChunkCatch = firstChunkBoundary.slice(
			firstChunkCatchStart,
			firstChunkBoundary.indexOf("const isContextWindowExceededError", firstChunkCatchStart),
		)
		const streamingBoundary = extractMethod(source, "async recursivelyMakeClineRequests(", "async loadContext(")
		const streamingStop = streamingBoundary.indexOf("await streamCoordinator?.stop()")
		const streamingCatchStart = streamingBoundary.lastIndexOf("} catch (error) {", streamingStop)
		const streamingCatch = streamingBoundary.slice(
			streamingCatchStart,
			streamingBoundary.indexOf("if (!this.taskState.abandoned)", streamingCatchStart),
		)

		expect(iteratorStart).toBeGreaterThanOrEqual(0)
		expect(firstChunkCatchStart).toBeGreaterThan(iteratorStart)
		expect(firstChunkCatch).toContain("if (this.taskState.abort)")
		expect(firstChunkCatch.indexOf("if (this.taskState.abort)")).toBeLessThan(
			firstChunkBoundary.indexOf("ErrorService.get()", firstChunkCatchStart),
		)
		expect(streamingCatchStart).toBeGreaterThanOrEqual(0)
		expect(streamingCatch).toContain("if (this.taskState.abort)")
	})
})
