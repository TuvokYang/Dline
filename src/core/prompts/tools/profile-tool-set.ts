import type { ClineDefaultTool } from "../../../shared/tools"
import type { PromptProfile } from "../profiles/types"
import type { SystemPromptContext } from "../system-prompt/context"

export type ToolTransport = "native" | "xml" | "both"
export type ToolParamType = "string" | "boolean" | "integer" | "array" | "object"

export interface ProfileToolParam {
	readonly name: string
	readonly required: boolean
	readonly instruction: string
	readonly type?: ToolParamType
	readonly dependencies?: readonly ClineDefaultTool[]
	readonly contextRequirements?: (context: SystemPromptContext) => boolean
}

export interface ProfileToolSpec {
	readonly profile: PromptProfile
	readonly transport: ToolTransport
	readonly id: ClineDefaultTool
	readonly name: string
	readonly description: string
	readonly instruction?: string
	readonly contextRequirements?: (context: SystemPromptContext) => boolean
	readonly parameters?: readonly ProfileToolParam[]
	readonly inputSchema?: object
}

export type ProfileToolErrorReason = "missing-tool" | "duplicate-tool"

/** Reports exact profile tool registration and lookup failures. */
export class ProfileToolError extends Error {
	/** Creates a structured profile tool error. */
	public constructor(
		public readonly reason: ProfileToolErrorReason,
		public readonly profile: PromptProfile,
		public readonly toolId: ClineDefaultTool,
	) {
		super(`Profile tool ${reason} profile=${profile} tool=${toolId}`)
		this.name = "ProfileToolError"
	}
}

/** Stores tool descriptors under exact Native/Lite profile keys. */
export class ProfileToolSet {
	private readonly profiles = new Map<PromptProfile, Map<ClineDefaultTool, ProfileToolSpec>>()

	/** Registers one exact profile tool descriptor. */
	public register(spec: ProfileToolSpec): void {
		const tools = this.profiles.get(spec.profile) ?? new Map<ClineDefaultTool, ProfileToolSpec>()
		if (tools.has(spec.id)) {
			throw new ProfileToolError("duplicate-tool", spec.profile, spec.id)
		}
		tools.set(spec.id, spec)
		this.profiles.set(spec.profile, tools)
	}

	/** Resolves one tool without profile fallback. */
	public get(profile: PromptProfile, id: ClineDefaultTool): ProfileToolSpec {
		const spec = this.profiles.get(profile)?.get(id)
		if (!spec) {
			throw new ProfileToolError("missing-tool", profile, id)
		}
		return spec
	}

	/** Resolves an ordered exact-profile tool list. */
	public list(profile: PromptProfile, ids: readonly ClineDefaultTool[]): readonly ProfileToolSpec[] {
		return ids.map((id) => this.get(profile, id))
	}
}
