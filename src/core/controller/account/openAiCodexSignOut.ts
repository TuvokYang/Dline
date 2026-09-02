import { Empty, EmptyRequest } from "@shared/proto/dline/common"
import { readApiProfilesFresh } from "@/core/controller/file/getApiProfiles"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Signs out of OpenAI Codex by clearing stored credentials
 */
export async function openAiCodexSignOut(controller: Controller, _: EmptyRequest): Promise<Empty> {
	const mode = controller.stateManager.getGlobalSettingsKey("mode")
	const configuration = controller.stateManager.getApiConfiguration()
	const profileId = mode === "plan" ? configuration.planModeProfileId : configuration.actModeProfileId
	const profile = profileId ? (await readApiProfilesFresh()).find((candidate) => candidate.id === profileId) : undefined
	if (!profile || profile.provider !== "openai-codex") {
		throw new Error("Select an OpenAI Codex profile before signing out.")
	}

	try {
		await openAiCodexOAuthManager.clearCredentials(profile.id)
		await controller.postStateToWebview()
	} catch (error) {
		Logger.error("[openAiCodexSignOut] Failed to sign out of the selected profile.")
		throw error
	}

	return {}
}
