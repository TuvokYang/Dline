import path from "node:path"
import { readApiProfilesFresh, writeApiProfilesToFile } from "@core/controller/file/getApiProfiles"
import { OrchestratorController } from "@core/orchestrator/OrchestratorController"
import { getDlineDataDir } from "@core/storage/disk"
import { Logger } from "@shared/services/Logger"
import { ProfileCatalogRepository } from "./ProfileCatalogRepository"
import { advanceProfileCatalogRevision } from "./profile-catalog-state"

const API_PROFILES_FILE = "api_profiles.json"
const repositories = new Map<string, Promise<ProfileCatalogRepository>>()

/** Lazily initialize one process-local repository per resolved Catalog path. */
export function getProfileCatalogRepository(): Promise<ProfileCatalogRepository> {
	const filePath = path.join(getDlineDataDir(), "settings", API_PROFILES_FILE)
	const existing = repositories.get(filePath)
	if (existing) return existing

	const initialization = (async () => {
		const created = new ProfileCatalogRepository({
			filePath,
			read: readApiProfilesFresh,
			write: (profiles) => writeApiProfilesToFile(filePath, profiles),
		})
		created.subscribe(async ({ previous, profiles }) => {
			advanceProfileCatalogRevision()
			try {
				await OrchestratorController.getInstance().profileChanges.publish(previous, profiles)
			} catch (error) {
				Logger.warn("[ProfileCatalog] External commit broadcast unavailable", error)
			}
		})
		await created.initialize()
		return created
	})()
	repositories.set(filePath, initialization)
	void initialization.catch(() => repositories.delete(filePath))
	return initialization
}
