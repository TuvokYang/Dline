import { OpenAiCodexAuthStatus } from "@shared/proto/dline/account"
import type { ApiProfile } from "@shared/proto/dline/profile"
import { readApiProfilesFresh } from "@/core/controller/file/getApiProfiles"
import type { OpenAiCodexProfileAuthStatus } from "@/integrations/openai-codex/oauth"
import { OAuthFlowError } from "@/services/oauth"
import { Logger } from "@/shared/services/Logger"

export async function requireOpenAiCodexProfile(profileId: string): Promise<ApiProfile> {
	if (typeof profileId !== "string" || profileId.length === 0) {
		throw new Error("An OpenAI Codex Profile ID is required.")
	}
	const profile = (await readApiProfilesFresh()).find((candidate) => candidate.id === profileId)
	if (!profile || profile.provider !== "openai-codex") {
		throw new Error("The requested OpenAI Codex Profile does not exist.")
	}
	return profile
}

export function requireOpenAiCodexFlowId(flowId: string): string {
	if (typeof flowId !== "string" || flowId.length === 0) {
		throw new Error("An OpenAI Codex OAuth flow ID is required.")
	}
	return flowId
}

export function toOpenAiCodexAuthStatus(status: OpenAiCodexProfileAuthStatus): OpenAiCodexAuthStatus {
	switch (status) {
		case "missing":
			return OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_MISSING
		case "malformed":
			return OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_MALFORMED
		case "legacy-shared":
			return OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_LEGACY_SHARED
		case "authenticated":
			return OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_AUTHENTICATED
		case "refreshable-expired":
			return OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_REFRESHABLE_EXPIRED
		case "reauthentication-required":
			return OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_REAUTHENTICATION_REQUIRED
	}
}

export function logOpenAiCodexOAuthFailure(action: string, error: unknown): void {
	const code = error instanceof OAuthFlowError ? error.code : "UNKNOWN"
	Logger.error(`[OpenAiCodexOAuth] ${action} failed (${code}).`)
}
