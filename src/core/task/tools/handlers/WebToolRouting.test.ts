import { resolveWebSearchRoutingPlan } from "@core/api/server-tools"
import { PreToolUseHookCancellationError } from "@core/hooks/PreToolUseHookCancellationError"
import { InteractionCancellationError } from "@core/task/interaction/InteractionCancellationError"
import { ToolExecutor } from "@core/task/ToolExecutor"
import { ApiFormat, ServerTool } from "@shared/proto/dline/models/metadata"
import { WebSearchMode } from "@shared/proto/dline/provider/common"
import { ClineDefaultTool } from "@shared/tools"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AuthService } from "@/services/auth/AuthService"
import type { LocalWebFetchProvider } from "@/services/web-fetch/LocalWebFetchProvider"
import { type LocalSearchProvider, LocalSearchRegistry } from "@/services/web-search/LocalSearchProvider"
import type { ToolUse } from "../../../assistant-message"
import { AutoApprove } from "../autoApprove"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolHookUtils } from "../utils/ToolHookUtils"
import { NO_TOOL_RESULT } from "../utils/ToolResultUtils"
import { WebFetchToolHandler } from "./WebFetchToolHandler"
import { WebSearchToolHandler } from "./WebSearchToolHandler"

function routingPlan(route: "disabled" | "local" | "hosted") {
	return resolveWebSearchRoutingPlan({
		enabled: true,
		mode: route === "disabled" ? WebSearchMode.WEB_SEARCH_MODE_FORCE_OFF : WebSearchMode.WEB_SEARCH_MODE_AUTO,
		modelInfo: { capabilities: { tools: [ServerTool.WEB_SEARCH] } },
		selectedApiFormat: route === "hosted" ? ApiFormat.OPENAI_RESPONSES : ApiFormat.OPENAI_CHAT,
		localAvailable: true,
		remoteAdapterAvailable: route === "hosted",
	})
}

function config(webToolsEnabled: boolean, route: "disabled" | "local" | "hosted", includeRoute = true) {
	const operationAbortController = new AbortController()
	return {
		api: {
			getProviderId: () => "deepseek",
			getModel: () => ({ id: "test-model", info: { id: "test-model" } }),
		},
		...(includeRoute ? { webSearchRoutingPlan: routingPlan(route) } : {}),
		webToolsEnabled,
		services: {
			stateManager: {
				getGlobalSettingsKey: (key: string) => (key === "clineWebToolsEnabled" ? webToolsEnabled : undefined),
			},
		},
		taskState: { consecutiveMistakeCount: 0, operationSignal: operationAbortController.signal },
		callbacks: {
			sayAndCreateMissingParamError: vi.fn(async (_tool: string, parameter: string) => `missing:${parameter}`),
		},
	} as any
}

function block(name: "web_search" | "web_fetch"): ToolUse {
	return {
		type: "tool_use",
		name,
		params: {},
		partial: false,
		ts: 1,
		function_id: "call-1",
		dline_tid: "dline-1",
	} as ToolUse
}

