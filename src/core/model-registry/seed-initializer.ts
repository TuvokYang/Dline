/**
 * Seed initializer — exports built-in provider model data to ~/.dline/providers/
 * on first run, so users have a complete set of model configurations to work with.
 *
 * After the initial export, the JSON files in ~/.dline/providers/ take full
 * precedence. Users can edit them directly and changes are picked up via
 * ModelRegistry's file watcher.
 */
import { allProviderModels } from "@shared/providers/model-infos"
import type { ProviderModelsConfig } from "@shared/providers/types"
import { Logger } from "@shared/services/Logger"
import fs from "fs"
import fsPromises from "fs/promises"
import * as path from "path"

/**
 * Ensure that ~/.dline/providers/ contains a JSON file for every provider
 * defined in allProviderModels. Missing files are created from the seed data.
 *
 * This is safe to call on every startup — existing files are never overwritten.
 *
 * @param providersDir Absolute path to the providers directory
 * @returns Number of newly created seed files
 */
export async function ensureSeedProviders(providersDir: string): Promise<number> {
	let created = 0

	// Ensure the providers directory exists
	await fsPromises.mkdir(providersDir, { recursive: true })

	for (const [providerId, config] of Object.entries(allProviderModels)) {
		const filePath = path.join(providersDir, `${providerId}.json`)

		// Skip if the file already exists — user config takes precedence
		if (fs.existsSync(filePath)) {
			continue
		}

		try {
			// Convert the config to a clean JSON-serializable object
			const jsonContent = serializeConfig(config)
			await fsPromises.writeFile(filePath, jsonContent, "utf8")
			created++
			Logger.log(`[seed-initializer] Created seed config: ${providerId}.json (${Object.keys(config.models).length} models)`)
		} catch (err) {
			Logger.warn(`[seed-initializer] Failed to create seed config for ${providerId}:`, err)
		}
	}

	if (created > 0) {
		Logger.log(`[seed-initializer] Created ${created} seed provider config(s) in ${providersDir}`)
	}

	return created
}

/**
 * Serialize a ProviderModelsConfig to formatted JSON string.
 */
function serializeConfig(config: ProviderModelsConfig): string {
	return JSON.stringify(config, null, "\t")
}
