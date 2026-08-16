import type { ApiProfile } from "@shared/proto/dline/profile"
import type { Controller } from "@/core/controller"

interface ProfileChange {
	id: string
	oldProfile?: ApiProfile
	nextProfile?: ApiProfile
}

/** Coordinate process-wide profile update notifications across active controllers. */
export class ProfileChangeCoordinator {
	#revision = 0

	/** Create a coordinator backed by an active-controller snapshot provider. */
	constructor(private readonly getControllers: () => Controller[]) {}

	/** Return the latest process-local profile revision. */
	get revision(): number {
		return this.#revision
	}

	/**
	 * Publish profile changes after the new profile list has been persisted.
	 *
	 * @param oldProfiles Profiles read before the successful write.
	 * @param nextProfiles Profiles persisted by the successful write.
	 */
	async publish(oldProfiles: ApiProfile[], nextProfiles: ApiProfile[]): Promise<void> {
		const changes = this.buildChanges(oldProfiles, nextProfiles)
		if (changes.size === 0) {
			return
		}
		this.#revision += 1

		await Promise.all(
			this.getControllers().map(async (controller) => {
				const task = controller.task
				if (task) {
					this.adoptTaskBinding(
						task.taskSm.planModeProfileId,
						task.taskSm.planModeProfile,
						"plan",
						changes,
						task.taskSm,
					)
					this.adoptTaskBinding(task.taskSm.actModeProfileId, task.taskSm.actModeProfile, "act", changes, task.taskSm)
					await task.reconcileApiProfileValidity()
				}

				this.adoptGlobalBinding(
					controller,
					controller.stateManager.getGlobalSettingsKey("planModeProfileId"),
					controller.stateManager.getGlobalSettingsKey("planModeProfile"),
					"plan",
					changes,
				)
				this.adoptGlobalBinding(
					controller,
					controller.stateManager.getGlobalSettingsKey("actModeProfileId"),
					controller.stateManager.getGlobalSettingsKey("actModeProfile"),
					"act",
					changes,
				)

				// Rename adoption updates compatibility names only. Persist those
				// bindings before publishing the committed Catalog revision.
				await controller.stateManager.flushPendingState()

				// Catalog edits are a list/display concern. They must not replace a
				// running handler; explicit Task Profile selection owns that boundary.
				await controller.postStateToWebview()
			}),
		)
	}

	private adoptTaskBinding(
		profileId: string | undefined,
		profileName: string | undefined,
		mode: "plan" | "act",
		changes: Map<string, ProfileChange>,
		taskState: {
			adoptProfileIdentity: (mode: "plan" | "act", profileId: string, profileName: string) => void
		},
	): void {
		const change = this.findBindingChange(profileId, profileName, changes)
		const profile = change?.nextProfile
		if (profile) {
			taskState.adoptProfileIdentity(mode, profile.id, profile.name)
		}
	}

	private adoptGlobalBinding(
		controller: Controller,
		profileId: string | undefined,
		profileName: string | undefined,
		mode: "plan" | "act",
		changes: Map<string, ProfileChange>,
	): void {
		const change = this.findBindingChange(profileId, profileName, changes)
		const profile = change?.nextProfile
		if (!profile) {
			return
		}

		const idKey = mode === "plan" ? "planModeProfileId" : "actModeProfileId"
		const nameKey = mode === "plan" ? "planModeProfile" : "actModeProfile"
		controller.stateManager.setGlobalState(idKey, profile.id)
		controller.stateManager.setGlobalState(nameKey, profile.name)
	}

	private findBindingChange(
		profileId: string | undefined,
		profileName: string | undefined,
		changes: Map<string, ProfileChange>,
	): ProfileChange | undefined {
		if (profileId) {
			return changes.get(profileId)
		}
		if (!profileName) {
			return undefined
		}
		return [...changes.values()].find((change) => change.oldProfile?.name === profileName)
	}

	/** Build stable-ID profile changes for added, updated, renamed, and deleted profiles. */
	private buildChanges(oldProfiles: ApiProfile[], nextProfiles: ApiProfile[]): Map<string, ProfileChange> {
		const oldMap = new Map(oldProfiles.map((profile) => [profile.id, profile]))
		const nextMap = new Map(nextProfiles.map((profile) => [profile.id, profile]))
		const changes = new Map<string, ProfileChange>()
		for (const id of new Set([...oldMap.keys(), ...nextMap.keys()])) {
			const oldProfile = oldMap.get(id)
			const nextProfile = nextMap.get(id)
			if (JSON.stringify(oldProfile) !== JSON.stringify(nextProfile)) {
				changes.set(id, { id, oldProfile, nextProfile })
			}
		}
		return changes
	}
}
