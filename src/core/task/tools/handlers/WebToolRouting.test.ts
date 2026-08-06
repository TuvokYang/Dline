import { resolveWebSearchRoutingPlan } from "@core/api/server-tools"
import { ToolExecutor } from "@core/task/ToolExecutor"
import { ApiFormat, ServerTool } from "@shared/proto/dline/models/metadata"
import { WebSearchMode } from "@shared/proto/dline/provider/common"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AuthService } from "@/services/auth/AuthService"
import type { LocalWebFetchProvider } from "@/services/web-fetch/LocalWebFetchProvider"
import { type LocalSearchProvider, LocalSearchRegistry } from "@/services/web-search/LocalSearchProvider"
import type { ToolUse } from "../../../assistant-message"
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
		taskState: { consecutiveMistakeCount: 0 },
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
		expect(approvalPayload.webSearch.source).toEqual({
			engineId: "searxng",
			label: "SearXNG",
			execution: "dline",
		})
		expect(completedPayload.webSearch).toEqual({
			source: { engineId: "searxng", label: "SearXNG", execution: "dline" },
			result: {
				items: [{ title: "Dline", url: "https://example.test/dline", snippet: "Local result" }],
			},
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
			source: { engineId: "bing", label: "Browser / Bing", execution: "dline" },
			error: "Browser / Bing search failed: navigation timed out",
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
		})
		expect(getAuthToken).not.toHaveBeenCalled()
	})
})
