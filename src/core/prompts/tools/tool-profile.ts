import { PromptProfile } from "../profiles/types"
import { ProfileToolSet } from "./profile-tool-set"
import { LITE_TOOL_IDS, NATIVE_TOOL_IDS } from "./tool-ids"
import { NATIVE_TOOL_SPECS } from "./tool-specs"

export { LITE_TOOL_IDS, NATIVE_TOOL_IDS } from "./tool-ids"

/** Creates a fully registered exact-profile tool set. */
export function createToolSet(): ProfileToolSet {
	const tools = new ProfileToolSet()
	const nativeSpecs = new Map(NATIVE_TOOL_SPECS.map((spec) => [spec.id, spec]))
	for (const id of NATIVE_TOOL_IDS) {
		const base = nativeSpecs.get(id)
		if (!base) {
			throw new Error(`Missing canonical Native tool spec: ${id}`)
		}
		tools.register({ ...base, profile: PromptProfile.Native })
	}
	for (const id of LITE_TOOL_IDS) {
		const base = nativeSpecs.get(id)
		if (!base) {
			throw new Error(`Missing canonical Lite tool spec source: ${id}`)
		}
		tools.register({ ...base, profile: PromptProfile.Lite })
	}
	return tools
}
