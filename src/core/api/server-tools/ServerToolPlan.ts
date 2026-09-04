import type { ModelInfo } from "@shared/proto/dline/models"
import { ApiFormat, ServerTool } from "@shared/proto/dline/models/metadata"
import { ImageGenerationSource } from "@shared/proto/dline/profile"
import { WebSearchMode } from "@shared/proto/dline/provider/common"

const KNOWN_SERVER_TOOLS = new Set<ServerTool>([
	ServerTool.WEB_SEARCH,
	ServerTool.CODE_EXECUTION,
	ServerTool.IMAGE_GENERATION,
])

const SUPPORTED_TOOLS_BY_API_FORMAT: Readonly<Partial<Record<ApiFormat, ReadonlySet<ServerTool>>>> = {
	[ApiFormat.ANTHROPIC_CHAT]: new Set([ServerTool.WEB_SEARCH, ServerTool.CODE_EXECUTION]),
	[ApiFormat.OPENAI_RESPONSES]: new Set([ServerTool.WEB_SEARCH, ServerTool.IMAGE_GENERATION]),
	[ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE]: new Set([ServerTool.WEB_SEARCH, ServerTool.IMAGE_GENERATION]),
}

export type ServerToolDeclaration =
	| Readonly<{ type: "web_search" }>
	| Readonly<{ type: "web_search_20260318"; name: "web_search"; allowed_callers: readonly ["direct"] }>
	| Readonly<{ type: "code_execution_20260120"; name: "code_execution"; allowed_callers: readonly ["direct"] }>
	| Readonly<{ type: "image_generation" }>

export interface ServerToolProjection {
	readonly declarations: readonly ServerToolDeclaration[]
}

export interface ServerToolPlan {
	readonly apiFormat?: ApiFormat
	readonly declared: readonly ServerTool[]
	readonly active: readonly ServerTool[]
	readonly unsupported: readonly ServerTool[]
	readonly unrecognized: readonly number[]
}

export type WebSearchRoute = "disabled" | "local" | "hosted" | "unavailable"

export type WebSearchUnavailableReason =
	| "local_web_search_unavailable"
	| "server_tool_not_declared"
	| "server_tool_transport_unsupported"
	| "server_tool_adapter_unavailable"

export interface WebSearchRoutingPlan {
	readonly mode: WebSearchMode
	readonly route: WebSearchRoute
	readonly serverToolPlan: ServerToolPlan
	readonly localToolEnabled: boolean
	readonly localFallbackAvailable: boolean
	readonly serverTools: readonly ServerTool[]
	readonly unavailableReason?: WebSearchUnavailableReason
}

export interface WebSearchRoutingInput {
	readonly enabled: boolean
	readonly mode?: WebSearchMode
	readonly modelInfo: Pick<ModelInfo, "capabilities"> | undefined
	readonly selectedApiFormat: ApiFormat | undefined
	readonly localAvailable: boolean
	readonly remoteAdapterAvailable: boolean
}

export type HostedImageGenerationRoute = "disabled" | "hosted" | "unavailable"

export type HostedImageGenerationUnavailableReason =
	| "server_tool_not_declared"
	| "server_tool_transport_unsupported"
	| "server_tool_adapter_unavailable"

export interface HostedImageGenerationPlan {
	readonly route: HostedImageGenerationRoute
	readonly serverToolPlan: ServerToolPlan
	readonly serverTools: readonly ServerTool[]
	readonly unavailableReason?: HostedImageGenerationUnavailableReason
}

export interface HostedImageGenerationInput {
	readonly enabled: boolean
	readonly source?: ImageGenerationSource
	readonly modelInfo: Pick<ModelInfo, "capabilities"> | undefined
	readonly selectedApiFormat: ApiFormat | undefined
	readonly remoteAdapterAvailable: boolean
}

/** Resolve provider-hosted tools solely from model metadata and the selected wire protocol. */
export function resolveServerToolPlan(
	modelInfo: Pick<ModelInfo, "capabilities"> | undefined,
	selectedApiFormat: ApiFormat | undefined,
): ServerToolPlan {
	const declared: ServerTool[] = []
	const unrecognized: number[] = []
	const seen = new Set<number>()

	for (const numericValue of modelInfo?.capabilities?.tools ?? []) {
		if (!Number.isInteger(numericValue) || numericValue === ServerTool.SERVER_TOOL_UNSPECIFIED || seen.has(numericValue)) {
			continue
		}
		seen.add(numericValue)
		if (KNOWN_SERVER_TOOLS.has(numericValue as ServerTool)) {
			declared.push(numericValue as ServerTool)
		} else {
			unrecognized.push(numericValue)
		}
	}

	declared.sort((left, right) => left - right)
	unrecognized.sort((left, right) => left - right)
	const supported = selectedApiFormat === undefined ? undefined : SUPPORTED_TOOLS_BY_API_FORMAT[selectedApiFormat]
	const active = declared.filter((tool) => supported?.has(tool) === true)
	const unsupported = declared.filter((tool) => supported?.has(tool) !== true)

	return Object.freeze({
		...(selectedApiFormat === undefined ? {} : { apiFormat: selectedApiFormat }),
		declared: Object.freeze(declared),
		active: Object.freeze(active),
		unsupported: Object.freeze(unsupported),
		unrecognized: Object.freeze(unrecognized),
	})
}

/** Check one active hosted capability without coupling callers to provider or model identifiers. */
export function hasActiveServerTool(plan: ServerToolPlan, tool: ServerTool): boolean {
	return plan.active.includes(tool)
}

