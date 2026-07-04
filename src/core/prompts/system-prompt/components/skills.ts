import { getPrompt } from "../../i18n"
import type { PromptVariant, SystemPromptContext } from "../types"

export async function getSkillsSection(_variant: PromptVariant, context: SystemPromptContext): Promise<string | undefined> {
	const skills = context.skills
	if (!skills || skills.length === 0) return undefined

	const skillsList = skills.map((skill) => `  - "${skill.name}": ${skill.description}`).join("\n")

	return getPrompt("skills", "main", { skillsList })
}