describe("Web Tool auto-approval", () => {
	it("uses an independent Web permission instead of the Browser permission", () => {
		const settings = {
			actions: {
				useBrowser: true,
				useWeb: false,
			},
		}
		const stateManager = {
			getGlobalSettingsKey: vi.fn((key: string) => (key === "autoApprovalSettings" ? settings : false)),
		}
		const autoApprove = new AutoApprove(stateManager as any)

		expect(autoApprove.shouldAutoApproveTool(ClineDefaultTool.BROWSER)).toBe(true)
		expect(autoApprove.shouldAutoApproveTool(ClineDefaultTool.WEB_SEARCH)).toBe(false)
		expect(autoApprove.shouldAutoApproveTool(ClineDefaultTool.WEB_FETCH)).toBe(false)

		settings.actions.useBrowser = false
		settings.actions.useWeb = true

		expect(autoApprove.shouldAutoApproveTool(ClineDefaultTool.BROWSER)).toBe(false)
		expect(autoApprove.shouldAutoApproveTool(ClineDefaultTool.WEB_SEARCH)).toBe(true)
		expect(autoApprove.shouldAutoApproveTool(ClineDefaultTool.WEB_FETCH)).toBe(true)
	})

	it("defaults a missing Web permission to false instead of inheriting Browser approval", () => {
		const stateManager = {
			getGlobalSettingsKey: vi.fn((key: string) =>
				key === "autoApprovalSettings" ? { actions: { useBrowser: true } } : false,
			),
		}
		const autoApprove = new AutoApprove(stateManager as any)

		expect(autoApprove.shouldAutoApproveTool(ClineDefaultTool.WEB_SEARCH)).toBe(false)
		expect(autoApprove.shouldAutoApproveTool(ClineDefaultTool.WEB_FETCH)).toBe(false)
	})

	it("does not let legacy Auto Approve All bypass the independent Web permission", () => {
		const stateManager = {
			getGlobalSettingsKey: vi.fn((key: string) => {
				if (key === "autoApproveAllToggled") return true
				if (key === "autoApprovalSettings") return { actions: { useBrowser: true, useWeb: false } }
				return false
			}),
		}
		const autoApprove = new AutoApprove(stateManager as any)

		expect(autoApprove.shouldAutoApproveTool(ClineDefaultTool.BROWSER)).toBe(true)
		expect(autoApprove.shouldAutoApproveTool(ClineDefaultTool.WEB_SEARCH)).toBe(false)
		expect(autoApprove.shouldAutoApproveTool(ClineDefaultTool.WEB_FETCH)).toBe(false)
	})
})

