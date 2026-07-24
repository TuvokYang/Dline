import type { ApiHandler } from "@core/api"
import type { ApiStream } from "@core/api/transform/stream"
import { findEnabledProfileByName, readApiProfiles } from "@core/controller/file/getApiProfiles"
import type { ApiConfiguration } from "@shared/api"
import type { Mode } from "@shared/storage/types"

export interface ApiProfileRecoveryResult {
	configuration: ApiConfiguration
	requestedProfile?: string
	resolvedProfile?: string
	usedFallback: boolean
	error?: string
}

function profileForMode(configuration: ApiConfiguration, mode: Mode): string | undefined {
	return mode === "plan" ? configuration.planModeProfile : configuration.actModeProfile
}

function withProfile(configuration: ApiConfiguration, mode: Mode, profile: string): ApiConfiguration {
	return mode === "plan" ? { ...configuration, planModeProfile: profile } : { ...configuration, actModeProfile: profile }
}

/** Resolves a session-only profile fallback without mutating the persisted task binding. */
export function resolveTaskApiProfile(
	configuration: ApiConfiguration,
	mode: Mode,
	historyProviderId?: string,
): ApiProfileRecoveryResult {
	const requestedProfile = profileForMode(configuration, mode)
	if (requestedProfile && findEnabledProfileByName(requestedProfile)) {
		return {
			configuration,
			requestedProfile,
			resolvedProfile: requestedProfile,
			usedFallback: false,
		}
	}

	const enabledProfiles = readApiProfiles().filter((profile) => profile.enabled)
	const fallback =
		enabledProfiles.find((profile) => profile.provider === historyProviderId) ??
		enabledProfiles.find((profile) => profile.name === profileForMode(configuration, mode)) ??
		enabledProfiles[0]
	if (!fallback) {
		return {
			configuration,
			requestedProfile,
			usedFallback: false,
			error: requestedProfile
				? `Task API profile "${requestedProfile}" is unavailable and no enabled fallback profile exists.`
				: `No enabled API profile is available for ${mode} mode.`,
		}
	}

	return {
		configuration: withProfile(configuration, mode, fallback.name),
		requestedProfile,
		resolvedProfile: fallback.name,
		usedFallback: true,
	}
}

export function createUnavailableApiHandler(message: string): ApiHandler {
	return {
		createMessage: async function* (): ApiStream {
			throw new Error(message)
		},
		getModel: () => ({
			id: "unavailable",
			info: {
				id: "unavailable",
				name: "Unavailable API profile",
				description: message,
				capabilities: { maxTokens: 0, contextWindow: 0 },
				pricing: { inputPrice: 0, outputPrice: 0, cacheWritesPrice: 0, cacheReadsPrice: 0, currency: "USD" },
			},
		}),
		getProviderId: () => "unavailable",
	}
}
