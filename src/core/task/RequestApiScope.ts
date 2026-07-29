import type { ApiHandler, ApiProviderInfo } from "@core/api"
import type { RequestScopedToolId } from "@core/prompts/tools/tool-ids"

export interface RequestApiScope {
	readonly api: ApiHandler
	readonly providerInfo: Readonly<ApiProviderInfo>
	readonly requestToolIds: readonly RequestScopedToolId[]
}

/** Capture one immutable handler/model/provider view for an API request. */
export function createRequestApiScope(api: ApiHandler, mode: ApiProviderInfo["mode"], customPrompt?: string): RequestApiScope {
	const providerId = api.getProviderId?.()
	if (!providerId) {
		throw new Error("API handler is missing its provider identity")
	}

	return Object.freeze({
		api,
		requestToolIds: Object.freeze([]),
		providerInfo: Object.freeze({
			providerId,
			model: api.getModel(),
			mode,
			...(customPrompt === undefined ? {} : { customPrompt }),
		}),
	})
}

/** Add internal tools to one request without mutating the captured API scope. */
export function withRequestToolIds(scope: RequestApiScope, requestToolIds: readonly RequestScopedToolId[]): RequestApiScope {
	return Object.freeze({
		...scope,
		requestToolIds: Object.freeze([...new Set(requestToolIds)]),
	})
}
