import { Empty, EmptyRequest } from "@shared/proto/dline/common"
import { ShowMessageType } from "@shared/proto/dline/host/window"
import { readApiProfilesFresh } from "@/core/controller/file/getApiProfiles"
import { HostProvider } from "@/hosts/host-provider"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import { OAuthFlowError } from "@/services/oauth"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Initiates OpenAI Codex OAuth authentication flow
 * Opens the authorization URL in the user's browser
 */
export async function openAiCodexSignIn(controller: Controller, _: EmptyRequest): Promise<Empty> {
	const mode = controller.stateManager.getGlobalSettingsKey("mode")
	const configuration = controller.stateManager.getApiConfiguration()
	const profileId = mode === "plan" ? configuration.planModeProfileId : configuration.actModeProfileId
	const profile = profileId ? (await readApiProfilesFresh()).find((candidate) => candidate.id === profileId) : undefined
	if (!profile || profile.provider !== "openai-codex") {
		throw new Error("Select an OpenAI Codex profile before signing in.")
	}

	try {
		const started = await openAiCodexOAuthManager.startAuthorizationFlow(profile.id)
		void started.result
			.then(async () => {
				HostProvider.window.showMessage({
					type: ShowMessageType.INFORMATION,
					message: "Successfully signed in to OpenAI Codex",
				})
				await controller.postStateToWebview()
			})
			.catch((error: unknown) => {
				const code = error instanceof OAuthFlowError ? error.code : "UNKNOWN"
				Logger.error(`[openAiCodexSignIn] OAuth flow failed (${code}).`)
				if (code !== "FLOW_TIMED_OUT" && code !== "FLOW_CANCELLED") {
					HostProvider.window.showMessage({
						type: ShowMessageType.ERROR,
						message: "OpenAI Codex sign in failed. Please try again.",
					})
				}
			})
	} catch (error) {
		const code = error instanceof OAuthFlowError ? error.code : "UNKNOWN"
		Logger.error(`[openAiCodexSignIn] Failed to start OAuth flow (${code}).`)
		throw error
	}

	return {}
}
