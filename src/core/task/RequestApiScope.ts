import type { ApiHandler, ApiProviderInfo } from "@core/api"
import { resolveWebSearchRoutingPlan, type WebSearchRoutingPlan } from "@core/api/server-tools"
import { PromptProfile } from "@core/prompts/profiles/types"
import { ServerTool } from "@shared/proto/dline/models/metadata"
import { resolvePromptProfile } from "@shared/resolve-prompt-profile"

export interface RequestApiScope {
	readonly api: ApiHandler
	readonly providerInfo: Readonly<ApiProviderInfo>
	readonly webToolsEnabled: boolean
	readonly hostedWebSearchAllowed: boolean
	readonly webSearchRoutingPlan: WebSearchRoutingPlan
}

/** Resolve Web Search once from the handler/profile captured for a request. */
export function resolveRequestWebSearchRoutingPlan(
	api: ApiHandler,
	enabled: boolean,
	hostedExecutionAllowed = true,
): WebSearchRoutingPlan {
	const model = api.getModel()
	const promptProfile = resolvePromptProfile({
		modelId: model.id,
		contextWindow: model.info.capabilities?.contextWindow,
	})
	return resolveWebSearchRoutingPlan({
		enabled,
		mode: api.getWebSearchMode?.(),
		modelInfo: model.info,
		selectedApiFormat: model.info.apiFormats?.[0],
		localAvailable: promptProfile === PromptProfile.Standard,
		remoteAdapterAvailable: api.supportsServerTool?.(ServerTool.WEB_SEARCH) === true,
		hostedExecutionAllowed,
	})
}

/** Capture one immutable handler/model/provider view for an API request. */
export function createRequestApiScope(
	api: ApiHandler,
	mode: ApiProviderInfo["mode"],
	customPrompt?: string,
	webToolsEnabled = false,
	hostedWebSearchAllowed = true,
): RequestApiScope {
	const providerId = api.getProviderId?.()
	if (!providerId) {
		throw new Error("API handler is missing its provider identity")
	}
	const model = api.getModel()
	const frozenWebToolsEnabled = webToolsEnabled === true
	const frozenHostedWebSearchAllowed = hostedWebSearchAllowed === true

	return Object.freeze({
		api,
		webToolsEnabled: frozenWebToolsEnabled,
		hostedWebSearchAllowed: frozenHostedWebSearchAllowed,
		webSearchRoutingPlan: resolveRequestWebSearchRoutingPlan(api, frozenWebToolsEnabled, frozenHostedWebSearchAllowed),
		providerInfo: Object.freeze({
			providerId,
			model,
			mode,
			...(customPrompt === undefined ? {} : { customPrompt }),
		}),
	})
}
