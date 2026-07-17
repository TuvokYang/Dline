/**
 * Handler for updateApiProfiles RPC.
 *
 * Writes ApiProfile configurations to ~/.dline/data/settings/api_profiles.json.
 */

import { ModelRegistry } from "@core/model-registry/ModelRegistry"
import { OrchestratorController } from "@core/orchestrator/OrchestratorController"
import { getDlineDataDir } from "@core/storage/disk"
import { type ApiKeyEntry, getAllApiKeys, setApiKeysBatch } from "@core/storage/secrets"
import { Empty } from "@shared/proto/dline/common"
import { UpdateApiProfilesRequest } from "@shared/proto/dline/profile"
import { Logger } from "@shared/services/Logger"
import path from "path"
import type { Controller } from ".."
import { applyRegistryModelDefaults, normalizeApiProfile, readApiProfiles, writeApiProfilesToFile } from "./getApiProfiles"

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
	const profiles = (request.profiles || []).map(normalizeApiProfile)
	const nextIds = new Set(profiles.map((p) => p.id))
	const registry = ModelRegistry.getInstance()
	if (!registry.isInitialized) {
		await registry.reload()
	}
	applyRegistryModelDefaults(profiles)

	const storedKeys = getAllApiKeys()
	const keyChanges: Record<string, ApiKeyEntry | undefined> = {}
	for (const oldProfile of oldProfiles) {
		if (!nextIds.has(oldProfile.id)) {
			keyChanges[oldProfile.id] = undefined
		}
	}

	for (const profile of profiles) {
		const stored = storedKeys[profile.id]
		if (profile.apiKey) {
			if (!stored || stored.apiKey !== profile.apiKey || stored.name !== profile.name) {
				keyChanges[profile.id] = { apiKey: profile.apiKey, name: profile.name }
			}
		} else if (stored) {
			keyChanges[profile.id] = undefined
		}
	}

	try {
		await writeApiProfilesToFile(filePath, profiles)
		await setApiKeysBatch(keyChanges)
		Logger.log(`[updateApiProfiles] Saved ${profiles.length} profile(s)`)

		try {
			await OrchestratorController.getInstance().profileChanges.publish(oldProfiles, profiles)
		} catch (error) {
			// Standalone controller tests and hosts may not initialize the orchestrator.
			Logger.warn("[updateApiProfiles] Profile change broadcast unavailable; updating current controller", error)
			try {
				controller.task?.rebuildApiHandler()
				await controller.postStateToWebview?.()
			} catch (notificationError) {
				Logger.error("[updateApiProfiles] Profiles were saved but controller refresh failed", notificationError)
			}
		}

		return Empty.create({})
	} catch (err) {
		Logger.error("[updateApiProfiles] Failed to write api_profiles.json:", err)
		throw new Error("Failed to save ApiProfiles")
	}
}
