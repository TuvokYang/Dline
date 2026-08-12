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
			webToolsEnabled: true,
			webSearchRoutingPlan: resolveWebSearchRoutingPlan({
				enabled: true,
				modelInfo: undefined,
				selectedApiFormat: undefined,
				localAvailable: true,
				remoteAdapterAvailable: false,
			}),
			explicitInstructions: {
				beginProviderAttempt: vi.fn(),
				createConsumePort: vi.fn(() => ({})),
			},
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

		const buildPromptContext = vi.fn(async (_providerInfo, webToolsEnabled, webSearchRoutingPlan) => {
			await Promise.resolve()
			liveWebToolsEnabled = false
			return { promptProfile: {}, clineWebToolsEnabled: webToolsEnabled, webSearchRoutingPlan }
		})
		const toolExecutor = {
			setAllowedNativeToolNames: vi.fn(),
			setExplicitInstructionConsumePort: vi.fn(),
			setWebSearchRoutingPlan: vi.fn(),
		}
		const fakeTask = Object.assign(Object.create(Task.prototype), {
			taskId: "task-first-chunk-failure",
			taskState,
			pendingSystemPromptRefreshReason: undefined,
			buildPromptContext,
			apiRateMetricsService: { recordRequestStarted: vi.fn() },
			buildThinkingSummary: vi.fn(() => undefined),
			compactionRequestReplay: { getProviderInput: vi.fn(() => undefined) },
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
			toolExecutor,
			writePromptMetadataArtifacts: vi.fn(async () => undefined),
		}) as Task

		const request = fakeTask.attemptApiRequest(-1, requestScope)

		await expect(request.next()).rejects.toBe(connectionError)
		expect(taskState.isWaitingForFirstChunk).toBe(false)
		expect(liveWebToolsEnabled).toBe(false)
		expect(buildPromptContext).toHaveBeenCalledWith(
			requestScope.providerInfo,
			requestScope.webToolsEnabled,
			requestScope.webSearchRoutingPlan,
		)
		await expect(buildPromptContext.mock.results[0]?.value).resolves.toMatchObject({
			clineWebToolsEnabled: true,
		})
		expect(toolExecutor.setWebSearchRoutingPlan).toHaveBeenCalledWith(
			requestScope.webSearchRoutingPlan,
			requestScope.webToolsEnabled,
		)
	})

	it("fails explicitly when the provider stream ends without yielding any chunk", async () => {
		// A Responses stream that only emits codex.rate_limits / metadata /
		// response.failed events produces no chunks. Previously the empty
		// generator was treated as a successful first chunk and yielded
		// undefined, crashing downstream on
		// "Cannot read properties of undefined (reading 'type')".
		const api = {
			createMessage: vi.fn(() => (async function* () {})()),
		}
		const requestScope = {
			api,
			providerInfo: {
				providerId: "openai",
				model: { id: "gpt-5.6-sol", info: {} },
				mode: "act",
			},
			webToolsEnabled: true,
			webSearchRoutingPlan: resolveWebSearchRoutingPlan({
				enabled: false,
				modelInfo: undefined,
				selectedApiFormat: undefined,
				localAvailable: true,
				remoteAdapterAvailable: false,
			}),
			explicitInstructions: {
				beginProviderAttempt: vi.fn(),
				createConsumePort: vi.fn(() => ({})),
			},
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
			message: "API stream ended without producing any content.",
			isErrorType: vi.fn(() => false),
			serialize: vi.fn(() => '{"message":"API stream ended without producing any content."}'),
		}
		vi.spyOn(ErrorService, "get").mockReturnValue({
			logMessage: vi.fn(),
			toClineError: vi.fn(() => clineError),
		} as unknown as ErrorService)
		vi.spyOn(ToolPromptGenerator.prototype, "generateToolsForRequest").mockReturnValue(undefined)

		const fakeTask = Object.assign(Object.create(Task.prototype), {
			taskId: "task-first-chunk-empty-stream",
			taskState,
			pendingSystemPromptRefreshReason: undefined,
			buildPromptContext: vi.fn(async () => ({
				promptProfile: {},
				clineWebToolsEnabled: true,
				webSearchRoutingPlan: requestScope.webSearchRoutingPlan,
			})),
			apiRateMetricsService: { recordRequestStarted: vi.fn() },
			buildThinkingSummary: vi.fn(() => undefined),
			compactionRequestReplay: { getProviderInput: vi.fn(() => undefined) },
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
				getApiConfiguration: vi.fn(() => ({ actModeProfile: "openai:gpt-5.6-sol" })),
				getGlobalSettingsKey: vi.fn(() => false),
			},
			systemPromptCacheService: {
				getLastTools: vi.fn(() => undefined),
				getOrCreate: vi.fn(async () => ({ text: "system prompt" })),
			},
			toolExecutor: {
				setAllowedNativeToolNames: vi.fn(),
				setExplicitInstructionConsumePort: vi.fn(),
				setWebSearchRoutingPlan: vi.fn(),
			},
			writePromptMetadataArtifacts: vi.fn(async () => undefined),
		}) as Task

		const request = fakeTask.attemptApiRequest(-1, requestScope)

		await expect(request.next()).rejects.toThrow("API stream ended without producing any content")
		expect(taskState.isWaitingForFirstChunk).toBe(false)
	})
})
