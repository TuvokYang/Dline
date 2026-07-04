// English skills prompts — key-value pairs only, no code logic.

const prompts: Record<string, string> = {
	main: `SKILLS

The following skills provide specialized instructions for specific tasks. When a user's request matches a skill description, use the use_skill tool to load and activate the skill.

Available skills:
{skillsList}

To use a skill:
1. Match the user's request to a skill based on its description
2. Call use_skill with the skill_name parameter set to the exact skill name
3. Follow the instructions returned by the tool`,
}

export default prompts
