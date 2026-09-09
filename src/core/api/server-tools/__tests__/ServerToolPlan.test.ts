import { ApiFormat, ServerTool } from "@shared/proto/dline/models/metadata"
import { ImageGenerationSource } from "@shared/proto/dline/profile"
import { WebToolsMode } from "@shared/proto/dline/provider/common"
import { describe, expect, it } from "vitest"
import {
	disableWebSearchRoutingPlan,
	hasActiveServerTool,
	projectServerTools,
	resolveHostedImageGenerationPlan,
	resolveServerToolPlan,
	resolveWebSearchRoutingPlan,
} from "../ServerToolPlan"

function hostedPlan(apiFormat: ApiFormat) {
	return resolveWebSearchRoutingPlan({
		enabled: true,
		mode: WebToolsMode.WEB_TOOLS_MODE_AUTO,
		modelInfo: { capabilities: { tools: [ServerTool.WEB_SEARCH] } },
		selectedApiFormat: apiFormat,
		localAvailable: true,
		remoteAdapterAvailable: true,
	})
}

describe("resolveServerToolPlan", () => {
	it("disables hosted routing for internal requests without changing model metadata", () => {
		const hosted = hostedPlan(ApiFormat.OPENAI_RESPONSES)
		const disabled = disableWebSearchRoutingPlan(hosted)

		expect(disabled.route).toBe("disabled")
		expect(disabled.localToolEnabled).toBe(false)
		expect(disabled.localFallbackAvailable).toBe(false)
		expect(disabled.serverTools).toEqual([])
		expect(disabled.serverToolPlan).toBe(hosted.serverToolPlan)
	})
	it.each([
		ApiFormat.OPENAI_RESPONSES,
		ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE,
		ApiFormat.ANTHROPIC_CHAT,
	])("activates declared web search for supported API format %s", (apiFormat) => {
		const plan = resolveServerToolPlan({ capabilities: { tools: [ServerTool.WEB_SEARCH] } }, apiFormat)

		expect(plan).toMatchObject({
			apiFormat,
			declared: [ServerTool.WEB_SEARCH],
			active: [ServerTool.WEB_SEARCH],
			unsupported: [],
			unrecognized: [],
		})
		expect(hasActiveServerTool(plan, ServerTool.WEB_SEARCH)).toBe(true)
	})

	it.each([
		ApiFormat.OPENAI_CHAT,
		ApiFormat.GEMINI_CHAT,
		ApiFormat.R1_CHAT,
	])("keeps declared web search inactive for unsupported API format %s", (apiFormat) => {
		const plan = resolveServerToolPlan({ capabilities: { tools: [ServerTool.WEB_SEARCH] } }, apiFormat)

		expect(plan.active).toEqual([])
		expect(plan.unsupported).toEqual([ServerTool.WEB_SEARCH])
	})

	it("deduplicates known tools and reports unknown enum values without activating them", () => {
		const plan = resolveServerToolPlan(
			{
				capabilities: {
					tools: [ServerTool.SERVER_TOOL_UNSPECIFIED, ServerTool.WEB_SEARCH, ServerTool.WEB_SEARCH, 99 as ServerTool],
				},
			},
			ApiFormat.OPENAI_RESPONSES,
		)

		expect(plan.declared).toEqual([ServerTool.WEB_SEARCH])
		expect(plan.active).toEqual([ServerTool.WEB_SEARCH])
		expect(plan.unrecognized).toEqual([99])
	})

	it("does not infer tools or an API format from empty metadata", () => {
		expect(resolveServerToolPlan(undefined, undefined)).toEqual({
			declared: [],
			disabled: [],
			active: [],
			unsupported: [],
			unrecognized: [],
		})
	})

	it("keeps a disabled tool declared so the switch stays reversible", () => {
		const modelInfo = { capabilities: { tools: [ServerTool.WEB_SEARCH, ServerTool.CODE_EXECUTION] } }

		const plan = resolveServerToolPlan(modelInfo, ApiFormat.ANTHROPIC_CHAT, [ServerTool.WEB_SEARCH])

		expect(plan.declared).toEqual([ServerTool.WEB_SEARCH, ServerTool.CODE_EXECUTION])
		expect(plan.disabled).toEqual([ServerTool.WEB_SEARCH])
		expect(plan.active).toEqual([ServerTool.CODE_EXECUTION])
	})

	it("treats an absent disable list as following the model declaration", () => {
		const modelInfo = { capabilities: { tools: [ServerTool.WEB_SEARCH] } }

		expect(resolveServerToolPlan(modelInfo, ApiFormat.ANTHROPIC_CHAT).active).toEqual([ServerTool.WEB_SEARCH])
		expect(resolveServerToolPlan(modelInfo, ApiFormat.ANTHROPIC_CHAT, []).active).toEqual([ServerTool.WEB_SEARCH])
	})

	it("requires the selected format instead of inferring the first model format", () => {
		const modelInfo = {
			apiFormats: [ApiFormat.OPENAI_CHAT, ApiFormat.OPENAI_RESPONSES],
			capabilities: { tools: [ServerTool.WEB_SEARCH] },
		}

		expect(resolveServerToolPlan(modelInfo, undefined)).toMatchObject({
			active: [],
			unsupported: [ServerTool.WEB_SEARCH],
		})
		expect(resolveServerToolPlan(modelInfo, ApiFormat.OPENAI_RESPONSES).apiFormat).toBe(ApiFormat.OPENAI_RESPONSES)
		expect(resolveServerToolPlan(modelInfo, ApiFormat.GEMINI_CHAT)).toMatchObject({
			apiFormat: ApiFormat.GEMINI_CHAT,
			active: [],
			unsupported: [ServerTool.WEB_SEARCH],
		})
	})

	it.each([
		ApiFormat.OPENAI_RESPONSES,
		ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE,
	])("projects web search as a Responses hosted tool for format %s", (apiFormat) => {
		const projection = projectServerTools(hostedPlan(apiFormat))

		expect(projection).toEqual({ declarations: [{ type: "web_search" }] })
		expect(projection.declarations[0]).not.toHaveProperty("function")
	})

	it("projects the versioned Anthropic web search server tool", () => {
		const projection = projectServerTools(hostedPlan(ApiFormat.ANTHROPIC_CHAT))

		expect(projection).toEqual({
			declarations: [{ type: "web_search_20260318", name: "web_search", allowed_callers: ["direct"] }],
		})
	})

	it("declares the sandbox beside web search, with neither depending on the other", () => {
		// Both are independent hosted capabilities. Web search carries no
		// allowed_callers, so a search never spends the sandbox's call budget.
		const plan = resolveWebSearchRoutingPlan({
			enabled: true,
			mode: WebToolsMode.WEB_TOOLS_MODE_AUTO,
			modelInfo: { capabilities: { tools: [ServerTool.WEB_SEARCH, ServerTool.CODE_EXECUTION] } },
			selectedApiFormat: ApiFormat.ANTHROPIC_CHAT,
			localAvailable: true,
			remoteAdapterAvailable: true,
		})

		expect(plan.serverTools).toEqual([ServerTool.WEB_SEARCH, ServerTool.CODE_EXECUTION])
		expect(projectServerTools(plan)).toEqual({
			declarations: [
				{ type: "web_search_20260318", name: "web_search", allowed_callers: ["direct"] },
				{ type: "code_execution_20260120", name: "code_execution", allowed_callers: ["direct"] },
			],
		})
	})

	it("declares the same standalone search version when the model omits the sandbox", () => {
		const plan = resolveWebSearchRoutingPlan({
			enabled: true,
			mode: WebToolsMode.WEB_TOOLS_MODE_AUTO,
			modelInfo: { capabilities: { tools: [ServerTool.WEB_SEARCH] } },
			selectedApiFormat: ApiFormat.ANTHROPIC_CHAT,
			localAvailable: true,
			remoteAdapterAvailable: true,
		})

		expect(plan.serverTools).toEqual([ServerTool.WEB_SEARCH])
		expect(projectServerTools(plan)).toEqual({
			declarations: [{ type: "web_search_20260318", name: "web_search", allowed_callers: ["direct"] }],
		})
	})

	it("never routes the sandbox on its own when search is not hosted", () => {
		const plan = resolveWebSearchRoutingPlan({
			enabled: true,
			mode: WebToolsMode.WEB_TOOLS_MODE_FORCE_LOCAL,
			modelInfo: { capabilities: { tools: [ServerTool.WEB_SEARCH, ServerTool.CODE_EXECUTION] } },
			selectedApiFormat: ApiFormat.ANTHROPIC_CHAT,
			localAvailable: true,
			remoteAdapterAvailable: true,
		})

		expect(plan.route).toBe("local")
		expect(plan.serverTools).toEqual([])
		expect(projectServerTools(plan)).toEqual({ declarations: [] })
	})

	it("does not project web search for OpenAI Chat without a protocol contract", () => {
		const projection = projectServerTools(
			resolveWebSearchRoutingPlan({
				enabled: true,
				mode: WebToolsMode.WEB_TOOLS_MODE_FORCE_REMOTE,
				modelInfo: { capabilities: { tools: [ServerTool.WEB_SEARCH] } },
				selectedApiFormat: ApiFormat.OPENAI_CHAT,
				localAvailable: true,
				remoteAdapterAvailable: true,
			}),
		)

		expect(projection).toEqual({ declarations: [] })
	})

	it("projects nothing when model metadata does not declare web search", () => {
		const projection = projectServerTools(
			resolveWebSearchRoutingPlan({
				enabled: true,
				mode: WebToolsMode.WEB_TOOLS_MODE_FORCE_REMOTE,
				modelInfo: { capabilities: { tools: [] } },
				selectedApiFormat: ApiFormat.OPENAI_RESPONSES,
				localAvailable: true,
				remoteAdapterAvailable: true,
			}),
		)

		expect(projection).toEqual({ declarations: [] })
	})
})

