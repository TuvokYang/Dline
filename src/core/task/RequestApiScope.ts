import { randomUUID } from "node:crypto"
import type { ApiHandler, ApiProviderInfo } from "@core/api"
import { resolveWebSearchRoutingPlan, type WebSearchRoutingPlan } from "@core/api/server-tools"
import { PromptProfile } from "@core/prompts/profiles/types"
import { ExplicitInstructionRegistry } from "@core/task/explicit-instructions/ExplicitInstructionRegistry"
import { ExplicitInstructionRequestScope } from "@core/task/explicit-instructions/ExplicitInstructionRequestScope"
import { ServerTool } from "@shared/proto/dline/models/metadata"
import { resolvePromptProfile } from "@shared/resolve-prompt-profile"

export interface RequestApiScope {
	readonly api: ApiHandler
	readonly providerInfo: Readonly<ApiProviderInfo>
	readonly webToolsEnabled: boolean
	readonly webSearchRoutingPlan: WebSearchRoutingPlan
	readonly explicitInstructions: ExplicitInstructionRequestScope
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
	explicitInstructionRegistry = new ExplicitInstructionRegistry(),
): RequestApiScope {
	const providerId = api.getProviderId?.()
	if (!providerId) {
		throw new Error("API handler is missing its provider identity")
	}
	const model = api.getModel()
	const frozenWebToolsEnabled = webToolsEnabled === true

	return Object.freeze({
		api,
		explicitInstructions: new ExplicitInstructionRequestScope(explicitInstructionRegistry, {
			requestId: randomUUID(),
			attemptId: randomUUID(),
		}),
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
