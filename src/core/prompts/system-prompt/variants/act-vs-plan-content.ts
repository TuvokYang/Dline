import { getPrompt } from "../../i18n"

const NATIVE_ACT_VS_PLAN = getPrompt("variants.native", "actVsPlan")
const XS_ACT_VS_PLAN = getPrompt("variants.lite", "actVsPlan")

export function createNativeActVsPlan(): string {
	return NATIVE_ACT_VS_PLAN
}

export function createXsActVsPlan(): string {
	return XS_ACT_VS_PLAN
}