describe("resolveHostedImageGenerationPlan", () => {
	const base = {
		enabled: true,
		source: ImageGenerationSource.IMAGE_GENERATION_SOURCE_HOSTED,
		modelInfo: { capabilities: { tools: [ServerTool.IMAGE_GENERATION] } },
		selectedApiFormat: ApiFormat.OPENAI_RESPONSES,
		remoteAdapterAvailable: true,
	}

	it("never projects image generation into the main conversation request", () => {
		for (const input of [
			base,
			{ ...base, source: ImageGenerationSource.IMAGE_GENERATION_SOURCE_GPT_SUBSCRIPTION },
			{ ...base, modelInfo: { capabilities: { tools: [] } } },
			{ ...base, selectedApiFormat: ApiFormat.OPENAI_CHAT },
			{ ...base, remoteAdapterAvailable: false },
		]) {
			expect(resolveHostedImageGenerationPlan(input)).toMatchObject({ route: "disabled", serverTools: [] })
		}
	})
})

describe("resolveWebSearchRoutingPlan", () => {
	const base = {
		enabled: true,
		modelInfo: { capabilities: { tools: [ServerTool.WEB_SEARCH] } },
		selectedApiFormat: ApiFormat.OPENAI_RESPONSES,
		localAvailable: true,
		remoteAdapterAvailable: true,
	}

	it("uses hosted search in Auto and falls back to local when hosted search is unavailable", () => {
		expect(resolveWebSearchRoutingPlan({ ...base, mode: WebToolsMode.WEB_TOOLS_MODE_AUTO })).toMatchObject({
			route: "hosted",
			localToolEnabled: false,
			localFallbackAvailable: true,
			serverTools: [ServerTool.WEB_SEARCH],
		})
		expect(
			resolveWebSearchRoutingPlan({
				...base,
				mode: WebToolsMode.WEB_TOOLS_MODE_AUTO,
				selectedApiFormat: ApiFormat.OPENAI_CHAT,
			}),
		).toMatchObject({ route: "local", localToolEnabled: true, localFallbackAvailable: true, serverTools: [] })
	})

	it("keeps Force Local and Force Off mutually exclusive with hosted declarations", () => {
		expect(resolveWebSearchRoutingPlan({ ...base, mode: WebToolsMode.WEB_TOOLS_MODE_FORCE_LOCAL })).toMatchObject({
			route: "local",
			localToolEnabled: true,
			serverTools: [],
		})
		expect(resolveWebSearchRoutingPlan({ ...base, mode: WebToolsMode.WEB_TOOLS_MODE_FORCE_OFF })).toMatchObject({
			route: "disabled",
			localToolEnabled: false,
			serverTools: [],
		})
	})

	it.each([
		{
			name: "missing model declaration",
			overrides: { modelInfo: { capabilities: { tools: [] } } },
			reason: "server_tool_not_declared",
		},
		{
			name: "unsupported selected transport",
			overrides: { selectedApiFormat: ApiFormat.OPENAI_CHAT },
			reason: "server_tool_transport_unsupported",
		},
		{
			name: "missing provider adapter",
			overrides: { remoteAdapterAvailable: false },
			reason: "server_tool_adapter_unavailable",
		},
	])("does not silently fall back from Force Remote when $name", ({ overrides, reason }) => {
		const plan = resolveWebSearchRoutingPlan({
			...base,
			...overrides,
			mode: WebToolsMode.WEB_TOOLS_MODE_FORCE_REMOTE,
		})

		expect(plan).toMatchObject({ route: "unavailable", unavailableReason: reason })
		expect(plan.localToolEnabled).toBe(false)
		expect(plan.localFallbackAvailable).toBe(false)
		expect(plan.serverTools).toEqual([])
	})

	it("lets the global feature gate disable every provider mode", () => {
		for (const mode of [
			WebToolsMode.WEB_TOOLS_MODE_AUTO,
			WebToolsMode.WEB_TOOLS_MODE_FORCE_LOCAL,
			WebToolsMode.WEB_TOOLS_MODE_FORCE_REMOTE,
		]) {
			expect(resolveWebSearchRoutingPlan({ ...base, enabled: false, mode })).toMatchObject({
				route: "disabled",
				localToolEnabled: false,
				serverTools: [],
			})
		}
	})
})
