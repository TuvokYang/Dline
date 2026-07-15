import { PromptProfile } from "../../../profiles/types"

export interface DeepPlanningVariantDescriptor {
	readonly id: PromptProfile
	readonly templateId: string
}

/** Native deep-planning contract selected only by the explicit Prompt profile. */
export const NATIVE_DEEP_PLANNING_VARIANT: DeepPlanningVariantDescriptor = Object.freeze({
	id: PromptProfile.Native,
	templateId: "deepPlanning5Step.main",
})
