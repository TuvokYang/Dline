export interface ProfileSection {
	readonly id: string
	readonly body: string
}

/** Defines one immutable profile section. */
export function defineSection(id: string, body: string): ProfileSection {
	return { id, body }
}

/** Composes profile sections with one deterministic separator. */
export function composeLayout(sections: readonly ProfileSection[], separator: string): string {
	return sections.map((section) => section.body.trim()).join(separator)
}

export const SYSTEM_CONTEXT_SECTION = defineSection(
	"system-context",
	`SYSTEM CONTEXT

- Operating environment: @IDE_NAME@ using @SHELL@ from @HOME_DIR@.
- Current working directory: @CWD@
- Command environment: @COMMAND_ENV@
- Workspace roots: @WORKSPACE_ROOTS@@MULTI_ROOT_HINT@`,
)

export const RUNTIME_CAPABILITIES_SECTION = defineSection(
	"runtime-capabilities",
	`RUNTIME CAPABILITIES

- Tool transport: @TOOL_TRANSPORT@
- Native tools enabled: @NATIVE_TOOLS_ENABLED@
- Parallel tools enabled: @PARALLEL_TOOLS_ENABLED@
- MCP enabled: @MCP_ENABLED@
- Browser enabled: @BROWSER_ENABLED@ (@BROWSER_VIEWPORT_WIDTH@x@BROWSER_VIEWPORT_HEIGHT@)
- Subagents enabled: @SUBAGENTS_ENABLED@
- Focus chain enabled: @FOCUS_CHAIN_ENABLED@
- YOLO mode enabled: @YOLO_MODE_ENABLED@

@MCP_SERVERS_SECTION@

@CAPABILITIES_SECTION@

@SKILLS_SECTION@`,
)

export const USER_CONTEXT_SECTION = defineSection(
	"user-context",
	`USER'S CUSTOM INSTRUCTIONS

@USER_INSTRUCTIONS_SECTION@`,
)
