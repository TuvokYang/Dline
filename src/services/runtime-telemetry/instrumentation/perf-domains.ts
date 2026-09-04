/**
 * Typed catalogue of runtime performance domains and phases.
 *
 * Before this table every timing lived inside a `Logger.debug` template such as
 * `[TerminalPerf] phase=process_start terminalId=... waitMs=...`. That form has
 * two defects: the data disappears at the default `info` log level, and the
 * phase name is a free-form string that cannot be aggregated across sessions.
 *
 * The catalogue fixes both by making the domain and its phases part of the
 * type system. A call site can only name a phase that is declared here, so a
 * typo becomes a compile error instead of a silently unaggregatable series.
 */

/** Domain a measurement belongs to. Becomes the first segment of the event name. */
export enum PerfDomain {
	Terminal = "terminal",
	TerminalPool = "terminal_pool",
	Checkpoint = "checkpoint",
	HookDiscovery = "hook_discovery",
	Settings = "settings",
	SettingsRepository = "settings_repository",
	TaskInit = "task_init",
	TaskClose = "task_close",
	TaskSnapshot = "task_snapshot",
	ControllerClose = "controller_close",
	Profile = "profile",
	Capability = "capability",
	PromptInputWatcher = "prompt_input_watcher",
	PromptFreshness = "prompt_freshness",
	PromptBuild = "prompt_build",
	FileLock = "file_lock",
	Activation = "activation",
}

/**
 * Phases declared per domain.
 *
 * Each entry mirrors the `phase=` value the original log template carried, so
 * a reader comparing a migrated call site against git history sees the same
 * vocabulary. New phases are added here first.
 */
export const PERF_PHASES = {
	[PerfDomain.Terminal]: [
		"execute_start",
		"terminal_acquired",
		"execute_complete",
		"execute_error",
		"process_start",
		"process_complete",
		"capability_failure",
		"shell_wait_start",
		"shell_wait_complete",
	],
	[PerfDomain.TerminalPool]: ["warm_process_started", "warm_shell_integration_ready", "prewarm_failed"],
	[PerfDomain.Checkpoint]: ["existing_shadow_baseline", "commit", "restore"],
	[PerfDomain.HookDiscovery]: ["file_check", "has_hook_scan", "global_directory", "directories", "workspace_directories"],
	[PerfDomain.Settings]: ["controller_callback", "sync_callback", "sync_broadcast", "state_flush", "rpc_complete", "rpc_error"],
	[PerfDomain.SettingsRepository]: ["mutate_complete", "reconcile", "listener", "publish"],
	[PerfDomain.TaskInit]: ["stage"],
	[PerfDomain.TaskClose]: ["stage"],
	[PerfDomain.TaskSnapshot]: ["flush_now"],
	[PerfDomain.ControllerClose]: ["stage"],
	[PerfDomain.Profile]: ["catalog_initialize", "catalog_mutate", "catalog_reconcile", "get_profiles"],
	[PerfDomain.Capability]: [
		"workflows_refresh",
		"skills_discover",
		"skills_available",
		"skills_refresh",
		"subagents_refresh",
		"subagents_refresh_error",
		"rules_refresh_rpc",
		"rules_refresh_rpc_error",
		"rule_toggle_scan",
		"external_rules_refresh",
	],
	[PerfDomain.PromptInputWatcher]: ["start", "ready", "dispose", "event_batch"],
	[PerfDomain.PromptFreshness]: ["drain_complete", "reevaluate"],
	[PerfDomain.PromptBuild]: ["capability_context"],
	[PerfDomain.FileLock]: ["acquire"],
	[PerfDomain.Activation]: ["extension_activate", "host_bridge_ready", "controller_ready"],
} as const satisfies Record<PerfDomain, readonly string[]>

/** Phase names valid for `D`. */
export type PerfPhase<D extends PerfDomain> = (typeof PERF_PHASES)[D][number]

/**
 * Event name for a domain/phase pair.
 *
 * Dotted rather than bracketed so the name matches the rest of the telemetry
 * namespace (`runtime.event_loop_delay_ms`, `state.build_duration_ms`) and can
 * be grouped by prefix in a backend.
 */
export function perfEventName<D extends PerfDomain>(domain: D, phase: PerfPhase<D>): string {
	return `${domain}.${phase}`
}

/** Whether `phase` is declared for `domain`. Used by parity tests and guards. */
export function isKnownPerfPhase(domain: PerfDomain, phase: string): boolean {
	return (PERF_PHASES[domain] as readonly string[]).includes(phase)
}

/** Every declared domain, in declaration order. */
export function perfDomains(): readonly PerfDomain[] {
	return Object.keys(PERF_PHASES) as PerfDomain[]
}
