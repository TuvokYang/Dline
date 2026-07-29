// English user instructions prompts — key-value pairs only, no code logic.

const prompts: Record<string, string> = {
	main: `USER'S CUSTOM INSTRUCTIONS

The following additional instructions are provided by the user, and must be followed to the best of your ability without interfering with the TOOL USE guidelines.

@CUSTOM_INSTRUCTIONS@`,
}

export default prompts
