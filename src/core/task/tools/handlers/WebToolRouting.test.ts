import { resolveWebSearchRoutingPlan } from "@core/api/server-tools"
import { ToolExecutor } from "@core/task/ToolExecutor"
import { ApiFormat, ServerTool } from "@shared/proto/dline/models/metadata"
import { WebSearchMode } from "@shared/proto/dline/provider/common"
import { beforeEach, describe, expect, it, vi } from "vitest"
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

	it("rejects a local Web Search function when hosted routing owns the request", async () => {
		const taskConfig = config(true, "hosted")

		const result = await new WebSearchToolHandler().execute(taskConfig, block("web_search"))

		expect(String(result)).toContain("disabled")
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
})
