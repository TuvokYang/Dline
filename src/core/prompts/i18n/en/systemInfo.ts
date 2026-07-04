// English system info prompts — key-value pairs only, no code logic.

const prompts: Record<string, string> = {
	main: `SYSTEM INFORMATION

Operating System: {{os}}
IDE: {{ide}}
Default Shell: {{shell}}
Home Directory: {{homeDir}}
{{WORKSPACE_TITLE}}: {{workingDir}}`,
}

export default prompts
