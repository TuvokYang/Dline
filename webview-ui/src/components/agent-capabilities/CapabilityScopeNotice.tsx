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
	global: "Saved globally",
	workspace: "Saved for this workspace",
	task: "Saved for this task only",
}

/**
 * Tell the user which layer a toggle in this panel is stored in.
 *
 * The panel is a dense list, so this stays a single muted line rather than a
 * banner: it answers a question the user only asks once, and should not compete
 * with the toggles themselves.
 */
export const CapabilityScopeNotice = ({ scope }: CapabilityScopeNoticeProps) => (
	<div
		className="mb-1.5 flex items-center gap-1 text-[11px] text-vscode-descriptionForeground"
		data-scope={scope}
		data-testid="capability-scope-notice">
		<i className={`codicon ${scope === "task" ? "codicon-target" : "codicon-settings-gear"} text-[11px]`} />
		<span>{SCOPE_TEXT[scope]}</span>
	</div>
)
