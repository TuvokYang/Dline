import { getPrompt } from "../../i18n"

const NATIVE_RULES = getPrompt("variants.native", "rules")
const XS_RULES = getPrompt("variants.lite", "rules")

export function createNativeRules(): string {
	return NATIVE_RULES
}

export function createXsRules(): string {
	return XS_RULES
}
