import { discoverProviderModels } from "@core/model-registry/remote/model-refresh"
import { StringArray } from "@shared/proto/dline/common"
import { ProviderModelsRequest } from "@shared/proto/dline/models"
import { Controller } from ".."

/**
 * List the model ids a provider currently exposes.
 *
 * The settings form calls this while the user is still editing a profile, so
 * unsaved credentials travel with the request; empty fields fall back to the
 * credentials already stored for the provider. The result is never persisted —
 * it only feeds the model picker alongside the local catalog.
 *
 * @param request Provider id plus the optional base URL and API key in the form
 * @returns Array of model ids, empty when the provider cannot be listed
 */
export async function refreshProviderModels(_controller: Controller, request: ProviderModelsRequest): Promise<StringArray> {
	if (!request.providerId) {
		return StringArray.create({ values: [] })
	}

	const models = await discoverProviderModels(request.providerId, {
		baseUrl: request.baseUrl || undefined,
		apiKey: request.apiKey || undefined,
	})

	return StringArray.create({ values: Object.keys(models) })
}
