import path from "node:path"
import type { UnifyStore } from "@core/storage/backend/api/UnifyStore"
import { SqliteUnifyStoreBackend } from "@core/storage/backend/sqlite/SqliteUnifyStore"
import { ensureTaskDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { ApiRequestRoundLegacyImportEntity } from "./api-request-round-legacy-import-entity"

export interface ApiRequestRoundLegacyImportCollectionOptions {
	readonly taskId: string
	readonly location?: string
}

/** Open the legacy import entity in the same Task-local SQLite database as exact rounds. */
export async function createApiRequestRoundLegacyImportCollection(
	options: ApiRequestRoundLegacyImportCollectionOptions,
): Promise<UnifyStore<ApiRequestRoundLegacyImportEntity>> {
	const taskDirectory = await ensureTaskDirectoryExists(options.taskId)
	const databasePath = options.location ?? path.join(taskDirectory, GlobalFileNames.taskDatabase(options.taskId))
	const database = await new SqliteUnifyStoreBackend().open(databasePath)
	let store: UnifyStore<ApiRequestRoundLegacyImportEntity> | undefined
	try {
		store = await database.openStore(ApiRequestRoundLegacyImportEntity)
		const closeStore = store.close.bind(store)
		let closePromise: Promise<void> | undefined
		store.close = () => {
			closePromise ??= closeStore().then(() => database.close())
			return closePromise
		}
		return store
	} catch (error) {
		await store?.close().catch(() => undefined)
		await database.close().catch(() => undefined)
		throw error
	}
}
