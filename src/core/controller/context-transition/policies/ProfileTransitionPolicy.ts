import { decideContextTransition } from "@core/context/context-management/context-transition-preflight"
import type {
	ContextPressureReader,
	ProfileBindingResolver,
	ProfileCommitPort,
	ProfileSwitchOperation,
	ProfileSwitchRequest,
} from "@core/controller/profile-switch/types"
import type { ProfileSwitchSnapshot } from "@shared/profile-switch"
import type { Mode } from "@shared/storage/types"
import type {
	ContextTransitionCompactionRequest,
	ContextTransitionPhase,
	ContextTransitionPolicy,
	ContextTransitionPreparation,
	ContextTransitionSnapshotContext,
} from "../ContextTransitionEngine"

export interface ProfileTransitionPolicyDeps {
	bindings: ProfileBindingResolver
	pressure: ContextPressureReader
	commit: ProfileCommitPort
	getTaskId: () => string | undefined
}

/** Express Profile-specific projection and confirmation-first binding adoption. */
export class ProfileTransitionPolicy
	implements ContextTransitionPolicy<ProfileSwitchRequest, ProfileSwitchOperation, ProfileSwitchSnapshot>
{
	readonly kind = "profile" as const
	readonly confirmationOrder = "commit_then_compact" as const

	constructor(private readonly deps: ProfileTransitionPolicyDeps) {}

	async prepare(
		input: ProfileSwitchRequest,
		operationId: string,
	): Promise<ContextTransitionPreparation<ProfileSwitchOperation>> {
		if (this.deps.getTaskId() !== input.taskId) {
			return { kind: "rejected", error: "Active task changed before Profile switch request." }
		}
		const targetModes = normalizeTargetModes(input.targetModes)
		if (!input.targetProfileId || !input.targetProfile || targetModes.length === 0) {
			return { kind: "rejected", error: "Profile switch requires a resolved target Profile and at least one target mode." }
		}
		const activeMode = this.deps.bindings.getCurrentMode()
		const operation: ProfileSwitchOperation = {
			operationId,
			taskId: input.taskId,
			activeMode,
			sourceBindings: collectSourceBindings(targetModes, this.deps.bindings.getBinding),
			targetProfileId: input.targetProfileId,
			targetProfile: input.targetProfile,
			targetModes,
			chatContent: input.chatContent,
		}
		if (!targetModes.includes(activeMode)) return { kind: "direct", operation }

		const sourceProfile = operation.sourceBindings[activeMode]
		const target = this.deps.bindings.resolveTarget(input.targetProfileId, input.targetProfile, activeMode)
		if (!sourceProfile || !target || target.contextWindow <= 0) {
			return { kind: "rejected", error: "Unable to resolve source binding, target handler, and target context window." }
		}
		operation.activeTarget = target
		operation.currentTokens = await this.deps.pressure.read(target.executionApi, activeMode, input.chatContent)
		if (this.deps.getTaskId() !== input.taskId) {
			return { kind: "rejected", error: "Profile switch became stale during target projection." }
		}
		const decision = decideContextTransition({
			projectedUsageTokens: operation.currentTokens,
			targetContextWindow: target.triggerTokens,
		})
		return decision.kind === "confirm" ? { kind: "confirm", operation } : { kind: "direct", operation }
	}

	validate(operation: ProfileSwitchOperation): boolean {
		return this.deps.getTaskId() === operation.taskId && this.deps.commit.validate(operation)
	}

	createCompactionRequest(operation: ProfileSwitchOperation): ContextTransitionCompactionRequest {
		const target = operation.activeTarget
		if (!target) throw new Error("Profile transition target request scope is unavailable.")
		const adoptedProfiles: Partial<Record<Mode, string>> = {}
		for (const mode of operation.targetModes) adoptedProfiles[mode] = target.profile
		return {
			operationId: operation.operationId,
			targetApi: target.executionApi,
			targetMode: operation.activeMode,
			chatContent: operation.chatContent,
			transition: {
				kind: "profile_switch",
				operationId: operation.operationId,
				phase: "compacting",
				source: {
					mode: operation.activeMode,
					profile: target.profile,
				},
				sourceProfiles: adoptedProfiles,
				target: {
					mode: operation.activeMode,
					profile: target.profile,
					contextWindow: target.contextWindow,
				},
				targetModes: [...operation.targetModes],
				chatContent: operation.chatContent
					? {
							message: operation.chatContent.message,
							images: [...(operation.chatContent.images ?? [])],
							files: [...(operation.chatContent.files ?? [])],
						}
					: undefined,
			},
		}
	}

	commit(operation: ProfileSwitchOperation): Promise<void> {
		return this.deps.commit.commit(operation)
	}

	createSnapshot(
		operation: ProfileSwitchOperation,
		phase: ContextTransitionPhase,
		error?: string,
		context?: ContextTransitionSnapshotContext,
	): ProfileSwitchSnapshot {
		const target = operation.activeTarget
		return {
			phase,
			operationId: operation.operationId,
			taskId: operation.taskId,
			activeMode: operation.activeMode,
			targetModes: [...operation.targetModes],
			sourceProfile: operation.sourceBindings[operation.activeMode],
			targetProfile: operation.targetProfile,
			targetAdopted: context?.targetAdopted,
			compactionModel: target?.executionApi?.getModel?.()?.id,
			currentTokens: operation.currentTokens,
			targetContextWindow: target?.contextWindow,
			fittingExitTarget: target?.fittingExitTarget,
			...(error ? { error } : {}),
		}
	}

	cancelledError(): string {
		return "Profile switch cancelled."
	}

	compactionError(result: "cancelled" | "failed"): string {
		return result === "cancelled" ? "Profile switch compaction cancelled." : "Profile switch compaction failed."
	}

	staleConfirmationError(): string {
		return "Profile switch confirmation is stale."
	}

	staleCancellationError(): string {
		return "Profile switch cancellation is stale."
	}

	stateChangedError(): string {
		return "Profile switch state changed before commit."
	}
}

function normalizeTargetModes(modes: readonly Mode[]): Mode[] {
	return [...new Set(modes)]
}

function collectSourceBindings(
	modes: readonly Mode[],
	getBinding: (mode: Mode) => string | undefined,
): Partial<Record<Mode, string>> {
	const bindings: Partial<Record<Mode, string>> = {}
	for (const mode of modes) {
		const binding = getBinding(mode)
		if (binding !== undefined) bindings[mode] = binding
	}
	return bindings
}
