import path from "node:path"
import type { UnifyStore } from "@core/storage/backend/api/UnifyStore"
import { SqliteUnifyStoreBackend } from "@core/storage/backend/sqlite/SqliteUnifyStore"
import { ensureTaskDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { ApiResponseExecutionEntity } from "./api-response-execution-entity"

export interface ApiResponseExecutionCollectionOptions {
	readonly taskId: string
	readonly location?: string
}

export async function createApiResponseExecutionCollection(
	options: ApiResponseExecutionCollectionOptions,
): Promise<UnifyStore<ApiResponseExecutionEntity>> {
	const taskDirectory = await ensureTaskDirectoryExists(options.taskId)
	const databasePath = options.location ?? path.join(taskDirectory, GlobalFileNames.taskDatabase(options.taskId))
	const database = await new SqliteUnifyStoreBackend().open(databasePath)
	let store: UnifyStore<ApiResponseExecutionEntity> | undefined
	try {
		store = await database.openStore(ApiResponseExecutionEntity)
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
