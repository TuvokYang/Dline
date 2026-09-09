import { type OpenAiCodexProfileRequest, OpenAiCodexUsageResponse } from "@shared/proto/dline/account"
import { openAiCodexUsageClient } from "@/integrations/openai-codex/usage"
import type { Controller } from ".."
import {
	logOpenAiCodexAccountRequestFailure,
	requireOpenAiCodexProfile,
	toOpenAiCodexUsageResponse,
} from "./openAiCodexProfileTarget"

/** Returns account usage for one explicit OpenAI Codex Profile. */
export async function getOpenAiCodexUsage(
	_controller: Controller,
	request: OpenAiCodexProfileRequest,
): Promise<OpenAiCodexUsageResponse> {
	const profile = await requireOpenAiCodexProfile(request.profileId)
	try {
		return toOpenAiCodexUsageResponse(profile.id, await openAiCodexUsageClient.getUsage(profile.id))
	} catch (error) {
		logOpenAiCodexAccountRequestFailure("read usage", error)
		throw new Error("OpenAI Codex usage could not be read.")
	}
}
