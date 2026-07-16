/** Supported prompt architecture profiles. */
export enum PromptProfile {
	Native = "native",
	Lite = "lite",
}

/** Require one exact typed profile at the Prompt domain boundary. */
export function requirePromptProfile(profile: PromptProfile | undefined): PromptProfile {
	if (profile !== PromptProfile.Native && profile !== PromptProfile.Lite) {
		throw new Error("PromptProfile must be supplied explicitly")
	}
	return profile
}
