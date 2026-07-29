// English prompts — key-value pairs only, no code logic.
const prompts: Record<string, string> = {
	description: `Request to execute a CLI command on the system. Use this when you need to perform system operations or run specific commands to accomplish any step in the user's task. You must tailor your command to the user's system and provide a clear explanation of what the command does. For command chaining, use the appropriate chaining syntax for the user's shell. Prefer to execute complex CLI commands over creating executable scripts, as they are more flexible and easier to run. Commands default to the current working directory: {{CWD}}{{MULTI_ROOT_HINT}}. Use workdirectory when a command must run elsewhere instead of prepending a cd command.`,
	commandInstruction:
		"The CLI command to execute. This should be valid for the current operating system. Ensure the command is properly formatted and does not contain any harmful instructions.",
	commandUsage: "Your command here",
	workdirectoryInstruction:
		"Optional directory in which to execute the command. Relative paths are resolved from {{CWD}}. The directory must already exist. Directories outside the project require user approval. Use this parameter instead of prepending cd solely to change the command directory.",
	workdirectoryUsage: "path/to/directory",
	requiresApprovalInstruction:
		"A boolean indicating whether this command requires explicit user approval before execution in case the user has auto-approve mode enabled. Set to 'true' for potentially impactful operations like installing/uninstalling packages, deleting/overwriting files, system configuration changes, network operations, or any commands that could have unintended side effects. Set to 'false' for safe operations like reading files/directories, running development servers, building projects, and other non-destructive operations.",
	requiresApprovalUsage: "true or false",
	backgroundInstruction:
		"Optional boolean. Set true to start the command as a Dline-owned background process, return control immediately, and keep its output and cancellation lifecycle tracked. Defaults to false.",
	backgroundUsage: "false",
	timeoutInstruction:
		"Optional positive integer foreground wait in seconds. If the command is still running when this wait expires, Dline returns control and continues tracking the process in the background. Defaults to 30 seconds for ordinary commands and 300 seconds for recognized long-running commands.",
	timeoutUsage: "30",
	nativeDescription: `Request to execute a CLI command on the system. Use this when you need to perform system operations or run specific commands to accomplish any step in the user's task. You must tailor your command to the user's system and provide a clear explanation of what the command does. For command chaining, use the appropriate chaining syntax for the user's shell. Prefer to execute complex CLI commands over creating executable scripts, as they are more flexible and easier to run. Commands default to the current workspace; set workdirectory when a command must run elsewhere.`,
	nativeCommandInstruction:
		"The CLI command to execute. This should be valid for the current operating system. Ensure the command is properly formatted and does not contain any harmful instructions. Do not use the ~ character or $HOME to refer to the home directory. Do not prepend cd solely to select the execution directory; use workdirectory instead.",
	nativeWorkdirectoryInstruction:
		"Optional directory in which to execute the command. Relative paths are resolved from @CWD@. The directory must already exist. A directory outside every project root requires user approval.",
	nativeRequiresApprovalInstruction:
		"A boolean indicating whether this command requires explicit user approval before execution in case the user has auto-approve mode enabled. Set to true for potentially impactful operations like installing or uninstalling packages, deleting or overwriting files, system configuration changes, network operations, or any commands that could have unintended side effects. Set to false for safe operations like reading files or directories, running development servers, building projects, and other non-destructive operations.",
	nativeBackgroundInstruction:
		"Optional boolean. Set true to start the command as a Dline-owned background process, return control immediately, and keep its output and cancellation lifecycle tracked. Defaults to false.",
	nativeTimeoutInstruction:
		"Optional positive integer foreground wait in seconds. If the command is still running when this wait expires, Dline returns control and continues tracking the process in the background. Defaults to 30 seconds for ordinary commands and 300 seconds for recognized long-running commands.",
	gemini3Description:
		"Request to execute a CLI command on the system. Use this when you need to perform system operations or run specific commands to accomplish any step in the user's task. When chaining commands, use the shell operator && (not the HTML entity &&). If using search/grep commands, be careful to not use vague search terms that may return thousands of results. When in PLAN MODE, you may use the execute_command tool, but only in a non-destructive manner and in a way that does not alter any files.",
	gemini3CommandInstruction:
		"The CLI command to execute. This should be valid for the current operating system. Use workdirectory rather than prepending cd solely to select the execution directory. Do not use the ~ character or $HOME to refer to the home directory. Do not run search/grep commands that may return thousands of results.",
	clineIgnoreError:
		"Access to @PATH@ is blocked by the .clineignore file settings. You must try to continue in the task without using this file, or ask the user to update the .clineignore file.",
	permissionDeniedError:
		"Command execution blocked by DLINE_COMMAND_PERMISSIONS: @REASON@. You must try a different approach or ask the user to update the permission settings.",
	executeCommandMissingCommandError: `The 'command' parameter was empty. Provide the shell command to execute.

Example:
<execute_command>
<command>python -m pytest tests/</command>
<workdirectory>/path</workdirectory>
<requires_approval>false</requires_approval>
</execute_command>`,
}
export default prompts
