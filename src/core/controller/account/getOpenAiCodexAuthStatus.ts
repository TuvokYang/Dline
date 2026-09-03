import { OpenAiCodexAuthStatusResponse, type OpenAiCodexProfileRequest } from "@shared/proto/dline/account"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import type { Controller } from ".."
import { logOpenAiCodexOAuthFailure, requireOpenAiCodexProfile, toOpenAiCodexAuthStatus } from "./openAiCodexProfileTarget"

export async function getOpenAiCodexAuthStatus(
	_controller: Controller,
	request: OpenAiCodexProfileRequest,
): Promise<OpenAiCodexAuthStatusResponse> {
	const profile = await requireOpenAiCodexProfile(request.profileId)
	try {
		const status = await openAiCodexOAuthManager.getAuthStatus(profile.id)
		const flow = openAiCodexOAuthManager.getActiveAuthorizationFlow(profile.id)
		return OpenAiCodexAuthStatusResponse.create({
			profileId: profile.id,
			status: toOpenAiCodexAuthStatus(status),
			flowId: flow?.flowId,
		})
	} catch (error) {
		logOpenAiCodexOAuthFailure("read status", error)
		throw new Error("OpenAI Codex sign-in status could not be read.")
	}
}
