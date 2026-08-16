import { ContextTransitionEngine } from "@core/controller/context-transition/ContextTransitionEngine"
import { ProfileTransitionPolicy } from "@core/controller/context-transition/policies/ProfileTransitionPolicy"
import type { ProfileSwitchRequestResult, ProfileSwitchSnapshot } from "@shared/profile-switch"
import type { ProfileSwitchDependencies, ProfileSwitchRequest } from "./types"

export interface ProfileSwitchAdapterDeps {
	engine: ContextTransitionEngine
	policy: ProfileTransitionPolicy
}

/** Preserve the Profile RPC surface while delegating all transaction state to the shared engine. */
export class ProfileSwitchCoordinator {
	private readonly engine: ContextTransitionEngine
	private readonly policy: ProfileTransitionPolicy

	constructor(deps: ProfileSwitchDependencies | ProfileSwitchAdapterDeps) {
		if ("engine" in deps) {
			this.engine = deps.engine
			this.policy = deps.policy
			return
		}
		this.engine = new ContextTransitionEngine({
			lease: deps.lease,
			compaction: deps.compaction,
			postState: deps.postState,
			createId: deps.createId,
		})
		this.policy = new ProfileTransitionPolicy({
			bindings: deps.bindings,
			pressure: deps.pressure,
			commit: deps.commit,
			getTaskId: deps.getTaskId,
		})
	}

	/** Request a direct or confirmation-gated Profile transition. */
	async request(input: ProfileSwitchRequest): Promise<ProfileSwitchRequestResult> {
		return this.engine.request(this.policy, input)
	}

	/** Confirm one awaiting Profile transition and compact with its frozen target handler. */
	async confirm(operationId: string): Promise<ProfileSwitchRequestResult> {
		return this.engine.confirm(operationId)
	}

	/** Cancel only the active awaiting-confirmation operation. */
	async cancel(operationId: string): Promise<ProfileSwitchRequestResult> {
		return this.engine.cancel(operationId)
	}

	/** Return a detached read-only transaction snapshot. */
	getSnapshot(): ProfileSwitchSnapshot {
		const snapshot = this.engine.getSnapshot<ProfileSwitchSnapshot>("profile")
		return {
			...snapshot,
			targetModes: snapshot.targetModes ? [...snapshot.targetModes] : undefined,
		}
	}

	/** Release resources during task lifecycle cleanup. */
	async reset(reason = "Profile switch reset."): Promise<void> {
		await this.engine.reset(reason)
	}
}
