import { randomUUID } from "node:crypto"
import { type OpenAiCodexProfileRequest, OpenAiCodexRateLimitResetResult } from "@shared/proto/dline/account"
import { openAiCodexUsageClient } from "@/integrations/openai-codex/usage"
import type { Controller } from ".."
import {
	logOpenAiCodexAccountRequestFailure,
	requireOpenAiCodexProfile,
	toOpenAiCodexRateLimitResetResult,
} from "./openAiCodexProfileTarget"

/** Consumes one server-selected reset credit for an explicit OpenAI Codex Profile. */
export async function consumeOpenAiCodexRateLimitResetCredit(
	_controller: Controller,
	request: OpenAiCodexProfileRequest,
): Promise<OpenAiCodexRateLimitResetResult> {
	const profile = await requireOpenAiCodexProfile(request.profileId)
	try {
		const result = await openAiCodexUsageClient.consumeRateLimitResetCredit(profile.id, randomUUID())
		if (!result) throw new Error("OpenAI Codex authentication is unavailable.")
		return toOpenAiCodexRateLimitResetResult(profile.id, result)
	} catch (error) {
		logOpenAiCodexAccountRequestFailure("consume rate-limit reset credit", error)
		throw new Error("OpenAI Codex rate-limit reset could not be completed.")
	}
}
