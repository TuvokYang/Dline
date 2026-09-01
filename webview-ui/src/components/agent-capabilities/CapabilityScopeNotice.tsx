/**
 * The storage layer a capability toggle is written to.
 *
 * This is not the same as where a resource comes from. A rule discovered in the
 * global directory can still be turned off for one task only; the section
 * heading names the origin, while this notice names the layer the change lands in.
 */
export type CapabilityStorageScope = "global" | "workspace" | "task"

interface CapabilityScopeNoticeProps {
	scope: CapabilityStorageScope
}

const SCOPE_TEXT: Readonly<Record<CapabilityStorageScope, string>> = {
	global: "Changes apply everywhere.",
	workspace: "Changes apply to this workspace.",
	task: "Changes apply to this task only; the workspace default is unchanged.",
}

const SCOPE_LABEL: Readonly<Record<CapabilityStorageScope, string>> = {
	global: "Global",
	workspace: "Workspace",
	task: "This task",
}

/** Tell the user which layer a toggle in this panel is stored in. */
export const CapabilityScopeNotice = ({ scope }: CapabilityScopeNoticeProps) => (
	<div
		className="mb-3 flex items-center gap-2 border-l-[3px] border-vscode-textLink-foreground bg-vscode-textBlockQuote-background px-3 py-2"
		data-scope={scope}
		data-testid="capability-scope-notice">
		<i className={`codicon ${scope === "task" ? "codicon-target" : "codicon-settings-gear"} text-sm`} />
		<span className="text-xs">
			<span className="font-bold">Saving to: {SCOPE_LABEL[scope]}</span> {SCOPE_TEXT[scope]}
		</span>
	</div>
)
