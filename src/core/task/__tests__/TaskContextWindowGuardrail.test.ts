import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

const taskSourcePath = path.resolve("src/core/task/index.ts")
const sessionSourcePath = path.resolve("src/core/task/ContextCompactionSession.ts")
function extractMethod(source: string, startMarker: string, endMarker: string): string {
	const start = source.indexOf(startMarker)
	const end = source.indexOf(endMarker, start)
	if (start < 0 || end < 0) {
		throw new Error(`Unable to locate Task context-window boundary: ${startMarker}`)
	}
	return source.slice(start, end)
}

describe("Task context-window final admission guard", () => {
	it("projects the complete ordinary candidate after background injection and before UI or history persistence", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "async recursivelyMakeClineRequests(", "async loadContext(")
		const backgroundIndex = method.indexOf("await this.appendBackgroundResults(userContent)")
		const finalGuardIndex = method.indexOf("await this.evaluateFinalContextWindowGuard(")
		const placeholderIndex = method.indexOf('await this.say(\n\t\t\t\t"api_req_started"')
		const persistenceIndex = method.indexOf("await this.persistApiRequestUserMessage(")

		expect(backgroundIndex).toBeGreaterThanOrEqual(0)
		expect(finalGuardIndex).toBeGreaterThan(backgroundIndex)
		expect(placeholderIndex).toBeGreaterThan(finalGuardIndex)
		expect(persistenceIndex).toBeGreaterThan(finalGuardIndex)
	})

	it("reprojects once after adding high-pressure guidance and caches the exact candidate selected for sending", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(
			source,
			"private async evaluateFinalContextWindowGuard(",
			"private async persistApiRequestUserMessage(",
		)
		const firstProjection = method.indexOf("resolveContextWindowProjection({")
		const warning = method.indexOf("getHighContextPressureWarning({", firstProjection)
		const rebuild = method.indexOf("candidateInput = await buildCandidate()", warning)
		const finalProjection = method.indexOf("resolveContextWindowProjection({", rebuild)
		const cache = method.indexOf("this.preparedOrdinaryProviderInputs.set(apiIndex", finalProjection)

		expect(firstProjection).toBeGreaterThanOrEqual(0)
		expect(warning).toBeGreaterThan(firstProjection)
		expect(rebuild).toBeGreaterThan(warning)
		expect(finalProjection).toBeGreaterThan(rebuild)
		expect(cache).toBeGreaterThan(finalProjection)
	})

	it("adds high-pressure guidance only from the complete final candidate, not the previous request", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const environmentMethod = extractMethod(source, "async getEnvironmentDetails(", "\n\t}\n}")
		const finalGuardMethod = extractMethod(
			source,
			"private async evaluateFinalContextWindowGuard(",
			"private async persistApiRequestUserMessage(",
		)

		expect(environmentMethod).not.toContain("getHighContextPressureWarning({")
		expect(finalGuardMethod).toContain("getHighContextPressureWarning({")
	})

	it("passes the unsent ordinary turn into Session without mutating canonical history first", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const requestMethod = extractMethod(source, "async recursivelyMakeClineRequests(", "async loadContext(")
		const helper = extractMethod(
			source,
			"private async runOrdinaryContextCompaction(",
			"/** Execute one slash-command compaction",
		)
		const finalGuardIndex = requestMethod.indexOf("await this.evaluateFinalContextWindowGuard(")
		const cancelIndex = requestMethod.indexOf("requestScope.explicitInstructions.cancel()", finalGuardIndex)
		const rerouteIndex = requestMethod.indexOf("await this.runOrdinaryContextCompaction(", cancelIndex)

		expect(finalGuardIndex).toBeGreaterThanOrEqual(0)
		expect(cancelIndex).toBeGreaterThan(finalGuardIndex)
		expect(rerouteIndex).toBeGreaterThan(cancelIndex)
		expect(helper).toContain("targetContinuationContent: cloneDeep(ordinaryInput)")
		expect(helper).toContain("ordinaryInput: cloneDeep(ordinaryInput)")
		expect(helper).not.toContain("overwriteApiConversationHistory(")
		expect(helper).not.toContain("conversationHistoryDeletedRange =")
	})

	it("enters automatic compaction without rewriting an already-sent provider prefix", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const requestMethod = extractMethod(source, "async recursivelyMakeClineRequests(", "async loadContext(")
		const pressureDecisionIndex = requestMethod.indexOf("this.contextManager.shouldCompactContextWindow(")
		const compactionRouteIndex = requestMethod.indexOf(
			"if (!persistedRequest && shouldCompact && !manualCompactionRequested)",
			pressureDecisionIndex,
		)

		expect(pressureDecisionIndex).toBeGreaterThanOrEqual(0)
		expect(compactionRouteIndex).toBeGreaterThan(pressureDecisionIndex)
		expect(requestMethod.slice(pressureDecisionIndex, compactionRouteIndex)).not.toContain("attemptFileReadOptimization(")
	})

	it("peeks recently modified files and acknowledges only after an ordinary request reaches a valid first chunk", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const environmentMethod = extractMethod(source, "async getEnvironmentDetails(", "\n\t}\n}")
		const providerMethod = extractMethod(source, "async *attemptApiRequest(", "// Block identity is now assigned")
		const firstChunkIndex = providerMethod.indexOf("if (!firstChunk.done)")
		const ordinaryAckIndex = providerMethod.indexOf("this.acknowledgeOrdinaryRequestSnapshots()", firstChunkIndex)

		expect(environmentMethod).toContain("this.fileContextTracker.peekRecentlyModifiedFiles()")
		expect(environmentMethod).not.toContain("getAndClearRecentlyModifiedFiles()")
		expect(firstChunkIndex).toBeGreaterThanOrEqual(0)
		expect(ordinaryAckIndex).toBeGreaterThan(firstChunkIndex)
		expect(providerMethod.slice(firstChunkIndex, ordinaryAckIndex)).toContain(
			"!this.taskState.isInternalContextCompactionRequest && !this.taskState.isManualContextCompactionRequest",
		)
	})

	it("freezes every admitted ordinary candidate and takes it before provider-input reconstruction", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const guardMethod = extractMethod(
			source,
			"private async evaluateFinalContextWindowGuard(",
			"private async persistApiRequestUserMessage(",
		)
		const requestMethod = extractMethod(source, "async *attemptApiRequest(", "// Block identity is now assigned")
		const cacheIndex = guardMethod.indexOf("this.preparedOrdinaryProviderInputs.set(apiIndex, candidateInput)")
		const preparedIndex = requestMethod.indexOf("this.takePreparedOrdinaryProviderInput(apiIndex)")
		const rebuildIndex = requestMethod.indexOf("this.buildProviderInput(", preparedIndex)
		const sendIndex = requestMethod.indexOf("api.createMessage(", rebuildIndex)

		expect(cacheIndex).toBeGreaterThanOrEqual(0)
		expect(guardMethod).not.toContain('getGlobalSettingsKey("useAutoCondense") && !projection.shouldCompact')
		expect(preparedIndex).toBeGreaterThanOrEqual(0)
		expect(rebuildIndex).toBeGreaterThan(preparedIndex)
		expect(sendIndex).toBeGreaterThan(rebuildIndex)
	})

	it("invalidates prepared and replay inputs before every compaction Session without cloning canonical history", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const invalidator = extractMethod(
			source,
			"private invalidatePreparedProviderInputs(): void",
			"/** Derive the active provider context",
		)
		const ordinary = extractMethod(source, "private async runOrdinaryContextCompaction(", "/** Execute one slash-command")
		const manual = extractMethod(source, "private async runManualContextCompaction(", "/** Freeze the target continuation")
		const transition = extractMethod(source, "async compactForTransition(", "/** Request one user-triggered compaction")
		const taskHeader = extractMethod(source, "public async compactTask(", "/** Apply one explicit legacy history truncation")

		expect(invalidator).toContain("this.preparedOrdinaryProviderInputs.clear()")
		expect(invalidator).toContain("this.compactionRequestReplay.clear()")
		for (const method of [ordinary, manual, transition, taskHeader]) {
			expect(method).toContain("this.invalidatePreparedProviderInputs()")
		}
		expect(source).not.toContain("captureContextCompactionSnapshot")
		expect(source).not.toContain("contextCompactionSnapshots")
		expect(source).not.toContain("restoreContextCompactionMemoryFallback")
	})

	it("rebuilds the complete ordinary target candidate with dynamic context after every accepted Pass", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "private async reprojectContextCompactionTarget(", "/** Finalize the single durable")
		const loadContextIndex = method.indexOf("await this.loadContext(")
		const environmentIndex = method.indexOf("parsedContent.push", loadContextIndex)
		const backgroundIndex = method.indexOf("await this.appendBackgroundResults(parsedContent", environmentIndex)
		const historyIndex = method.indexOf("buildTargetCandidateHistory(", backgroundIndex)
		const providerInputIndex = method.indexOf("this.buildProviderInput(", historyIndex)
		const estimateIndex = method.indexOf("estimateContextWindowCandidate(targetInput,", providerInputIndex)
		const decisionIndex = method.indexOf("decideTargetWindowFitting({", estimateIndex)

		expect(loadContextIndex).toBeGreaterThanOrEqual(0)
		expect(environmentIndex).toBeGreaterThan(loadContextIndex)
		expect(backgroundIndex).toBeGreaterThan(environmentIndex)
		expect(historyIndex).toBeGreaterThan(backgroundIndex)
		expect(providerInputIndex).toBeGreaterThan(historyIndex)
		expect(method).toContain("applyCompactionProjection: false")
		expect(estimateIndex).toBeGreaterThan(providerInputIndex)
		expect(decisionIndex).toBeGreaterThan(estimateIndex)
		expect(method).not.toContain("getContextWindowRequestPressures(")
	})

	it("projects explicit Profile and Mode transitions from reliable pressure plus the complete target candidate", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(
			source,
			"private async projectContextTransitionTargetUsage(",
			"/** Create the sole Task-local execution boundary",
		)
		const estimateIndex = method.indexOf("estimateContextWindowCandidate(providerInput, {")
		const pressureIndex = method.indexOf("this.getContextWindowRequestPressures()", estimateIndex)
		const projectionIndex = method.indexOf("resolveContextWindowProjection({", estimateIndex)
		const resultIndex = method.indexOf("projectedUsageTokens", projectionIndex)

		expect(estimateIndex).toBeGreaterThanOrEqual(0)
		expect(pressureIndex).toBeGreaterThan(estimateIndex)
		expect(projectionIndex).toBeGreaterThan(estimateIndex)
		expect(resultIndex).toBeGreaterThan(projectionIndex)
	})

	it("keeps fitting inside one Session and resumes the protected ordinary continuation only after completion", async () => {
		const [taskSource, sessionSource] = await Promise.all([
			readFile(taskSourcePath, "utf8"),
			readFile(sessionSourcePath, "utf8"),
		])
		const requestMethod = extractMethod(taskSource, "async recursivelyMakeClineRequests(", "async loadContext(")
		const decisionIndex = sessionSource.indexOf("const decision = projection")
		const completeIndex = sessionSource.indexOf('if (decision.status === "complete")', decisionIndex)
		const commitIndex = sessionSource.indexOf("await this.ports.commit(input, state)", completeIndex)
		const exhaustedIndex = sessionSource.indexOf('if (decision.status === "exhausted")', commitIndex)
		const resumeIndex = requestMethod.indexOf("return this.recursivelyMakeClineRequests(originalUserContent")

		expect(decisionIndex).toBeGreaterThanOrEqual(0)
		expect(completeIndex).toBeGreaterThan(decisionIndex)
		expect(commitIndex).toBeGreaterThan(completeIndex)
		expect(exhaustedIndex).toBeGreaterThan(commitIndex)
		expect(resumeIndex).toBeGreaterThanOrEqual(0)
		expect(requestMethod).not.toContain("runTargetWindowFittingPass(")
	})

	it("executes rolling fitting through the Session before ordinary UI or history persistence", async () => {
		const [taskSource, sessionSource] = await Promise.all([
			readFile(taskSourcePath, "utf8"),
			readFile(sessionSourcePath, "utf8"),
		])
		const requestMethod = extractMethod(taskSource, "async recursivelyMakeClineRequests(", "async loadContext(")
		const sessionCall = requestMethod.indexOf("await this.runOrdinaryContextCompaction(")
		const apiStartedIndex = requestMethod.indexOf('await this.say(\n\t\t\t\t"api_req_started"')
		const persistenceIndex = requestMethod.indexOf("await this.persistApiRequestUserMessage(")

		expect(sessionCall).toBeGreaterThanOrEqual(0)
		expect(sessionCall).toBeLessThan(apiStartedIndex)
		expect(sessionCall).toBeLessThan(persistenceIndex)
		expect(sessionSource).toContain("runInternalCompactionPassWithRetry({")
		expect(sessionSource).not.toContain("compactionRequestReplay")
	})

	it("commits one durable compaction card without overwriting canonical API history or deleted range", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const commit = extractMethod(
			source,
			"private async commitContextCompaction(",
			"/** Present a terminal automatic-compaction failure",
		)

		expect(commit).toContain("createCompactionConversationRange(state")
		expect(commit).toContain("commitTransientClineMessage(")
		expect(commit).toContain("this.taskState.targetWindowFittingCommitted = true")
		expect(commit).not.toContain("overwriteApiConversationHistory(")
		expect(commit).not.toContain("flushApiConversationHistory(")
		expect(commit).not.toContain("replaceAll(")
		expect(commit).not.toContain("conversationHistoryDeletedRange =")
	})

	it("publishes terminal Session failure without rollback or canonical writes", async () => {
		const sessionSource = await readFile(sessionSourcePath, "utf8")
		const failedIndex = sessionSource.indexOf('await this.ports.publish(input, { kind: "failed"')

		expect(failedIndex).toBeGreaterThanOrEqual(0)
		expect(sessionSource).not.toContain("rollback")
		expect(sessionSource).not.toContain("checkpoint")
	})

	it("presents terminal ordinary compaction failure without treating cancellation as failure", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const requestMethod = extractMethod(source, "async recursivelyMakeClineRequests(", "async loadContext(")
		const presenter = extractMethod(
			source,
			"private async presentTerminalCompactionFailure(",
			"/** Publish one Session Pass lifecycle",
		)

		expect(source).toContain("this.contextCompactionFailureReasons.set(input.operationId, event.error)")
		expect(source).toContain("private readonly contextCompactionRetryProgress = new Map")
		expect(presenter).toContain("this.contextCompactionRetryProgress.get(operationId)")
		expect(presenter).toContain("if (retriesExhausted)")
		expect(presenter).toContain('"error_retry"')
		expect(presenter).toContain("failed: true")
		expect(presenter).toContain("await this.recoverApiFailure({")
		expect(requestMethod.match(/if \(result === "failed"\)/g)).toHaveLength(2)
		expect(requestMethod.match(/if \(result === "cancelled"\) return true/g)).toHaveLength(2)
		expect(requestMethod.match(/if \(result !== "completed"\) return true/g)).toHaveLength(1)
	})

	it("does not keep or replay unsent ordinary input outside the Session input", async () => {
		const source = await readFile(taskSourcePath, "utf8")

		expect(source).not.toContain("pendingAutomaticCompactionContinuation")
		expect(source).not.toContain("Automatic compaction continuation is missing")
	})

	it("stages an accepted Pass before publishing its transient completion", async () => {
		const sessionSource = await readFile(sessionSourcePath, "utf8")
		const summaryIndex = sessionSource.indexOf('kind: "pass_partial"')
		const stageIndex = sessionSource.indexOf("await this.ports.stageAcceptedPass", summaryIndex)
		const completeIndex = sessionSource.indexOf('kind: "pass_completed"', stageIndex)

		expect(summaryIndex).toBeGreaterThanOrEqual(0)
		expect(stageIndex).toBeGreaterThan(summaryIndex)
		expect(completeIndex).toBeGreaterThan(stageIndex)
		expect(sessionSource).not.toContain("checkpointAcceptedPass")
	})

	it("routes shared Session events through the per-Pass presentation owner without creating a started row", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const method = extractMethod(source, "private async publishContextCompactionEvent(", "/** Wait for one Pass retry")
		const startedBranch = method.slice(method.indexOf('case "pass_started"'), method.indexOf('case "pass_partial"'))

		expect(source).toContain("private readonly contextCompactionPresentation = new ContextCompactionPresentation()")
		expect(startedBranch).toContain("this.contextCompactionPresentation.startPass(event.passIdentity, event.attempt)")
		expect(startedBranch).not.toContain("updateContextCompactionStatus")
		expect(startedBranch).not.toContain("this.say(")
		expect(method).toContain("this.contextCompactionPresentation.partial(")
		expect(method).toContain("this.contextCompactionPresentation.retry(")
		expect(method).toContain("this.contextCompactionPresentation.complete(")
		expect(method).toContain("this.contextCompactionPresentation.fail(input.operationId, event.error)")
		expect(method).toContain("this.publishContextCompactionSnapshot(input, snapshot)")
		expect(method).toContain("upsertTransientClineMessage(message)")
		expect(method).toContain("removeTransientClineMessage(snapshot.existingTs)")
		const highFrequencyReturn = method.indexOf('if (event.kind === "pass_receiving" || event.kind === "pass_partial") return')
		const fullStatePost = method.indexOf("await this.postStateToWebview()", highFrequencyReturn)
		expect(highFrequencyReturn).toBeGreaterThanOrEqual(0)
		expect(fullStatePost).toBeGreaterThan(highFrequencyReturn)
		expect(method).not.toContain("contextCompactionMessageTs")
	})

	it("admits the committed target continuation once without re-triggering compaction on stale usage", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const requestMethod = extractMethod(source, "async recursivelyMakeClineRequests(", "async loadContext(")
		const consumeIndex = requestMethod.indexOf(
			"const targetWindowFittingCommitted = !persistedRequest && this.taskState.targetWindowFittingCommitted",
		)
		const resetIndex = requestMethod.indexOf("this.taskState.targetWindowFittingCommitted = false", consumeIndex)
		const automaticGateIndex = requestMethod.indexOf("(!targetWindowFittingCommitted &&", resetIndex)
		const finalGuardIndex = requestMethod.indexOf("!targetWindowFittingCommitted &&", automaticGateIndex + 1)
		const commitStart = source.indexOf("private async commitContextCompaction(")
		const committedAssignment = source.indexOf("this.taskState.targetWindowFittingCommitted = true", commitStart)

		expect(consumeIndex).toBeGreaterThanOrEqual(0)
		expect(resetIndex).toBeGreaterThan(consumeIndex)
		expect(automaticGateIndex).toBeGreaterThan(resetIndex)
		expect(finalGuardIndex).toBeGreaterThan(automaticGateIndex)
		expect(commitStart).toBeGreaterThanOrEqual(0)
		expect(committedAssignment).toBeGreaterThan(commitStart)
	})

	it("does not route Provider context errors through legacy truncation when auto-condense is enabled", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const requestMethod = extractMethod(source, "async *attemptApiRequest(", "// Block identity is now assigned")
		const contextErrorBranch = extractMethod(
			source,
			"private async handleContextWindowExceededError(",
			"/**\n\t * Build the current system prompt",
		)

		expect(requestMethod).toContain('const autoCondenseEnabled = this.stateManager.getGlobalSettingsKey("useAutoCondense")')
		expect(requestMethod).toContain("if (")
		expect(requestMethod).toContain("isContextWindowExceededError")
		expect(requestMethod).toContain("!autoCondenseEnabled")
		expect(requestMethod).toContain("!this.taskState.didAutomaticallyRetryFailedApiRequest")
		expect(contextErrorBranch).toContain("getNextTruncationRange(")
	})

	it("keeps legacy truncation behind the explicit Task-owned force-truncate operation", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const forceTruncateMethod = extractMethod(
			source,
			"public async forceTruncateTask(",
			"/** Settle the completed compaction projection",
		)
		const truncationHelper = extractMethod(
			source,
			"private async handleContextWindowExceededError(",
			"/**\n\t * Build the current system prompt",
		)

		const truncateIndex = forceTruncateMethod.indexOf('await this.handleContextWindowExceededError(this.api, false, "none")')
		const committedIndex = forceTruncateMethod.indexOf(
			"this.taskState.manualHistoryTruncationCommitted = true",
			truncateIndex,
		)
		const acceptedIndex = forceTruncateMethod.indexOf('return { accepted: true, result: "accepted" }', committedIndex)
		const historyIndex = truncationHelper.indexOf("await this.messageStateHandler.updateTaskHistory()")
		const noticeIndex = truncationHelper.indexOf(
			"await this.contextManager.triggerApplyStandardContextTruncationNoticeChange(",
			historyIndex,
		)

		expect(truncateIndex).toBeGreaterThanOrEqual(0)
		expect(forceTruncateMethod).toContain('handleContextWindowExceededError(this.api, false, "none")')
		expect(committedIndex).toBeGreaterThan(truncateIndex)
		expect(acceptedIndex).toBeGreaterThan(committedIndex)
		expect(truncationHelper).toContain("getNextTruncationRange(")
		expect(truncationHelper).toContain('"quarter"')
		expect(historyIndex).toBeGreaterThanOrEqual(0)
		expect(noticeIndex).toBeGreaterThan(historyIndex)
		expect(truncationHelper).toContain("if (markAutomaticRetry)")
	})

	it("consumes the manual history-truncation admission exactly once and skips both auto-compaction gates", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const requestMethod = extractMethod(source, "async recursivelyMakeClineRequests(", "async loadContext(")
		const consumeIndex = requestMethod.indexOf(
			"const manualHistoryTruncationCommitted = !persistedRequest && this.taskState.manualHistoryTruncationCommitted",
		)
		const resetIndex = requestMethod.indexOf("this.taskState.manualHistoryTruncationCommitted = false", consumeIndex)
		const automaticGateIndex = requestMethod.indexOf("!manualHistoryTruncationCommitted &&", resetIndex)
		const finalGateIndex = requestMethod.indexOf("!manualHistoryTruncationCommitted", automaticGateIndex + 1)

		expect(consumeIndex).toBeGreaterThanOrEqual(0)
		expect(resetIndex).toBeGreaterThan(consumeIndex)
		expect(automaticGateIndex).toBeGreaterThan(resetIndex)
		expect(finalGateIndex).toBeGreaterThan(automaticGateIndex)
	})
})