describe("local Web Tool routing", () => {
	beforeEach(() => vi.clearAllMocks())

	it("admits local Web Search for a non-Cline provider when the request plan selects local", async () => {
		const taskConfig = config(true, "local")

		await expect(new WebSearchToolHandler().execute(taskConfig, block("web_search"))).resolves.toBe("missing:query")
		expect(taskConfig.callbacks.sayAndCreateMissingParamError).toHaveBeenCalledWith("web_search", "query", undefined, 1)
	})

	it("re-resolves the local route for a restored approval without a live request scope", () => {
		const executor = Object.assign(Object.create(ToolExecutor.prototype), {
			api: {
				getModel: () => ({
					id: "restored-chat-model",
					info: {
						id: "restored-chat-model",
						apiFormats: [ApiFormat.OPENAI_CHAT],
						capabilities: { contextWindow: 131_072 },
					},
				}),
				supportsServerTool: () => false,
			},
			stateManager: {
				getGlobalSettingsKey: (key: string) => (key === "clineWebToolsEnabled" ? true : undefined),
			},
			autoApprover: new AutoApprove({
				getGlobalSettingsKey: () => ({ actions: { useWeb: true } }),
			} as any),
		}) as ToolExecutor
		const resolveForExecution = (
			ToolExecutor.prototype as unknown as {
				getWebSearchRoutingPlanForExecution(): ReturnType<typeof routingPlan> | undefined
			}
		).getWebSearchRoutingPlanForExecution

		expect(resolveForExecution.call(executor)).toMatchObject({
			route: "local",
			localToolEnabled: true,
			serverTools: [],
		})
	})

	it("keeps provider-hosted search enabled for restored execution when local Use Web auto-approval is off", () => {
		const executor = Object.assign(Object.create(ToolExecutor.prototype), {
			api: {
				getModel: () => ({
					id: "restored-responses-model",
					info: {
						id: "restored-responses-model",
						apiFormats: [ApiFormat.OPENAI_RESPONSES],
						capabilities: { contextWindow: 131_072, tools: [ServerTool.WEB_SEARCH] },
					},
				}),
				supportsServerTool: () => true,
			},
			stateManager: {
				getGlobalSettingsKey: (key: string) =>
					key === "clineWebToolsEnabled"
						? true
						: key === "autoApprovalSettings"
							? { actions: { useWeb: false } }
							: undefined,
			},
			autoApprover: new AutoApprove({
				getGlobalSettingsKey: (key: string) => (key === "autoApprovalSettings" ? { actions: { useWeb: false } } : false),
			} as any),
		}) as ToolExecutor
		const resolveForExecution = (
			ToolExecutor.prototype as unknown as {
				getWebSearchRoutingPlanForExecution(): ReturnType<typeof routingPlan> | undefined
			}
		).getWebSearchRoutingPlanForExecution

		expect(resolveForExecution.call(executor)).toMatchObject({
			route: "hosted",
			localToolEnabled: false,
			serverTools: [ServerTool.WEB_SEARCH],
		})
	})

	it("rejects a local Web Search function before Cline Auth when hosted routing owns the request", async () => {
		const taskConfig = config(true, "hosted")
		const getAuthToken = vi.spyOn(AuthService.getInstance(), "getAuthToken")
		const searchBlock = { ...block("web_search"), params: { query: "DeepSeek hosted search" } } as ToolUse

		const result = await new WebSearchToolHandler().execute(taskConfig, searchBlock)

		expect(String(result)).toContain("disabled")
		expect(getAuthToken).not.toHaveBeenCalled()
		expect(taskConfig.callbacks.sayAndCreateMissingParamError).not.toHaveBeenCalled()
	})

	it("lets the global switch disable local Web Search even with a local plan", async () => {
		const taskConfig = config(false, "local", false)

		const result = await new WebSearchToolHandler().execute(taskConfig, block("web_search"))

		expect(String(result)).toContain("disabled")
		expect(taskConfig.callbacks.sayAndCreateMissingParamError).not.toHaveBeenCalled()
	})

	it("keeps a frozen local Web Search route after the live global switch changes", async () => {
		const taskConfig = config(false, "local")

		await expect(new WebSearchToolHandler().execute(taskConfig, block("web_search"))).resolves.toBe("missing:query")
		expect(taskConfig.callbacks.sayAndCreateMissingParamError).toHaveBeenCalledWith("web_search", "query", undefined, 1)
	})

	it("keeps Web Fetch enabled when provider Web Search is Force Off", async () => {
		const taskConfig = config(true, "disabled")

		await expect(new WebFetchToolHandler().execute(taskConfig, block("web_fetch"))).resolves.toBe("missing:url")
	})

	it("disables Web Fetch when the frozen global Web Tools feature is disabled", async () => {
		const taskConfig = config(false, "disabled")

		expect(String(await new WebFetchToolHandler().execute(taskConfig, block("web_fetch")))).toContain("disabled")
		expect(taskConfig.callbacks.sayAndCreateMissingParamError).not.toHaveBeenCalled()
	})

	it("waits for a non-empty URL before rendering partial Web Fetch approval", async () => {
		const ask = vi.fn<StronglyTypedUIHelpers["ask"]>(async () => ({ response: "yesButtonClicked" }))
		const uiHelpers: StronglyTypedUIHelpers = {
			say: vi.fn(async () => undefined),
			ask,
			removeClosingTag: (_block: ToolUse, _parameter: string, value?: string) => value ?? "",
			shouldAutoApproveTool: vi.fn(() => false),
			shouldAutoApproveToolWithPath: vi.fn(async () => false),
			askApproval: vi.fn(async () => false),
			captureTelemetry: vi.fn(),
			showNotificationIfEnabled: vi.fn(),
			getConfig: vi.fn(() => {
				throw new Error("getConfig should not be called while rendering a partial Web Fetch block")
			}),
		}
		const handler = new WebFetchToolHandler()
		const fetchBlock = block("web_fetch")

		await handler.handlePartialBlock(fetchBlock, uiHelpers)
		expect(ask).not.toHaveBeenCalled()

		const url = "https://example.test/streamed-url"
		await handler.handlePartialBlock({ ...fetchBlock, params: { url } } as ToolUse, uiHelpers)

		expect(ask).toHaveBeenCalledOnce()
		const serializedPayload = ask.mock.calls[0]?.[1]
		if (!serializedPayload) throw new Error("Expected Web Fetch approval payload")
		const payload = JSON.parse(serializedPayload)
		expect(payload).toMatchObject({
			tool: "webFetch",
			path: url,
			webFetch: { schemaVersion: 1, status: "running", url },
		})
	})

	it("executes an OpenAI local Web Search without consulting Cline Auth", async () => {
		const taskConfig = config(true, "local")
		taskConfig.api.getProviderId = () => "openai"
		taskConfig.services.stateManager.getGlobalSettingsKey = (key: string) =>
			key === "clineWebToolsEnabled"
				? true
				: key === "hooksEnabled"
					? false
					: key === "localWebSearchEngine"
						? "searxng"
						: key === "searxngSearchUrl"
							? "https://search.example.test"
							: undefined
		taskConfig.services.stateManager.getSecretKey = (key: string) =>
			key === "searxngSearchToken" ? "private-token" : undefined
		taskConfig.autoApprovalSettings = { enableNotifications: false }
		taskConfig.callbacks.shouldAutoApproveTool = vi.fn(() => true)
		taskConfig.callbacks.say = vi.fn(async () => undefined)
		const search = vi.fn(async () => ({
			engineId: "searxng" as const,
			query: "Dline local search",
			items: [{ title: "Dline", url: "https://example.test/dline", snippet: "Local result" }],
		}))
		const provider: LocalSearchProvider = {
			descriptor: { id: "searxng", label: "SearXNG", execution: "dline" },
			search,
		}
		const createRegistry = vi.fn(() => new LocalSearchRegistry([provider]))
		const getAuthToken = vi.spyOn(AuthService.getInstance(), "getAuthToken")
		const searchBlock = {
			...block("web_search"),
			params: { query: "Dline local search" },
		} as ToolUse

		const result = await new WebSearchToolHandler(createRegistry).execute(taskConfig, searchBlock)

		expect(String(result)).toContain("SearXNG search completed")
		expect(String(result)).toContain("https://example.test/dline")
		expect(String(result)).toContain("Local result")
		expect(createRegistry).toHaveBeenCalledWith({
			searxngSearchUrl: "https://search.example.test",
			searxngSearchToken: "private-token",
		})
		expect(search).toHaveBeenCalledWith({ query: "Dline local search" })
		expect(taskConfig.callbacks.say).toHaveBeenCalledTimes(2)
		const approvalPayload = JSON.parse(taskConfig.callbacks.say.mock.calls[0][1])
		const completedPayload = JSON.parse(taskConfig.callbacks.say.mock.calls[1][1])
		expect(approvalPayload.webSearch).toEqual({
			schemaVersion: 1,
			status: "running",
			source: { id: "searxng", label: "SearXNG", execution: "dline" },
			query: "Dline local search",
		})
		expect(completedPayload.webSearch).toEqual({
			schemaVersion: 1,
			status: "completed",
			source: { id: "searxng", label: "SearXNG", execution: "dline" },
			query: "Dline local search",
			items: [{ title: "Dline", url: "https://example.test/dline", snippet: "Local result" }],
		})
		expect(taskConfig.callbacks.say.mock.calls[1][5]).toBe(searchBlock.ts)
		expect(getAuthToken).not.toHaveBeenCalled()
	})

	it("updates the local Web Search card with its source and actionable error", async () => {
		const taskConfig = config(true, "local")
		taskConfig.services.stateManager.getGlobalSettingsKey = (key: string) =>
			key === "clineWebToolsEnabled"
				? true
				: key === "hooksEnabled"
					? false
					: key === "localWebSearchEngine"
						? "bing"
						: undefined
		taskConfig.services.stateManager.getSecretKey = vi.fn()
		taskConfig.autoApprovalSettings = { enableNotifications: false }
		taskConfig.callbacks.shouldAutoApproveTool = vi.fn(() => true)
		taskConfig.callbacks.say = vi.fn(async () => undefined)
		const provider: LocalSearchProvider = {
			descriptor: { id: "bing", label: "Browser / Bing", execution: "dline" },
			search: vi.fn(async () => {
				throw new Error("Browser / Bing search failed: navigation timed out")
			}),
		}
		const searchBlock = { ...block("web_search"), params: { query: "Dline timeout" } } as ToolUse

		const result = await new WebSearchToolHandler(() => new LocalSearchRegistry([provider])).execute(taskConfig, searchBlock)

		expect(String(result)).toContain("navigation timed out")
		const failedPayload = JSON.parse(taskConfig.callbacks.say.mock.calls[1][1])
		expect(failedPayload.content).toContain("navigation timed out")
		expect(failedPayload.webSearch).toEqual({
			schemaVersion: 1,
			status: "failed",
			source: { id: "bing", label: "Browser / Bing", execution: "dline" },
			query: "Dline timeout",
			error: "Browser / Bing search failed: navigation timed out",
		})
		expect(taskConfig.callbacks.say.mock.calls[1][5]).toBe(searchBlock.ts)
	})

	it("preserves a pending local Web Search approval when task termination cancels the waiter", async () => {
		const taskConfig = config(true, "local")
		taskConfig.services.stateManager.getGlobalSettingsKey = (key: string) =>
			key === "clineWebToolsEnabled"
				? true
				: key === "hooksEnabled"
					? false
					: key === "localWebSearchEngine"
						? "bing"
						: undefined
		taskConfig.services.stateManager.getSecretKey = vi.fn()
		taskConfig.autoApprovalSettings = { enableNotifications: false }
		taskConfig.callbacks.shouldAutoApproveTool = vi.fn(() => false)
		taskConfig.callbacks.say = vi.fn(async () => undefined)
		const cancellation = new InteractionCancellationError("task_terminated")
		taskConfig.callbacks.ask = vi.fn(async () => {
			throw cancellation
		})
		const search = vi.fn()
		const provider: LocalSearchProvider = {
			descriptor: { id: "bing", label: "Browser / Bing", execution: "dline" },
			search,
		}
		const searchBlock = { ...block("web_search"), params: { query: "pending search" } } as ToolUse

		await expect(
			new WebSearchToolHandler(() => new LocalSearchRegistry([provider])).execute(taskConfig, searchBlock),
		).rejects.toBe(cancellation)
		expect(search).not.toHaveBeenCalled()
		expect(taskConfig.callbacks.say).not.toHaveBeenCalled()
	})

	it("terminates the local Web Search card when PreToolUse cancels execution", async () => {
		const taskConfig = config(true, "local")
		taskConfig.services.stateManager.getGlobalSettingsKey = (key: string) =>
			key === "clineWebToolsEnabled" ? true : key === "localWebSearchEngine" ? "bing" : undefined
		taskConfig.services.stateManager.getSecretKey = vi.fn()
		taskConfig.autoApprovalSettings = { enableNotifications: false }
		taskConfig.callbacks.shouldAutoApproveTool = vi.fn(() => true)
		taskConfig.callbacks.say = vi.fn(async () => undefined)
		const search = vi.fn()
		const provider: LocalSearchProvider = {
			descriptor: { id: "bing", label: "Browser / Bing", execution: "dline" },
			search,
		}
		const runHook = vi
			.spyOn(ToolHookUtils, "runPreToolUseIfEnabled")
			.mockImplementationOnce(async (_config, _block, options) => {
				const message = "Web search blocked by workspace policy"
				await options?.beforeTaskCancellation?.(message)
				throw new PreToolUseHookCancellationError(message)
			})
		const searchBlock = { ...block("web_search"), params: { query: "blocked search" } } as ToolUse

		try {
			await new WebSearchToolHandler(() => new LocalSearchRegistry([provider])).execute(taskConfig, searchBlock)
		} finally {
			runHook.mockRestore()
		}

		expect(search).not.toHaveBeenCalled()
		expect(taskConfig.callbacks.say).toHaveBeenCalledTimes(2)
		const failedPayload = JSON.parse(taskConfig.callbacks.say.mock.calls[1][1])
		expect(failedPayload.webSearch).toMatchObject({
			status: "failed",
			query: "blocked search",
			error: "Web search blocked by workspace policy",
		})
		expect(taskConfig.callbacks.say.mock.calls[1][5]).toBe(searchBlock.ts)
	})

	it("executes an OpenAI local Web Fetch without consulting Cline Auth", async () => {
		const taskConfig = config(true, "local")
		taskConfig.api.getProviderId = () => "openai"
		taskConfig.services.stateManager.getGlobalSettingsKey = (key: string) =>
			key === "clineWebToolsEnabled" ? true : key === "hooksEnabled" ? false : undefined
		taskConfig.autoApprovalSettings = { enableNotifications: false }
		taskConfig.callbacks.shouldAutoApproveTool = vi.fn(() => true)
		taskConfig.callbacks.say = vi.fn(async () => undefined)
		const fetch = vi.fn(async () => ({
			url: "https://example.test/docs",
			prompt: "Extract the release notes",
			content: "# Local OpenAI Web Fetch\n\nNo Cline login required.",
			source: { id: "browser", label: "Browser Web Fetch", execution: "dline" } as const,
		}))
		const provider = { fetch } satisfies LocalWebFetchProvider
		const getAuthToken = vi.spyOn(AuthService.getInstance(), "getAuthToken")
		const fetchBlock = {
			...block("web_fetch"),
			params: { url: "https://example.test/docs", prompt: "Extract the release notes" },
		} as ToolUse

		const result = await new WebFetchToolHandler(provider).execute(taskConfig, fetchBlock)

		expect(String(result)).toContain("# Local OpenAI Web Fetch")
		expect(String(result)).toContain("Extract the release notes")
		expect(fetch).toHaveBeenCalledWith({
			url: "https://example.test/docs",
			prompt: "Extract the release notes",
			signal: taskConfig.taskState.operationSignal,
		})
		expect(taskConfig.callbacks.say).toHaveBeenCalledTimes(2)
		const completedPayload = JSON.parse(taskConfig.callbacks.say.mock.calls[1][1])
		expect(completedPayload.webFetch).toEqual({
			schemaVersion: 1,
			status: "completed",
			source: { id: "browser", label: "Browser Web Fetch", execution: "dline" },
			url: "https://example.test/docs",
			prompt: "Extract the release notes",
			content: "# Local OpenAI Web Fetch\n\nNo Cline login required.",
		})
		expect(taskConfig.callbacks.say.mock.calls[1][5]).toBe(fetchBlock.ts)
		expect(getAuthToken).not.toHaveBeenCalled()
	})

	it("does not write a terminal card or tool result after task cancellation", async () => {
		const taskConfig = config(true, "local")
		taskConfig.services.stateManager.getGlobalSettingsKey = (key: string) =>
			key === "clineWebToolsEnabled" ? true : key === "hooksEnabled" ? false : undefined
		taskConfig.autoApprovalSettings = { enableNotifications: false }
		taskConfig.callbacks.shouldAutoApproveTool = vi.fn(() => true)
		taskConfig.callbacks.say = vi.fn(async () => undefined)
		const operationAbortController = new AbortController()
		taskConfig.taskState.operationSignal = operationAbortController.signal
		const fetch = vi.fn(async () => {
			operationAbortController.abort(new Error("checkpoint_restore"))
			throw new Error("checkpoint_restore")
		})
		const provider = { fetch } satisfies LocalWebFetchProvider
		const fetchBlock = {
			...block("web_fetch"),
			params: { url: "https://example.test/restore", prompt: "Wait for restore" },
		} as ToolUse

		await expect(new WebFetchToolHandler(provider).execute(taskConfig, fetchBlock)).resolves.toBe(NO_TOOL_RESULT)
		expect(taskConfig.callbacks.say).toHaveBeenCalledTimes(1)
	})

	it("terminates the local Web Fetch card when PreToolUse cancels execution", async () => {
		const taskConfig = config(true, "local")
		taskConfig.services.stateManager.getGlobalSettingsKey = (key: string) =>
			key === "clineWebToolsEnabled" ? true : undefined
		taskConfig.autoApprovalSettings = { enableNotifications: false }
		taskConfig.callbacks.shouldAutoApproveTool = vi.fn(() => true)
		taskConfig.callbacks.say = vi.fn(async () => undefined)
		const fetch = vi.fn()
		const provider = { fetch } satisfies LocalWebFetchProvider
		const runHook = vi
			.spyOn(ToolHookUtils, "runPreToolUseIfEnabled")
			.mockImplementationOnce(async (_config, _block, options) => {
				const message = "Web fetch blocked by workspace policy"
				await options?.beforeTaskCancellation?.(message)
				throw new PreToolUseHookCancellationError(message)
			})
		const fetchBlock = {
			...block("web_fetch"),
			params: { url: "https://example.test/blocked", prompt: "Extract blocked content" },
		} as ToolUse

		try {
			await new WebFetchToolHandler(provider).execute(taskConfig, fetchBlock)
		} finally {
			runHook.mockRestore()
		}

		expect(fetch).not.toHaveBeenCalled()
		expect(taskConfig.callbacks.say).toHaveBeenCalledTimes(2)
		const failedPayload = JSON.parse(taskConfig.callbacks.say.mock.calls[1][1])
		expect(failedPayload.webFetch).toMatchObject({
			status: "failed",
			url: "https://example.test/blocked",
			prompt: "Extract blocked content",
			error: "Web fetch blocked by workspace policy",
		})
		expect(taskConfig.callbacks.say.mock.calls[1][5]).toBe(fetchBlock.ts)
	})
})
