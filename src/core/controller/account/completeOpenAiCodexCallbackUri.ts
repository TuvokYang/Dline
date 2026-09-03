import { OpenAiCodexAuthStatusResponse, type OpenAiCodexCallbackUriRequest } from "@shared/proto/dline/account"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import type { Controller } from ".."
import {
	logOpenAiCodexOAuthFailure,
	requireOpenAiCodexFlowId,
	requireOpenAiCodexProfile,
	toOpenAiCodexAuthStatus,
} from "./openAiCodexProfileTarget"

export async function completeOpenAiCodexCallbackUri(
	_controller: Controller,
	request: OpenAiCodexCallbackUriRequest,
): Promise<OpenAiCodexAuthStatusResponse> {
	const profile = await requireOpenAiCodexProfile(request.profileId)
	const flowId = requireOpenAiCodexFlowId(request.flowId)
	try {
		await openAiCodexOAuthManager.completeFromCallbackUri({
			profileId: profile.id,
			flowId,
			callbackUri: request.callbackUri,
		})
		const status = await openAiCodexOAuthManager.getAuthStatus(profile.id)
		return OpenAiCodexAuthStatusResponse.create({ profileId: profile.id, status: toOpenAiCodexAuthStatus(status) })
	} catch (error) {
		logOpenAiCodexOAuthFailure("complete callback", error)
		throw new Error("OpenAI Codex sign-in could not be completed.")
	}
}
