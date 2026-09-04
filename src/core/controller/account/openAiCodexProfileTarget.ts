import {
	OpenAiCodexAuthFlow,
	OpenAiCodexAuthStatus,
	OpenAiCodexBrowserOpenStatus,
	OpenAiCodexFlowOutcome,
	OpenAiCodexFlowStatus,
} from "@shared/proto/dline/account"
import type { ApiProfile } from "@shared/proto/dline/profile"
import { readApiProfilesFresh } from "@/core/controller/file/getApiProfiles"
import type {
	OpenAiCodexAuthorizationFlow,
	OpenAiCodexAuthorizationFlowOutcome,
	OpenAiCodexProfileAuthStatus,
} from "@/integrations/openai-codex/oauth"
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

export function toOpenAiCodexAuthFlow(flow: OpenAiCodexAuthorizationFlow): OpenAiCodexAuthFlow {
	return OpenAiCodexAuthFlow.create({
		profileId: flow.profileId,
		flowId: flow.flowId,
		authorizationUrl: flow.authorizationUrl,
		redirectUri: flow.redirectUri,
		expiresAtMs: flow.expiresAtMs,
		browserOpenStatus:
			flow.browserOpenStatus === "opened"
				? OpenAiCodexBrowserOpenStatus.OPEN_AI_CODEX_BROWSER_OPEN_STATUS_OPENED
				: OpenAiCodexBrowserOpenStatus.OPEN_AI_CODEX_BROWSER_OPEN_STATUS_FAILED,
	})
}

export function toOpenAiCodexFlowOutcome(outcome: OpenAiCodexAuthorizationFlowOutcome): OpenAiCodexFlowOutcome {
	const status = {
		completed: OpenAiCodexFlowStatus.OPEN_AI_CODEX_FLOW_STATUS_COMPLETED,
		cancelled: OpenAiCodexFlowStatus.OPEN_AI_CODEX_FLOW_STATUS_CANCELLED,
		"timed-out": OpenAiCodexFlowStatus.OPEN_AI_CODEX_FLOW_STATUS_TIMED_OUT,
		failed: OpenAiCodexFlowStatus.OPEN_AI_CODEX_FLOW_STATUS_FAILED,
	}[outcome.status]
	return OpenAiCodexFlowOutcome.create({
		profileId: outcome.profileId,
		flowId: outcome.flowId,
		status,
		endedAtMs: outcome.endedAtMs,
	})
}

export function logOpenAiCodexOAuthFailure(action: string, error: unknown): void {
	const code = error instanceof OAuthFlowError ? error.code : "UNKNOWN"
	Logger.error(`[OpenAiCodexOAuth] ${action} failed (${code}).`)
}
