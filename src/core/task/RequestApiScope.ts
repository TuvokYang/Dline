import type { ApiHandler, ApiProviderInfo } from "@core/api"

export interface RequestApiScope {
	readonly api: ApiHandler
	readonly providerInfo: Readonly<ApiProviderInfo>
}

/** Capture one immutable handler/model/provider view for an API request. */
export function createRequestApiScope(api: ApiHandler, mode: ApiProviderInfo["mode"], customPrompt?: string): RequestApiScope {
	const providerId = api.getProviderId?.()
	if (!providerId) {
		throw new Error("API handler is missing its provider identity")
	}

	return Object.freeze({
		api,
		providerInfo: Object.freeze({
			providerId,
			model: api.getModel(),
			mode,
			...(customPrompt === undefined ? {} : { customPrompt }),
		}),
	})
}
