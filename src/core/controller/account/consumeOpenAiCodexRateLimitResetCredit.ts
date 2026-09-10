import { randomUUID } from "node:crypto"
import { type ConsumeOpenAiCodexRateLimitResetCreditRequest, OpenAiCodexRateLimitResetResult } from "@shared/proto/dline/account"
import { openAiCodexUsageClient } from "@/integrations/openai-codex/usage"
import type { Controller } from ".."
import {
	logOpenAiCodexAccountRequestFailure,
	requireOpenAiCodexProfile,
	toOpenAiCodexRateLimitResetResult,
} from "./openAiCodexProfileTarget"

/** Consumes one user-selected reset credit for an explicit OpenAI Codex Profile. */
export async function consumeOpenAiCodexRateLimitResetCredit(
	_controller: Controller,
	request: ConsumeOpenAiCodexRateLimitResetCreditRequest,
): Promise<OpenAiCodexRateLimitResetResult> {
	const profile = await requireOpenAiCodexProfile(request.profileId)
	const creditId = request.creditId.trim()
	if (creditId.length === 0) throw new Error("An OpenAI Codex reset-credit ID is required.")
	try {
		const result = await openAiCodexUsageClient.consumeRateLimitResetCredit(profile.id, creditId, randomUUID())
		if (!result) throw new Error("OpenAI Codex authentication is unavailable.")
		return toOpenAiCodexRateLimitResetResult(profile.id, result)
	} catch (error) {
		logOpenAiCodexAccountRequestFailure("consume rate-limit reset credit", error)
		throw new Error("OpenAI Codex rate-limit reset could not be completed.")
	}
}