/** Remove provider-hosted Web Search from an internal request while preserving model metadata. */
export function disableWebSearchRoutingPlan(plan: WebSearchRoutingPlan): WebSearchRoutingPlan {
	return Object.freeze({
		mode: plan.mode,
		route: "disabled" as const,
		serverToolPlan: plan.serverToolPlan,
		localToolEnabled: false,
		localFallbackAvailable: false,
		serverTools: Object.freeze([] as ServerTool[]),
	})
}

function createWebSearchRoutingPlan(
	mode: WebSearchMode,
	route: WebSearchRoute,
	serverToolPlan: ServerToolPlan,
	localAvailable: boolean,
	unavailableReason?: WebSearchUnavailableReason,
): WebSearchRoutingPlan {
	return Object.freeze({
		mode,
		route,
		serverToolPlan,
		localToolEnabled: route === "local",
		localFallbackAvailable: localAvailable,
		// The sandbox is a capability of its own: it rides on the hosted route but is
		// never routed through web search, so a search never spends its call budget.
		serverTools: Object.freeze(
			route === "hosted"
				? serverToolPlan.active.includes(ServerTool.CODE_EXECUTION)
					? [ServerTool.WEB_SEARCH, ServerTool.CODE_EXECUTION]
					: [ServerTool.WEB_SEARCH]
				: [],
		),
		...(unavailableReason === undefined ? {} : { unavailableReason }),
	})
}

/** Resolve exactly one web-search execution route for the current request. */
export function resolveWebSearchRoutingPlan(input: WebSearchRoutingInput): WebSearchRoutingPlan {
	const mode = input.mode ?? WebSearchMode.WEB_SEARCH_MODE_AUTO
	const serverToolPlan = resolveServerToolPlan(input.modelInfo, input.selectedApiFormat)

	if (!input.enabled || mode === WebSearchMode.WEB_SEARCH_MODE_FORCE_OFF) {
		return createWebSearchRoutingPlan(mode, "disabled", serverToolPlan, false)
	}

	if (mode === WebSearchMode.WEB_SEARCH_MODE_FORCE_LOCAL) {
		return input.localAvailable
			? createWebSearchRoutingPlan(mode, "local", serverToolPlan, true)
			: createWebSearchRoutingPlan(mode, "unavailable", serverToolPlan, false, "local_web_search_unavailable")
	}

	const declared = serverToolPlan.declared.includes(ServerTool.WEB_SEARCH)
	const transportSupported = serverToolPlan.active.includes(ServerTool.WEB_SEARCH)
	const hostedAvailable = declared && transportSupported && input.remoteAdapterAvailable

	if (mode === WebSearchMode.WEB_SEARCH_MODE_FORCE_REMOTE) {
		if (!declared) {
			return createWebSearchRoutingPlan(mode, "unavailable", serverToolPlan, false, "server_tool_not_declared")
		}
		if (!transportSupported) {
			return createWebSearchRoutingPlan(mode, "unavailable", serverToolPlan, false, "server_tool_transport_unsupported")
		}
		return input.remoteAdapterAvailable
			? createWebSearchRoutingPlan(mode, "hosted", serverToolPlan, false)
			: createWebSearchRoutingPlan(mode, "unavailable", serverToolPlan, false, "server_tool_adapter_unavailable")
	}

	if (hostedAvailable) {
		return createWebSearchRoutingPlan(mode, "hosted", serverToolPlan, input.localAvailable)
	}
	return input.localAvailable
		? createWebSearchRoutingPlan(mode, "local", serverToolPlan, true)
		: createWebSearchRoutingPlan(
				mode,
				"unavailable",
				serverToolPlan,
				false,
				!declared
					? "server_tool_not_declared"
					: !transportSupported
						? "server_tool_transport_unsupported"
						: "server_tool_adapter_unavailable",
			)
}

/**
 * Hosted image generation is coordinated by the ordinary generate_image tool.
 * Main conversation requests never project the image server tool directly.
 */
export function resolveHostedImageGenerationPlan(input: HostedImageGenerationInput): HostedImageGenerationPlan {
	return Object.freeze({
		route: "disabled",
		serverToolPlan: resolveServerToolPlan(input.modelInfo, input.selectedApiFormat),
		serverTools: Object.freeze([]),
	})
}

/** Project active hosted capabilities into their protocol-native request shape. */
export function projectServerTools(plan: WebSearchRoutingPlan): ServerToolProjection {
	if (plan.route !== "hosted" || !plan.serverTools.includes(ServerTool.WEB_SEARCH)) {
		return Object.freeze({ declarations: Object.freeze([]) })
	}

	switch (plan.serverToolPlan.apiFormat) {
		case ApiFormat.OPENAI_RESPONSES:
		case ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE:
			return Object.freeze({
				declarations: Object.freeze([{ type: "web_search" as const }]),
			})
		case ApiFormat.ANTHROPIC_CHAT:
			// `direct` names the model itself: both tools are invoked by the model, and
			// neither is reachable from inside the sandbox.
			return Object.freeze({
				declarations: Object.freeze([
					{
						type: "web_search_20260318" as const,
						name: "web_search" as const,
						allowed_callers: Object.freeze(["direct"] as const),
					},
					...(plan.serverTools.includes(ServerTool.CODE_EXECUTION)
						? [
								{
									type: "code_execution_20260120" as const,
									name: "code_execution" as const,
									allowed_callers: Object.freeze(["direct"] as const),
								},
							]
						: []),
				]),
			})
		default:
			return Object.freeze({ declarations: Object.freeze([]) })
	}
}
