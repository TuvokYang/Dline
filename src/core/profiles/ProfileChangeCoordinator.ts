import type { ApiProfile } from "@shared/proto/dline/profile"
import type { Controller } from "@/core/controller"

interface ProfileChange {
	oldName?: string
	newName?: string
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
				const planProfile = task?.taskSm.planModeProfile
				const actProfile = task?.taskSm.actModeProfile
				const affected = [...changes.values()].some(
					(change) =>
						planProfile === change.oldName ||
						planProfile === change.newName ||
						actProfile === change.oldName ||
						actProfile === change.newName,
				)
				if (affected && task) {
					task.rebuildApiHandler()
					controller.restartAccountUsagePolling()
				}
				await controller.postStateToWebview()
			}),
		)
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
				changes.set(id, { oldName: oldProfile?.name, newName: nextProfile?.name })
			}
		}
		return changes
	}
}
