import { resolveWebSearchRoutingPlan } from "@core/api/server-tools"
import { ToolPromptGenerator } from "@core/prompts/generators/ToolPromptGenerator"
import type { RequestApiScope } from "@core/task/RequestApiScope"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ErrorService } from "@/services/error"
import { Task } from "../index"

vi.mock("@core/storage/disk", async (importOriginal) => {
	const original = await importOriginal<typeof import("@core/storage/disk")>()
	return {
		...original,
		appendApiConversationEvent: vi.fn(async () => undefined),
		ensureTaskDirectoryExists: vi.fn(async () => "test-task-directory"),
	}
})

describe("Task.attemptApiRequest first chunk state", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("keeps the request Web Tools switch frozen while setup awaits and clears first-chunk state on failure", async () => {
		const connectionError = new Error("connection dropped before first chunk")
		let liveWebToolsEnabled = true
		const api = {
			createMessage: vi.fn(() =>
				(async function* () {
					throw connectionError
				})(),
			),
		}
		const requestScope = {
			api,
			providerInfo: {
				providerId: "deepseek",
				model: { id: "deepseek-v4-pro", info: {} },
				mode: "act",
			},
			requestToolIds: [],
			webToolsEnabled: true,
			webSearchRoutingPlan: resolveWebSearchRoutingPlan({
				enabled: true,
				modelInfo: undefined,
				selectedApiFormat: undefined,
				localAvailable: true,
				remoteAdapterAvailable: false,
			}),
		} as unknown as RequestApiScope
		const taskState = {
			abort: false,
			apiRequestCount: 1,
			autoRetryAttempts: 3,
			conversationHistoryDeletedRange: undefined,
			didAutomaticallyRetryFailedApiRequest: false,
			isWaitingForFirstChunk: false,
		}
		const conversationHistory = [{ role: "user" as const, content: "hello" }]
		const clineError = {
			message: "Connection error.",
			isErrorType: vi.fn(() => false),
			serialize: vi.fn(() => '{"message":"Connection error."}'),
		}
		vi.spyOn(ErrorService, "get").mockReturnValue({
			logMessage: vi.fn(),
			toClineError: vi.fn(() => clineError),
		} as unknown as ErrorService)
		vi.spyOn(ToolPromptGenerator.prototype, "generateToolsForRequest").mockReturnValue(undefined)

		const fakeTask = {
			taskId: "task-first-chunk-failure",
			taskState,
			pendingSystemPromptRefreshReason: undefined,
			buildPromptContext: vi.fn(async (_providerInfo, webToolsEnabled, webSearchRoutingPlan) => {
				await Promise.resolve()
				liveWebToolsEnabled = false
				return { promptProfile: {}, clineWebToolsEnabled: webToolsEnabled, webSearchRoutingPlan }
			}),
			buildThinkingSummary: vi.fn(() => undefined),
			contextManager: {
				getNewContextMessagesAndMetadata: vi.fn(async () => ({
					truncatedConversationHistory: conversationHistory,
				})),
			},
			endAutoRetrySequence: vi.fn(),
			messageStateHandler: {
				apiConversationHistory: conversationHistory,
				clineMessages: [],
			},
			modeSwitchCompaction: { shouldForce: vi.fn(() => false) },
			stateManager: {
				getApiConfiguration: vi.fn(() => ({ actModeProfile: "deepseek:deepseek-v4-pro" })),
				getGlobalSettingsKey: vi.fn((key: string) => (key === "clineWebToolsEnabled" ? liveWebToolsEnabled : false)),
			},
			systemPromptCacheService: {
				getLastTools: vi.fn(() => undefined),
				getOrCreate: vi.fn(async () => ({ text: "system prompt" })),
			},
			toolExecutor: { setAllowedNativeToolNames: vi.fn(), setWebSearchRoutingPlan: vi.fn() },
			writePromptMetadataArtifacts: vi.fn(async () => undefined),
		}

		const request = Task.prototype.attemptApiRequest.call(fakeTask as unknown as Task, -1, requestScope)

		await expect(request.next()).rejects.toBe(connectionError)
		expect(taskState.isWaitingForFirstChunk).toBe(false)
		expect(liveWebToolsEnabled).toBe(false)
		expect(fakeTask.buildPromptContext).toHaveBeenCalledWith(
			requestScope.providerInfo,
			requestScope.webToolsEnabled,
			requestScope.webSearchRoutingPlan,
		)
		await expect(fakeTask.buildPromptContext.mock.results[0]?.value).resolves.toMatchObject({
			clineWebToolsEnabled: true,
		})
		expect(fakeTask.toolExecutor.setWebSearchRoutingPlan).toHaveBeenCalledWith(
			requestScope.webSearchRoutingPlan,
			requestScope.webToolsEnabled,
			true,
		)
	})
})
