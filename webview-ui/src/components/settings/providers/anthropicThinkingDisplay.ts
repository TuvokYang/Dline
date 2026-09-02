import { ANTHROPIC_THINKING_DISPLAY_OPTIONS } from "@shared/utils/reasoning-support"

/**
 * Selector options for the Anthropic `thinking.display` request field.
 *
 * "None" is a UI-only choice that stores no value, so the field is omitted from the
 * request and the API default applies. The remaining entries mirror the values the
 * Messages API accepts.
 */
export const ANTHROPIC_THINKING_DISPLAY_SELECTOR_OPTIONS = [
	{ value: "none", label: "None" },
	...ANTHROPIC_THINKING_DISPLAY_OPTIONS.map((option) => ({
		value: option,
		label: option.charAt(0).toUpperCase() + option.slice(1),
	})),
] as const

export const ANTHROPIC_THINKING_DISPLAY_DESCRIPTION =
	"None leaves the choice to Anthropic. Summarized returns thinking normally; Omitted redacts it while keeping multi-turn continuity."
