import type { ApiHandler, ApiProviderInfo } from "@core/api"
import { disableWebSearchRoutingPlan, resolveWebSearchRoutingPlan, type WebSearchRoutingPlan } from "@core/api/server-tools"
import { PromptProfile } from "@core/prompts/profiles/types"
import type { RequestScopedToolId } from "@core/prompts/tools/tool-ids"
import { ServerTool } from "@shared/proto/dline/models/metadata"
import { resolvePromptProfile } from "@shared/resolve-prompt-profile"

export interface RequestApiScope {
	readonly api: ApiHandler
	readonly providerInfo: Readonly<ApiProviderInfo>
	readonly requestToolIds: readonly RequestScopedToolId[]
	readonly webToolsEnabled: boolean
	readonly webSearchRoutingPlan: WebSearchRoutingPlan
}

/** Resolve Web Search once from the handler/profile captured for a request. */
export function resolveRequestWebSearchRoutingPlan(api: ApiHandler, enabled: boolean): WebSearchRoutingPlan {
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
	})
}

/** Capture one immutable handler/model/provider view for an API request. */
export function createRequestApiScope(
	api: ApiHandler,
	mode: ApiProviderInfo["mode"],
	customPrompt?: string,
	webToolsEnabled = false,
): RequestApiScope {
	const providerId = api.getProviderId?.()
	if (!providerId) {
		throw new Error("API handler is missing its provider identity")
	}
	const model = api.getModel()
	const frozenWebToolsEnabled = webToolsEnabled === true

	return Object.freeze({
		api,
		requestToolIds: Object.freeze([]),
		webToolsEnabled: frozenWebToolsEnabled,
		webSearchRoutingPlan: resolveRequestWebSearchRoutingPlan(api, frozenWebToolsEnabled),
		providerInfo: Object.freeze({
			providerId,
			model,
			mode,
			...(customPrompt === undefined ? {} : { customPrompt }),
		}),
	})
}

/** Add internal tools to one request without mutating the captured API scope. */
export function withRequestToolIds(scope: RequestApiScope, requestToolIds: readonly RequestScopedToolId[]): RequestApiScope {
	const frozenToolIds = Object.freeze([...new Set(requestToolIds)])
	return Object.freeze({
		...scope,
		requestToolIds: frozenToolIds,
		webSearchRoutingPlan:
			frozenToolIds.length > 0 ? disableWebSearchRoutingPlan(scope.webSearchRoutingPlan) : scope.webSearchRoutingPlan,
	})
}
