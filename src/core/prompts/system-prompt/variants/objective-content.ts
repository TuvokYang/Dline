import { getPrompt } from "../../i18n"

const NATIVE_OBJECTIVE = getPrompt("variants.native", "objective")
const XS_OBJECTIVE = getPrompt("variants.lite", "objective")

export function createNativeObjective(): string {
	return NATIVE_OBJECTIVE
}

export function createXsObjective(): string {
	return XS_OBJECTIVE
}
