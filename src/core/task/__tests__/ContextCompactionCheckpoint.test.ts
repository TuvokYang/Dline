import type { ApiHandler } from "@core/api"
import { indexLogicalTurns } from "@core/context/context-management/logical-turns"
import {
	acceptCompactionPass,
	applyCompactionPassPlan,
	startTargetWindowFitting,
} from "@core/context/context-management/target-window-fitting"
import { describe, expect, it } from "vitest"
import {
	createContextCompactionCheckpointPayload,
	createContextCompactionScopeIdentity,
	createLegacyIndicatorCheckpoint,
} from "../ContextCompactionCheckpoint"

function history() {
	return [
		{ role: "user" as const, content: [{ type: "text" as const, text: "turn one" }] },
		{ role: "assistant" as const, content: [{ type: "text" as const, text: "answer one" }] },
		{ role: "user" as const, content: [{ type: "text" as const, text: "turn two" }] },
		{ role: "assistant" as const, content: [{ type: "text" as const, text: "answer two" }] },
	]
}

function api(providerId: string, modelId: string, contextWindow: number): ApiHandler {
	return {
		createMessage: async function* () {},
		getModel: () => ({ id: modelId, info: { id: modelId, capabilities: { contextWindow } } }),
		getProviderId: () => providerId,
	}
}

function initialState() {
	return startTargetWindowFitting(indexLogicalTurns(history()), "operation-1")
}

function runtimeSnapshot() {
	return {
		version: 2 as const,
		taskId: "task-1",
		phase: "idle" as never,
		apiIndex: 3,
		timestamp: 100,
		revision: 7,
		anchor: { apiIndex: 3 },
	}
}

describe("ContextCompactionCheckpoint", () => {
	it("materializes a complete C0 and isolates it from later runtime mutations", () => {
		const fittingState = initialState()
		const canonicalHistory = history()
		const ordinaryInput = [{ type: "text" as const, text: "draft input" }]
		const protectedContinuation = [{ type: "text" as const, text: "protected continuation" }]
		const recentlyModifiedFiles = { files: ["src/a.ts"], revisions: { "src/a.ts": 3 } }
		const sourceScope = createContextCompactionScopeIdentity(api("deepseek", "deepseek-v4", 1_000_000), "act", "large")
		const targetScope = createContextCompactionScopeIdentity(api("openai", "gpt-small", 272_000), "act", "small")
		const indicator = createLegacyIndicatorCheckpoint(
			[
				{ estimatedContextTokens: 400_000, contextTokensSource: "estimate" },
				{ contextTokens: 350_000, contextTokensSource: "provider" },
			],
			sourceScope.contextWindow,
		)
		const payload = createContextCompactionCheckpointPayload({
			kind: "root",
			taskId: "task-1",
			operationId: "operation-1",
			trigger: "profile_switch",
			canonicalHistory,
			conversationHistoryDeletedRange: [1, 2],
			fittingState,
			protectedContinuation,
			ordinaryInput,
			uiMessageBoundary: { count: 4, lastMessageTs: 400 },
			runtimeSnapshot: runtimeSnapshot(),
			manualState: {
				pendingManualCompactionContinuation: { text: "feedback", images: [], files: [] },
			},
			oneShotState: { recentlyModifiedFiles },
			transition: {
				kind: "profile_switch",
				operationId: "operation-1",
				phase: "compacting",
				source: { mode: "act", profile: "large", contextWindow: 1_000_000 },
				target: { mode: "act", profile: "small", contextWindow: 272_000 },
				targetModes: ["act"],
				chatContent: { message: "draft", images: [], files: [] },
			},
			sourceScope,
			targetScope,
			indicator,
		})

		canonicalHistory[0].content = []
		ordinaryInput[0].text = "mutated"
		protectedContinuation[0].text = "mutated"
		recentlyModifiedFiles.files.push("src/b.ts")

		expect(payload).toMatchObject({
			kind: "root",
			taskId: "task-1",
			operationId: "operation-1",
			conversationHistoryDeletedRange: [1, 2],
			materializedDeletedRange: [1, 2],
			ordinaryInput: [{ type: "text", text: "draft input" }],
			protectedContinuation: [{ type: "text", text: "protected continuation" }],
			manualState: { pendingManualCompactionContinuation: { text: "feedback" } },
			oneShotState: { recentlyModifiedFiles: { files: ["src/a.ts"] } },
			transition: { source: { profile: "large" }, target: { profile: "small" } },
			indicator: {
				durableContextTokens: 350_000,
				pendingSendTokens: 0,
				receivingTokens: 0,
				environmentTokens: 0,
			},
		})
		expect(payload.materializedHistory).toEqual(history())
		expect(payload.canonicalCommitHistory).toEqual(history())
		expect(payload.canonicalCommitDeletedRange).toEqual([1, 2])
		expect(payload.fittingState.turns).toHaveLength(2)
		expect(payload.sourceScope.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)
		expect(payload.targetScope.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)
		expect(JSON.stringify(payload)).not.toContain("apiKey")
	})

	it("materializes target-only continuation while committing protected history without the pending user turn", () => {
		const planned = applyCompactionPassPlan(initialState(), {
			operationId: "operation-1",
			passIndex: 0,
			passStartTurnIndex: 0,
			passEndTurnIndex: 0,
			coveredTurnCount: 0,
			summaryBaselineHash: initialState().summaryBaselineHash,
			passHistoryHash: "sha256:history",
			estimatedInputTokens: 100,
			passInputCeiling: 1_000,
		})
		const accepted = acceptCompactionPass(planned, "cumulative summary").state
		const scope = createContextCompactionScopeIdentity(api("deepseek", "deepseek-v4", 272_000), "act", "profile")
		const protectedHistory = [
			{ role: "assistant" as const, content: [{ type: "text" as const, text: "protected assistant tail" }] },
		]
		const payload = createContextCompactionCheckpointPayload({
			kind: "pass",
			taskId: "task-1",
			operationId: "operation-1",
			trigger: "task_header",
			canonicalHistory: history(),
			conversationHistoryDeletedRange: [1, 2],
			fittingState: accepted,
			protectedHistory,
			protectedContinuation: [{ type: "text", text: "pending draft" }],
			ordinaryInput: [],
			uiMessageBoundary: { count: 5, lastMessageTs: 500 },
			runtimeSnapshot: runtimeSnapshot(),
			manualState: {},
			oneShotState: { recentlyModifiedFiles: { files: [], revisions: {} } },
			sourceScope: scope,
			targetScope: scope,
			indicator: createLegacyIndicatorCheckpoint([], scope.contextWindow),
		})

		expect(payload.materializedHistory).toEqual([
			{ role: "user", content: [{ type: "text", text: "cumulative summary" }] },
			...history().slice(2),
			...protectedHistory,
			{ role: "user", content: [{ type: "text", text: "pending draft" }] },
		])
		expect(payload.materializedDeletedRange).toBeUndefined()
		expect(payload.canonicalCommitHistory).toEqual([
			{ role: "user", content: [{ type: "text", text: "cumulative summary" }] },
			...history().slice(2),
			...protectedHistory,
		])
		expect(payload.canonicalCommitDeletedRange).toBeUndefined()
	})
})
