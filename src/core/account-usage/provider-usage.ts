import type { AccountUsage } from "@core/api"
import type { ApiProfile } from "@shared/proto/dline/profile"

/** Attach the Profile identity owned by the service boundary to a provider snapshot. */
export function decorateProviderAccountUsage(profile: ApiProfile, usage: AccountUsage | undefined): AccountUsage | undefined {
	if (!usage) return undefined
	return {
		...usage,
		profileId: profile.id,
		providerId: profile.provider,
	}
}
