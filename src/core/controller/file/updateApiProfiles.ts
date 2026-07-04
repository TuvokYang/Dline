/**
 * Handler for updateApiProfiles RPC.
 *
 * Writes ApiProfile configurations to ~/.dline/data/settings/api_profiles.json.
 */

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
 */
export async function updateApiProfiles(_controller: Controller, request: UpdateApiProfilesRequest): Promise<Empty> {
	const nextUpdate = updateApiProfilesQueue.then(
		() => updateApiProfilesImpl(request),
		() => updateApiProfilesImpl(request),
	)
	updateApiProfilesQueue = nextUpdate.catch(() => Empty.create({}))
	return nextUpdate
}

async function updateApiProfilesImpl(request: UpdateApiProfilesRequest): Promise<Empty> {
	const settingsDir = path.join(getDlineDataDir(), "settings")
	const filePath = path.join(settingsDir, API_PROFILES_FILE)

	const oldProfiles = readApiProfiles()
	const oldMap = new Map(oldProfiles.map((p) => [p.id, p]))
	const profiles = (request.profiles || []).map(normalizeApiProfile)
	const nextIds = new Set(profiles.map((p) => p.id))

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
		return Empty.create({})
	} catch (err) {
		Logger.error("[updateApiProfiles] Failed to write api_profiles.json:", err)
		throw new Error("Failed to save ApiProfiles")
	}
}
