import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { OpenRouterCompatibleModelInfo } from "@shared/proto/cline/models"
import { readMcpMarketplaceCatalogFromCache } from "@/core/storage/disk"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"
import { GlobalStateAndSettings } from "@/shared/storage/state-keys"
import type { Controller } from "../index"
import { sendMcpMarketplaceCatalogEvent } from "../mcp/subscribeToMcpMarketplaceCatalog"
import { refreshBasetenModels } from "../models/refreshBasetenModels"
import { refreshClineModels } from "../models/refreshClineModels"
import { refreshGroqModels } from "../models/refreshGroqModels"
import { refreshHicapModels } from "../models/refreshHicapModels"
import { refreshLiteLlmModels } from "../models/refreshLiteLlmModels"
import { refreshOpenRouterModels } from "../models/refreshOpenRouterModels"
import { sendOpenRouterModelsEvent } from "../models/subscribeToOpenRouterModels"

/**
 * Initialize webview when it launches
 * @param controller The controller instance
 * @param request The empty request
 * @returns Empty response
 */
export async function initializeWebview(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	try {
		// Post last cached models as soon as possible for immediate availability in the UI
		const lastCachedModels = await controller.readOpenRouterModels()
		if (lastCachedModels) {
			sendOpenRouterModelsEvent(OpenRouterCompatibleModelInfo.create({ models: lastCachedModels }))
		}

		// Refresh OpenRouter models from API (public API, always available)
		refreshOpenRouterModels(controller).then(async (models) => {
			if (models && Object.keys(models).length > 0) {
				const apiConfiguration = controller.stateManager.getApiConfiguration()
				const planActSeparateModelsSetting = controller.stateManager.getGlobalSettingsKey("planActSeparateModelsSetting")
				const currentMode = controller.stateManager.getGlobalSettingsKey("mode")

				if (planActSeparateModelsSetting) {
					const modelIdField = currentMode === "plan" ? "planModeOpenRouterModelId" : "actModeOpenRouterModelId"
					const modelInfoField = currentMode === "plan" ? "planModeOpenRouterModelInfo" : "actModeOpenRouterModelInfo"
					const modelId = apiConfiguration[modelIdField]
					if (modelId && models[modelId]) {
						controller.stateManager.setGlobalState(modelInfoField, models[modelId])
						await controller.postStateToWebview()
					}
				} else {
					const planModelId = apiConfiguration.planModeOpenRouterModelId
					const actModelId = apiConfiguration.actModeOpenRouterModelId
					const updates: Partial<GlobalStateAndSettings> = {}
					if (planModelId && models[planModelId]) updates.planModeOpenRouterModelInfo = models[planModelId]
					if (actModelId && models[actModelId]) updates.actModeOpenRouterModelInfo = models[actModelId]
					if (Object.keys(updates).length > 0) {
						controller.stateManager.setGlobalStateBatch(updates)
						await controller.postStateToWebview()
					}
				}
			}
		})

		// Only refresh provider-specific models if the corresponding credentials are configured.
		// This avoids unnecessary network requests for unauthenticated users or providers
		// without configured API keys.

		// Cline models require authentication
		const clineApiKey = controller.stateManager.getSecretKey("clineApiKey")
		if (clineApiKey) {
			refreshClineModels(controller)
		}

		// Groq models require an API key
		const groqApiKey = controller.stateManager.getSecretKey("groqApiKey")
		if (groqApiKey) {
			refreshGroqModels(controller)
		}

		// Baseten models require an API key
		const basetenApiKey = controller.stateManager.getSecretKey("basetenApiKey")
		if (basetenApiKey) {
			refreshBasetenModels(controller)
		}

		// Hicap models require an API key
		const hicapApiKey = controller.stateManager.getSecretKey("hicapApiKey")
		if (hicapApiKey) {
			refreshHicapModels(controller, EmptyRequest.create())
		}

		// LiteLLM requires both base URL and API key
		const liteLlmBaseUrl = controller.stateManager.getGlobalSettingsKey("liteLlmBaseUrl")
		const liteLlmApiKey = controller.stateManager.getSecretKey("liteLlmApiKey")
		if (liteLlmBaseUrl && liteLlmApiKey) {
			await refreshLiteLlmModels()
		}

		// Send stored MCP marketplace catalog if available
		const mcpMarketplaceCatalog = await readMcpMarketplaceCatalogFromCache()
		if (mcpMarketplaceCatalog) {
			sendMcpMarketplaceCatalogEvent(mcpMarketplaceCatalog)
		}

		// Silently refresh MCP marketplace catalog
		controller.refreshMcpMarketplace(true /* sendCatalogEvent */)

		// Initialize telemetry service with user's current setting
		controller.getStateToPostToWebview().then((state) => {
			const { telemetrySetting } = state
			const isOptedIn = telemetrySetting !== "disabled"
			telemetryService.updateTelemetryState(isOptedIn)
		})

		return Empty.create({})
	} catch (error) {
		Logger.error("Failed to initialize webview:", error)
		return Empty.create({})
	}
}
