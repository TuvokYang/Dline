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

	it("lets an explicit manual compaction command reach slash-command parsing before auto compaction", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async recursivelyMakeClineRequests(", "async loadContext(")
		const manualIntentIndex = method.indexOf("hasManualCompactionIntent(userContent,")
		const autoCompactionIndex = method.indexOf("this.contextManager.shouldCompactContextWindow(")

		expect(manualIntentIndex).toBeGreaterThanOrEqual(0)
		expect(autoCompactionIndex).toBeGreaterThan(manualIntentIndex)
		expect(method).toContain("!manualCompactionRequested")
	})

	it("does not compact a restored tool-result transaction before its durable admission boundary", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async recursivelyMakeClineRequests(", "async loadContext(")
		const compactionCapability = method.indexOf(
			"const canCompactBeforeAdmission = !persistedRequest && transaction.beforeApiRequestStarted === undefined",
		)
		const compactionGate = method.indexOf("canCompactBeforeAdmission &&")
		const deferredTurnCall = method.indexOf("shouldDeferCurrentTurn({")

		expect(compactionCapability).toBeGreaterThanOrEqual(0)
		expect(compactionGate).toBeGreaterThan(compactionCapability)
		expect(deferredTurnCall).toBeGreaterThan(compactionGate)
	})

	it("parses manual compaction only from canonically paired conversational tool feedback", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async loadContext(", "async getEnvironmentDetails(")
		const toolResultBranchStart = method.indexOf('if (block.type === "tool_result")')
		const toolResultBranch = method.slice(toolResultBranchStart)
		const trustedBranchEnd = toolResultBranch.indexOf("// Handle string content")
		const trustedBranch = toolResultBranch.slice(0, trustedBranchEnd)
		const untrustedBranch = toolResultBranch.slice(trustedBranchEnd)

		expect(toolResultBranchStart).toBeGreaterThanOrEqual(0)
		expect(trustedBranch).toContain("this.isTrustedUserFeedbackResult(block)")
		expect(trustedBranch).toContain("hasManualCompactionIntent([block], () => true)")
		expect(trustedBranch).toContain("parseTextBlock(block.content)")
		expect(untrustedBranch).toContain("parseMentions(")
		expect(untrustedBranch).not.toContain("parseTextBlock(")
	})

	it("pairs trusted feedback by canonical identities and conversational tool admission", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(
			source,
			"private isTrustedUserFeedbackResult(",
			"private async persistApiRequestUserMessage(",
		)

		expect(method).toContain("candidate.function_id === block.function_id")
		expect(method).toContain("candidate.dline_tid === block.dline_tid")
		expect(method).toContain("CONVERSATIONAL_TOOL_NAMES.has")
	})

	it("resumes a durable Hosted request without repeating preprocessing, history append, or approval", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async recursivelyMakeClineRequests(", "async loadContext(")
		const persistedIndex = method.indexOf("const persistedRequestApiIndex = transaction.persistedRequestApiIndex")
		const tailValidation = method.indexOf("apiIndex !== this.messageStateHandler.apiConversationHistory.length - 1")
		const newRequestPlaceholder = method.indexOf("if (!persistedRequest) {\n\t\t\tawait this.say(")
		const gateSelection = method.indexOf("const requestApproved = persistedRequest")

		expect(persistedIndex).toBeGreaterThanOrEqual(0)
		expect(tailValidation).toBeGreaterThan(persistedIndex)
		expect(newRequestPlaceholder).toBeGreaterThan(tailValidation)
		expect(gateSelection).toBeGreaterThan(newRequestPlaceholder)
		expect(method).toContain("? true\n\t\t\t: await this.persistApiRequestUserMessage(")
		expect(method).toContain("if (persistedRequest) {\n\t\t\tparsedUserContent = userContent")
		expect(method).toContain("if (!persistedRequest && !shouldCompact)")
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

	it("resolves the compaction output budget from the complete provider candidate before sending", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async *attemptApiRequest(", "// Block identity is now assigned")
		const resolveIndex = method.indexOf("resolveCompactionWindowBudget({")
		const recordIndex = method.indexOf("recordProviderAdapterInput(")
		const sendIndex = method.indexOf("api.createMessage(")

		expect(resolveIndex).toBeGreaterThanOrEqual(0)
		expect(recordIndex).toBeGreaterThan(resolveIndex)
		expect(sendIndex).toBeGreaterThan(resolveIndex)
		expect(method).toContain("serverTools")
		expect(method).toContain("providerInfo.model.info.capabilities?.maxTokens")
	})

	it("registers every orchestrated compaction internally and sends the existing prompt unchanged", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async recursivelyMakeClineRequests(", "async loadContext(")
		const registrationStart = method.indexOf("requestScope.explicitInstructions.register({")
		const promptStart = method.indexOf("const summaryPrompt = summarizeTask(", registrationStart)
		const pushStart = method.indexOf('userContent.push({ type: "text", text: summaryPrompt })', promptStart)
		const registration = method.slice(registrationStart, pushStart)

		expect(registrationStart).toBeGreaterThanOrEqual(0)
		expect(promptStart).toBeGreaterThan(registrationStart)
		expect(pushStart).toBeGreaterThan(promptStart)
		expect(registration).toContain('type: "summarize_task"')
		expect(registration).toContain("targetTool: ClineDefaultTool.SUMMARIZE_TASK")
		expect(registration).not.toContain("ClineDefaultTool.CONDENSE")
		expect(registration).not.toContain("instruction_id")
	})

	it("maps automatic, Header, and mode-switch compaction to source metadata only", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async recursivelyMakeClineRequests(", "async loadContext(")
		const operationStart = method.indexOf("const operationId = this.modeSwitchCompaction.getOperationId()")
		const registrationStart = method.indexOf("requestScope.explicitInstructions.register({", operationStart)
		const sourceProjection = method.slice(operationStart, registrationStart)

		expect(operationStart).toBeGreaterThanOrEqual(0)
		expect(sourceProjection).toContain('? "task_header"')
		expect(sourceProjection).toContain('? "mode_switch"')
		expect(sourceProjection).toContain(': "auto_compaction"')
	})

	it("does not project internal authorization IDs into provider messages", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async *attemptApiRequest(", "// Block identity is now assigned")

		expect(method).not.toContain("rewriteProviderInstructionIds(")
		expect(method).not.toContain("rewriteInstructionIds")
		expect(method).not.toContain("instruction_id")
	})

	it("creates a stable compaction row before the provider can fail without producing a tool call", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async recursivelyMakeClineRequests(", "async loadContext(")
		const rowIndex = method.indexOf("ensureContextCompactionStatusRow(")
		const requestIndex = method.indexOf('"api_req_started"', rowIndex)

		expect(rowIndex).toBeGreaterThanOrEqual(0)
		expect(requestIndex).toBeGreaterThan(rowIndex)
	})

	it("updates the same compaction row from the existing retry owner", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async recursivelyMakeClineRequests(", "async loadContext(")
		const retryBranchStart = method.indexOf("if (retryDecision.shouldRetry) {")
		const retryBranchEnd = method.indexOf("if (retryDecision.shouldPrompt) {", retryBranchStart)
		const retryBranch = method.slice(retryBranchStart, retryBranchEnd)
		const promptBranchEnd = method.indexOf("// needs to happen after the say", retryBranchEnd)
		const promptBranch = method.slice(retryBranchEnd, promptBranchEnd)

		expect(retryBranch).toContain('updateContextCompactionStatus("retrying"')
		expect(promptBranch).toContain('updateContextCompactionStatus("failed"')
		expect(retryBranch).toContain("this.scheduleAutoRetry(")
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

	it("closes or cancels explicit authority at every terminal request boundary", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async recursivelyMakeClineRequests(", "async loadContext(")
		const approvalBranch = method.indexOf("if (!requestApproved) {")
		const normalClose = method.lastIndexOf("requestScope.explicitInstructions.close()")
		const errorCancel = method.lastIndexOf("requestScope.explicitInstructions.cancel()")

		expect(approvalBranch).toBeGreaterThanOrEqual(0)
		expect(method.slice(approvalBranch, approvalBranch + 160)).toContain("requestScope.explicitInstructions.cancel()")
		expect(normalClose).toBeGreaterThan(approvalBranch)
		expect(errorCancel).toBeGreaterThan(normalClose)
	})

	it("starts explicit instruction authority at the provider boundary and rolls retry attempts", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async *attemptApiRequest(", "// Block identity is now assigned")
		const beginAttemptIndex = method.indexOf("requestScope.explicitInstructions.beginProviderAttempt(")
		const consumePortIndex = method.indexOf("requestScope.explicitInstructions.createConsumePort()")
		const sendIndex = method.indexOf("api.createMessage(")

		expect(beginAttemptIndex).toBeGreaterThanOrEqual(0)
		expect(consumePortIndex).toBeGreaterThan(beginAttemptIndex)
		expect(sendIndex).toBeGreaterThan(consumePortIndex)
		expect(method).not.toContain("rewriteProviderInstructionIds(")
		expect(method).not.toContain("instruction_id")
		expect(method).toContain("providerAttempt + 1")
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

	it("passes the frozen hosted tools to every request without a control-tool branch", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async *attemptApiRequest(", "// Block identity is now assigned")

		expect(method).toContain("const serverTools = requestScope.webSearchRoutingPlan.serverTools")
		expect(method).toContain("api.createMessage(systemPrompt, apiConversationMessages, tools, { serverTools })")
		expect(method).not.toContain("requestToolIds")
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
		expect(requestMethod).toContain(
			"this.toolExecutor.setWebSearchRoutingPlan(requestScope.webSearchRoutingPlan, requestScope.webToolsEnabled)",
		)
		expect(requestMethod).not.toContain("requestToolIds")
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
