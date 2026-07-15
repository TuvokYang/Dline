// English system info prompts — key-value pairs only, no code logic.

const prompts: Record<string, string> = {
	main: `SYSTEM INFORMATION

Operating System: @OS@
IDE: @IDE@
Default Shell: @SHELL@
Home Directory: @HOME_DIR@
@WORKSPACE_TITLE@: @WORKING_DIR@`,
}

export default prompts
