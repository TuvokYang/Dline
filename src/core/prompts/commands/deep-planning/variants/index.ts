import { LITE_DEEP_PLANNING_VARIANT } from "./lite"
import { type DeepPlanningVariantDescriptor, NATIVE_DEEP_PLANNING_VARIANT } from "./native"

export { LITE_DEEP_PLANNING_VARIANT } from "./lite"
export type { DeepPlanningVariantDescriptor } from "./native"
export { NATIVE_DEEP_PLANNING_VARIANT } from "./native"

/** Complete provider-independent deep-planning variant set. */
export const DEEP_PLANNING_VARIANTS: readonly DeepPlanningVariantDescriptor[] = Object.freeze([
	NATIVE_DEEP_PLANNING_VARIANT,
	LITE_DEEP_PLANNING_VARIANT,
])
