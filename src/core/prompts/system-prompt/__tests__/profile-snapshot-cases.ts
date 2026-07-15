import type { SystemPromptContext } from "../context"

export type SnapshotProfile = "native" | "lite"
export type SnapshotTransport = "native" | "xml"

export interface ProfileSnapshotCase {
	readonly id: "basic" | "no-browser" | "no-mcp" | "no-focus" | "no-subagents" | "no-parallel" | "cli" | "yolo" | "no-web"
	readonly overrides: Partial<SystemPromptContext>
}

export const PROFILE_SNAPSHOT_CASES: readonly ProfileSnapshotCase[] = [
	{ id: "basic", overrides: {} },
	{
		id: "no-browser",
		overrides: {
			supportsBrowserUse: false,
			browserSettings: { viewport: { width: 1280, height: 800 }, disableToolUse: true },
		},
	},
	{ id: "no-mcp", overrides: { mcpHub: { getServers: () => [] } as unknown as SystemPromptContext["mcpHub"] } },
	{ id: "no-focus", overrides: { focusChainSettings: { enabled: false, remindClineInterval: 0 } } },
	{ id: "no-subagents", overrides: { subagentsEnabled: false } },
	{ id: "no-parallel", overrides: { enableParallelToolCalling: false } },
	{ id: "cli", overrides: { isCliEnvironment: true } },
	{ id: "yolo", overrides: { yoloModeToggled: true } },
	{ id: "no-web", overrides: { clineWebToolsEnabled: false } },
]

export const SNAPSHOT_PROFILES: readonly SnapshotProfile[] = ["native", "lite"]
export const SNAPSHOT_TRANSPORTS: readonly SnapshotTransport[] = ["native", "xml"]

export function profileSnapshotName(
	profile: SnapshotProfile,
	transport: SnapshotTransport,
	caseId: ProfileSnapshotCase["id"],
	kind: "prompt" | "tools",
): string {
	return `${profile}.${transport}.${caseId}.${kind}.snap`
}
