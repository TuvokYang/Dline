import { getPrompt } from "../../../i18n"
import { SystemPromptSection } from "../../templates/placeholders"

export const devstralComponentOverrides = {
	[SystemPromptSection.AGENT_ROLE]: {
		template: getPrompt("devstralOverrides", "agentRole"),
	},
}
