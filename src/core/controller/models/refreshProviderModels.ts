import { resolveSavedCredentials } from "@core/model-registry/remote/model-credentials"
import { discoverProviderModels } from "@core/model-registry/remote/model-refresh"
import * as SecretsManager from "@core/storage/secrets"
import { StringArray } from "@shared/proto/dline/common"
import { ProviderModelsRequest } from "@shared/proto/dline/models"
import { Controller } from ".."

/**
 * List the model ids a provider currently exposes.
 *
 * The settings form calls this while the user is still editing a profile, so
 * unsaved credentials travel with the request. The result is never persisted —
 * it only feeds the model picker alongside the local catalog.
 *
 * @param request Provider id plus the optional base URL and API key in the form
 * @returns Array of model ids, empty when the provider cannot be listed
 */
export async function refreshProviderModels(_controller: Controller, request: ProviderModelsRequest): Promise<StringArray> {
	if (!request.providerId) {
		return StringArray.create({ values: [] })
	}

	// The form omits a field it does not own: the API key lives in secrets and
	// never reaches the profile object the picker reads. Merging per field
	// keeps an edited base URL from discarding the stored key, and vice versa.
	// The profile id disambiguates providers configured more than once, where
	// the provider-wide fallback would list against another profile's endpoint.
	const saved = request.profileId
		? { apiKey: SecretsManager.getApiKey(request.profileId), baseUrl: undefined }
		: resolveSavedCredentials(request.providerId)
	const models = await discoverProviderModels(request.providerId, {
		baseUrl: request.baseUrl || saved.baseUrl,
		apiKey: request.apiKey || saved.apiKey,
	})

	return StringArray.create({ values: Object.keys(models) })
}
