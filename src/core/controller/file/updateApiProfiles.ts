/**
 * Handler for updateApiProfiles RPC.
 *
 * Writes ApiProfile configurations to ~/.dline/data/settings/api_profiles.json.
 */

import { ModelRegistry } from "@core/model-registry/ModelRegistry"
import { getDlineDataDir } from "@core/storage/disk"
import { deleteApiKey, migrateApiKey, setApiKey } from "@core/storage/secrets"
import { Empty } from "@shared/proto/dline/common"
import { UpdateApiProfilesRequest } from "@shared/proto/dline/profile"
import { Logger } from "@shared/services/Logger"
import path from "path"
import type { Controller } from ".."
import { normalizeApiProfile, readApiProfiles, writeApiProfilesToFile } from "./getApiProfiles"

const API_PROFILES_FILE = "api_profiles.json"
let updateApiProfilesQueue: Promise<Empty> = Promise.resolve(Empty.create({}))

/**
 * Save ApiProfiles to api_profiles.json.
 *
 * After persisting, rebuild the active task's API handler so that the next
 * conversation turn picks up the updated profile content (model, reasoning,
 * etc.). Without this rebuild the handler keeps a stale profile snapshot.
 */
export async function updateApiProfiles(controller: Controller, request: UpdateApiProfilesRequest): Promise<Empty> {
	const nextUpdate = updateApiProfilesQueue.then(
		() => updateApiProfilesImpl(controller, request),
		() => updateApiProfilesImpl(controller, request),
	)
	updateApiProfilesQueue = nextUpdate.catch(() => Empty.create({}))
	return nextUpdate
}

async function updateApiProfilesImpl(controller: Controller, request: UpdateApiProfilesRequest): Promise<Empty> {
	const settingsDir = path.join(getDlineDataDir(), "settings")
	const filePath = path.join(settingsDir, API_PROFILES_FILE)

	const oldProfiles = readApiProfiles()
	const oldMap = new Map(oldProfiles.map((p) => [p.id, p]))
	const profiles = (request.profiles || []).map(normalizeApiProfile)
	const nextIds = new Set(profiles.map((p) => p.id))
	const registry = ModelRegistry.getInstance()
	if (!registry.isInitialized) {
		await registry.reload()
	}

	for (const oldProfile of oldProfiles) {
		if (!nextIds.has(oldProfile.id)) {
			deleteApiKey(oldProfile.id)
		}
	}

	for (const profile of profiles) {
		const old = oldMap.get(profile.id)
		if (old && old.name !== profile.name && profile.name) {
			migrateApiKey(profile.id, profile.name)
		}

		if (profile.apiKey) {
			setApiKey(profile.id, profile.apiKey, profile.name)
		} else {
			deleteApiKey(profile.id)
		}
	}

	try {
		await writeApiProfilesToFile(filePath, profiles)
		Logger.log(`[updateApiProfiles] Saved ${profiles.length} profile(s)`)

		// Rebuild the active task's API handler so the next turn uses the
		// latest profile content from disk instead of the stale snapshot.
		controller.task?.rebuildApiHandler()

		return Empty.create({})
	} catch (err) {
		Logger.error("[updateApiProfiles] Failed to write api_profiles.json:", err)
		throw new Error("Failed to save ApiProfiles")
	}
}
