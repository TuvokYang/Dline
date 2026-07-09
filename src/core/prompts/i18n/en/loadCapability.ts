// English prompts — key-value pairs only, no code logic.
const prompts: Record<string, string> = {
	description:
		"Load detailed read-only metadata for one named capability. The name parameter must match an advertised capability exactly. This tool does not discover capability lists, modify cached system prompts, refresh metadata, or execute the capability.",
	nativeDescription:
		"Load detailed read-only metadata for one named capability by exact name. Does not discover lists, refresh metadata, mutate prompt cache, or execute the capability.",
	nameInstruction: "The exact capability name to load.",
	nameUsage: "capability-name",
}
export default prompts
